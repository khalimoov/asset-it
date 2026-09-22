# -*- coding: utf-8 -*-
"""Накладные: приём файла, сохранение в архив и распознавание текста.

Файл приходит перетаскиванием из браузера, кладётся в архив под датой и
учреждением, затем распознаётся. Строки накладной пользователь проверяет и
распределяет по разделам сам — автоматически в учёт ничего не попадает.

Почему так: OCR печатного текста работает прилично, а вот границы колонок в
таблицах путает регулярно, и артикулы страдают от пар 0/O и 5/S. Заводить по
такому в учёт напрямую нельзя.

Движок — Tesseract: он свободен, работает офлайн, знает русский и ставится в
Docker одной строкой. Если его нет, приём файла всё равно работает: строки
заполняются руками, а приложение честно говорит, что распознавание выключено.
"""
import datetime
import os
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULTS = {
    # Windows: сетевая папка. В Docker меняется на точку монтирования.
    "path": r"\\192.168.1.20\archives\documents",
    "lang": "rus+eng",          # русский и латиница вперемешку — обычное дело
    "dpi": 300,                 # ниже 200 OCR заметно врёт
}

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
ALLOWED_EXT = IMAGE_EXT | {".pdf"}
MAX_BYTES = 40 * 1024 * 1024


def merge_config(saved):
    cfg = dict(DEFAULTS)
    # В Docker папка архива — точка монтирования, её задаёт переменная окружения;
    # то, что администратор сохранил в настройках, всё равно главнее.
    if os.environ.get("DOCS_PATH"):
        cfg["path"] = os.environ["DOCS_PATH"]
    cfg.update(saved or {})
    cfg["dpi"] = max(120, min(600, int(cfg.get("dpi") or 300)))
    return cfg


# ------------------------------------------------------------------ окружение

def tessdata_dir():
    """Свои языковые данные, если они лежат рядом с приложением.

    Так русский язык едет вместе с пакетом: на сервере достаточно поставить сам
    Tesseract, скачивать словари отдельно не придётся.
    """
    d = Path(__file__).resolve().parent / "tessdata"
    return str(d) if (d / "rus.traineddata").exists() else ""


def find_tesseract():
    """Путь к tesseract или пустая строка."""
    exe = shutil.which("tesseract")
    if exe:
        return exe
    if sys.platform == "win32":
        for p in (r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                  r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
                  str(Path(__file__).resolve().parent / "tesseract" / "tesseract.exe")):
            if Path(p).exists():
                return p
    return ""


def _tess_env():
    env = dict(os.environ)
    d = tessdata_dir()
    if d:
        env["TESSDATA_PREFIX"] = d
    return env


def ocr_status(cfg=None):
    """Что умеет эта установка: для честного сообщения в интерфейсе."""
    cfg = merge_config(cfg)
    exe = find_tesseract()
    langs, ver = [], ""
    if exe:
        try:
            r = subprocess.run([exe, "--list-langs"], capture_output=True, text=True,
                               timeout=20, encoding="utf-8", errors="replace",
                               env=_tess_env())
            langs = [l.strip() for l in (r.stdout or "").splitlines()[1:] if l.strip()]
            v = subprocess.run([exe, "--version"], capture_output=True, text=True,
                               timeout=20, encoding="utf-8", errors="replace",
                               env=_tess_env())
            ver = (v.stdout or "").splitlines()[0] if v.stdout else ""
        except Exception:
            pass
    try:
        import pypdfium2                      # noqa: F401
        pdf_ok = True
    except ImportError:
        pdf_ok = False
    # Движок сам по себе ничего не решает: распознавание идёт через pytesseract,
    # и если библиотеки нет, «готово» показывать нельзя. Ровно на этом обожглись
    # при обновлении сервера: движок стоял, библиотека — нет.
    missing_libs = []
    for mod, why in (("pytesseract", "распознавание"), ("PIL", "работа с изображениями"),
                     ("pypdfium2", "чтение PDF")):
        try:
            __import__(mod)
        except ImportError:
            missing_libs.append(mod)
    need = [l for l in (cfg["lang"] or "").split("+") if l]
    return {
        "missingLibs": missing_libs,
        "ready": bool(exe) and not missing_libs and all(l in langs for l in need),
        "exe": exe, "version": ver, "langs": langs,
        "missing": [l for l in need if l not in langs],
        "tessdata": tessdata_dir() or os.environ.get("TESSDATA_PREFIX", ""),
        "own": bool(tessdata_dir()),
        "pdf": pdf_ok,
    }


# ------------------------------------------------------------------ архив

def safe_name(name):
    """Имя файла без сюрпризов: без путей и без запрещённых символов."""
    name = os.path.basename(str(name or "")).strip() or "document"
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name)
    return name[:120]


def store(cfg, org_id, org_name, data, orig_name, sub=""):
    """Кладёт файл в архив. Возвращает (относительный путь, полный путь).

    sub — подпапка внутри папки учреждения: накладные на передачу между складами
    лежат в «передача», чтобы не мешаться с приходными.
    """
    cfg = merge_config(cfg)
    ext = Path(safe_name(orig_name)).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise ValueError("принимаются PDF и изображения, а не «%s»" % (ext or "без расширения"))
    if len(data) > MAX_BYTES:
        raise ValueError("файл больше %d МБ" % (MAX_BYTES // 1024 // 1024))

    now = datetime.datetime.now()
    folder = safe_name(org_name or org_id or "общее")
    rel = Path(folder)
    if sub:
        rel = rel / safe_name(sub)
    rel = rel / now.strftime("%Y") / now.strftime("%m")
    base = Path(cfg["path"])
    full_dir = base / rel
    full_dir.mkdir(parents=True, exist_ok=True)

    # имя не должно затирать уже лежащий документ
    stem = Path(safe_name(orig_name)).stem
    fname = "%s_%s_%s%s" % (now.strftime("%Y-%m-%d"), stem, secrets.token_hex(3), ext)
    full = full_dir / fname
    full.write_bytes(data)
    # Относительный путь храним с прямыми косыми: Flask отдаёт файл через
    # safe_join, а тот на пути с обратными косыми возвращает None — и вместо
    # документа пользователь получал 404.
    return (rel / fname).as_posix(), str(full)


# ------------------------------------------------------------------ распознавание

def _pdf_pages(path, dpi):
    """Страницы PDF как изображения. pypdfium2 — колесо, сторонних программ не нужно."""
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(path))
    try:
        for page in doc:
            yield page.render(scale=dpi / 72).to_pil()
    finally:
        doc.close()


def pdf_text_layer(path, max_pages=10):
    """Текст, вшитый в PDF. Пустая строка, если это скан.

    Накладные, напечатанные из программы, несут точный текст — цифры оттуда
    надёжнее любого распознавания. Распознавание оставляем только для сканов.
    """
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return "", 0
    try:
        doc = pdfium.PdfDocument(str(path))
    except Exception:
        return "", 0
    try:
        chunks, pages = [], 0
        for page in doc:
            chunks.append(page.get_textpage().get_text_range())
            pages += 1
            if pages >= max_pages:
                break
        return "\n".join(chunks), pages
    finally:
        doc.close()


# Слова, которые обязаны встретиться в нормально повёрнутой накладной.
# По ним видно, что страница читается «правильной стороной»: у перевёрнутого
# скана их ноль, а текст выглядит как «OJOHHIROWOHLOUA».
ANCHORS = ("получател", "наименование", "количество", "склад", "итого", "накладная",
           "отправител", "материал", "документ", "адрес", "фактура", "поставщик")


def _anchor_score(text):
    low = (text or "").lower()
    return sum(low.count(a) for a in ANCHORS)


def _ocr_image(exe, img, lang):
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = exe
    return pytesseract.image_to_string(img, lang=lang)


def _best_rotation(exe, img, lang):
    """Перебирает четыре поворота и возвращает (текст, угол, все тексты).

    Автоопределение Tesseract (OSD) на этих бланках ошибается: у счёта-фактуры
    оно уверенно советовало 270°, хотя страница читается при 0°. Поэтому решаем
    по делу — сколько нашлось русских слов-якорей и сколько разобралось строк.
    """
    variants = []
    for ang in (0, 90, 180, 270):
        im = img if ang == 0 else img.rotate(-ang, expand=True)
        txt = _ocr_image(exe, im, lang)
        variants.append((_anchor_score(txt), len(parse_rows(txt)), ang, txt))
    # сначала по якорям: без них текст просто мусор. При равенстве — где больше строк
    variants.sort(key=lambda v: (v[0] > 0, v[1], v[0]), reverse=True)
    best = variants[0]
    return best[3], best[2], [v[3] for v in variants]


# ------------------------------------------------------------------ таблица по линейкам
# Tesseract режет страницу на строки сам, и на бланках М-4 это ломается ровно там,
# где наименование занимает две строки: жирный номенклатурный номер стоит между
# ними по центру, и распознаватель склеивает его с одной из строк, а вторую
# теряет или превращает в мусор. Поэтому таблицу режем сами — по линейкам
# бланка: горизонтальные линии дают строки, вертикальные — ячейки, и каждую
# ячейку читаем отдельно. Всё на PIL: проекции считаются через resize(BOX),
# без numpy и OpenCV.

def _dark(img):
    return img.convert("L").point(lambda v: 255 if v < 150 else 0)


def _runs(values, thr, gap=2):
    """Отрезки подряд идущих значений >= thr; разрывы до gap склеиваются."""
    out, start, last = [], None, None
    for i, v in enumerate(values):
        if v >= thr:
            if start is None:
                start = i
            elif last is not None and i - last > gap + 1:
                out.append((start, last)); start = i
            last = i
    if start is not None:
        out.append((start, last))
    return out


def _hlines(mask):
    """Центры горизонтальных линеек: строка изображения, тёмная хотя бы на треть ширины."""
    w, h = mask.size
    prof = list(mask.resize((1, h), 3).getdata())      # 3 = Image.BOX
    return [(a + b) // 2 for a, b in _runs(prof, 255 * 0.33)]


def _vlines(mask, y1, y2):
    """Вертикальные линейки внутри полосы: столбец, тёмный почти на всю высоту полосы."""
    w = mask.size[0]
    band = mask.crop((0, y1, w, y2))
    prof = list(band.resize((w, 1), 3).getdata())
    return [(a + b) // 2 for a, b in _runs(prof, 255 * 0.8)]


def _cells(xs, min_w):
    return [(a, b) for a, b in zip(xs, xs[1:]) if b - a >= min_w]


def _ocr_cell(exe, img, box, lang, psm, whitelist=""):
    from PIL import Image, ImageOps
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = exe
    x1, y1, x2, y2 = box
    pad = 3
    cell = img.crop((x1 + pad, y1 + pad, max(x1 + pad + 1, x2 - pad), max(y1 + pad + 1, y2 - pad)))
    # мелкий шрифт бланка (≈25 px при 300 dpi) Tesseract читает хуже, чем вдвое
    # увеличенный: без этого терялись хвосты слов и путались L/1, Й/И
    cell = cell.resize((cell.width * 2, cell.height * 2), Image.LANCZOS)
    cell = ImageOps.expand(cell, border=20, fill="white")
    cfg = "--psm %d" % psm
    if whitelist:
        cfg += " -c tessedit_char_whitelist=" + whitelist
    try:
        return pytesseract.image_to_string(cell, lang=lang, config=cfg)
    except Exception:
        return ""


def _which(header_cells):
    """Какая ячейка шапки — номенклатура, наименование, количество, цена.

    «Цена» — именно цена за единицу, а не «Стоимость поставки»: в учёте от неё
    считается сумма строки, и итог по документу тут не подходит.
    """
    sku = name = qty = price = None
    for i, t in enumerate(header_cells):
        low = " ".join(t.lower().split())
        if name is None and "наимен" in low:
            name = i
        elif sku is None and ("номенк" in low or ("номер" in low and "счет" not in low
                                                   and "парти" not in low)):
            sku = i
        elif qty is None and "количество" in low:
            qty = i
        elif price is None and "цена" in low:
            price = i
    return sku, name, qty, price


def _in(cells, x):
    for i, (a, b) in enumerate(cells):
        if a <= x <= b:
            return i
    return None


def table_rows(exe, img, lang, dpi=300):
    """Строки таблицы, прочитанные по ячейкам. Пусто, если таблица не нашлась."""
    from PIL import Image
    mask = _dark(img)
    w, h = mask.size
    ys = _hlines(mask)
    if len(ys) < 3:
        return []
    min_row, max_row = int(dpi * 0.10), int(dpi * 1.6)      # 0.1–1.6 дюйма
    bands = [(a, b) for a, b in zip(ys, ys[1:]) if min_row <= b - a <= max_row]
    min_cell = int(dpi * 0.12)

    header = None     # (cells, sku_i, name_i, qty_i, price_i)
    out = []
    for y1, y2 in bands:
        xs = _vlines(mask, y1, y2)
        cells = _cells(xs, min_cell)
        if len(cells) < 3:
            if header:
                break                      # таблица кончилась
            continue
        if header is None:
            # шапка: ищем «Наименование» и «Номенк. номер». Читаем всю полосу разом —
            # это дешевле, чем каждую ячейку, а слова видны и так
            txt = _ocr_cell(exe, img, (0, y1, w, y2), lang, 6).lower()
            if "наимен" not in txt:
                continue
            texts = [_ocr_cell(exe, img, (a, y1, b, y2), lang, 6) for a, b in cells]
            sku_i, name_i, qty_i, price_i = _which(texts)
            if sku_i is None or name_i is None:
                continue
            header = (cells, sku_i, name_i, qty_i, price_i)
            continue

        hcells, sku_i, name_i, qty_i, price_i = header
        def cell_at(i):
            if i is None:
                return None
            cx = (hcells[i][0] + hcells[i][1]) // 2
            j = _in(cells, cx)
            return cells[j] if j is not None else None
        sc, nc, qc = cell_at(sku_i), cell_at(name_i), cell_at(qty_i)
        pc = cell_at(price_i)
        if not sc or not nc:
            break
        sku = re.sub(r"\D", "", _ocr_cell(exe, img, (sc[0], y1, sc[1], y2), lang, 7, "0123456789"))
        name = _clean_name(" ".join(_ocr_cell(exe, img, (nc[0], y1, nc[1], y2), lang, 6).split()))
        if not sku or len(sku) < 5:
            if not re.search(r"[A-Za-zА-Яа-яЁё]{3}", name):
                break                      # «Итого» и подписи под таблицей
            continue
        qty = ""
        if qc:
            q = _ocr_cell(exe, img, (qc[0], y1, qc[1], y2), lang, 7, "0123456789.,")
            m = RE_QTY3.search(q) or re.search(r"(\d{1,6})", q)
            if m:
                qty = str(int(m.group(1)))
        cost = ""
        if pc:
            cost = money_value(_ocr_cell(exe, img, (pc[0], y1, pc[1], y2), lang, 7, "0123456789.,"))
        letters = len(re.findall(r"[A-Za-zА-Яа-яЁё]", name))
        if letters < 4:
            continue
        out.append({"sku": sku, "name": name[:200], "qty": qty, "cost": cost,
                    "target": "", "catId": "", "typeId": "", "supplyId": ""})
    return out


def recognize(cfg, path, max_pages=10):
    """Текст документа и способ, которым он получен: «pdf» или «ocr».

    Шестым значением — строки таблицы, прочитанные по ячейкам (только для
    сканов); если таблица по линейкам не нашлась, список пустой и строки
    берутся из текста обычным parse_rows().
    """
    cfg = merge_config(cfg)
    path = Path(path)

    if path.suffix.lower() == ".pdf":
        text, pages = pdf_text_layer(path, max_pages)
        # короткий текст у скана бывает от штампов и подписей — это ещё не слой
        if len(text.strip()) > 200:
            return text, pages, "pdf", [], 0, []

    exe = find_tesseract()
    if not exe:
        return "", 0, "none", [], 0, []
    import pytesseract
    from PIL import Image
    pytesseract.pytesseract.tesseract_cmd = exe
    # Только присваивание, не setdefault: установщик Tesseract прописывает
    # TESSDATA_PREFIX системно, и тогда наш русский словарь просто не виден —
    # проверка показывает «готово», а распознаётся латиница.
    d = tessdata_dir()
    if d:
        os.environ["TESSDATA_PREFIX"] = d

    chunks, pages, alts, angle, trows = [], 0, [], 0, []
    images = (_pdf_pages(path, cfg["dpi"]) if path.suffix.lower() == ".pdf"
              else iter([Image.open(path)]))
    for img in images:
        if pages == 0:
            # поворот определяем по первой странице и применяем ко всем
            txt, angle, alts = _best_rotation(exe, img, cfg["lang"])
            im = img if angle == 0 else img.rotate(-angle, expand=True)
        else:
            im = img if angle == 0 else img.rotate(-angle, expand=True)
            txt = _ocr_image(exe, im, cfg["lang"])
        chunks.append(txt)
        try:
            trows += table_rows(exe, im, cfg["lang"], int(cfg.get("dpi") or 300))
        except Exception:
            pass                            # таблица — улучшение, не условие
        pages += 1
        if pages >= max_pages:
            break
    return "\n".join(chunks), pages, "ocr", alts, angle, trows


# ------------------------------------------------------------------ разбор строк

# Обе формы печатаются одинаково устроенной таблицей, и в ней есть якорь, по
# которому строку видно наверняка: количество всегда с тремя знаками после
# точки («4.000»), а цены и суммы — с двумя. На этом и строим разбор, а не на
# положении колонок: у скана они всё равно разъезжаются.
RE_QTY3 = re.compile(r"(?<![\d.,])(\d{1,6})[.,](\d{3})(?![\d.,])")
RE_MONEY = re.compile(r"(?<![\d.,\-\w])\d[\d\s]*[.,]\d{2}")
RE_SKU = re.compile(r"(?<!\d)(\d{6,8})(?!\d)")
RE_DOCNUM = re.compile(
    r"Документ\s*(?:[№\u2116]|N[oO\u043e])?\s*(\d+)\s*от\s*"
    r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})", re.IGNORECASE)
RE_DATE = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})")

# Склад-получатель. У счёта-фактуры он подписан внизу, у требования-накладной
# стоит в конце строки «Получатель».
RE_WH_LABEL = re.compile(r"Склад\s*[-—–]?\s*получател\w*\s*[:：]?\s*(\d{3,6})", re.IGNORECASE)
RE_WH_RECV = re.compile(r"^\s*Получател\w*\s*[:：—-]?\s*(.+)$", re.IGNORECASE)

# Счёт бухгалтерского учёта: шестизначный с ведущим нулём. Его легко спутать
# с номенклатурным номером, поэтому пропускаем отдельно.
RE_ACCOUNT = re.compile(r"^0\d{5}$")

NOISE = ("итого", "всего", "т3р", "тзр", "ндс", "акциз", "страница", "fastreport",
         "подпись", "отпустил", "получил", "принял", "бухгалтер")


def parse_warehouse(text):
    """Номер склада-получателя."""
    for line in (text or "").splitlines():
        m = RE_WH_LABEL.search(line)
        if m:
            return m.group(1)
    for line in (text or "").splitlines():
        m = RE_WH_RECV.match(" ".join(line.split()))
        if not m:
            continue
        # «ЦЕНТРАЛЬНЫЙ СКЛАД Завод-1 5004» — номер стоит последним
        nums = re.findall(r"(?<!\d)(\d{3,6})(?!\d)", m.group(1))
        if nums:
            return nums[-1]
    return ""


# Счёт бухучёта, сразу за которым идёт номенклатурный номер, — начало строки
# таблицы. В текстовом слое PDF все строки склеиваются в одну, и без этого
# якоря из накладной читалась бы только первая позиция.
RE_ROW_START = re.compile(r"(?<!\d)0\d{5}(?!\d)\s+\d{6,8}(?!\d)")


def _split_rows(line):
    starts = [m.start() for m in RE_ROW_START.finditer(line)]
    if len(starts) < 2:
        return [line]
    return [line[a:b] for a, b in zip(starts, starts[1:] + [len(line)])]


def _first_money(rest):
    """Первая сумма, стоящая отдельным словом.

    Без этого «ALE-300 0 5 655 650.00» ловилось начиная с «300», и наименование
    обрывалось на «ALE».
    """
    for m in RE_MONEY.finditer(rest):
        before = rest[m.start() - 1] if m.start() else " "
        if before.isspace():
            return m
    return None


def money_value(s):
    """Число из денежной записи: «28 769 000.00» -> «28769000.00».

    Пробелы и неразрывные пробелы в разрядах ставят и печатные формы, и OCR;
    запятая вместо точки тоже встречается.
    """
    t = re.sub(r"[\s ]", "", str(s or ""))
    m = re.search(r"\d+(?:[.,]\d{1,2})?", t)
    if not m:
        return ""
    v = m.group(0).replace(",", ".")
    try:
        return ("%.2f" % float(v)).rstrip("0").rstrip(".") or "0"
    except ValueError:
        return ""


def _clean_name(s):
    s = re.sub(r"[|]+", " ", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" .,-|—–:;")
    return s


def parse_rows(text):
    """Строки накладной: номенклатурный номер, наименование, количество.

    Наименование — то, что между номенклатурным номером и первой суммой.
    Количество берём по трёхзначной дробной части; если её не видно (бывает на
    сканах), оставляем пустым — пользователь допишет на экране проверки.
    """
    out = []
    lines = []
    for raw in (text or "").splitlines():
        lines += _split_rows(" ".join(raw.split()))
    for line in lines:
        if len(line) < 12:
            continue
        low = line.lower()
        if any(w in low for w in NOISE):
            continue
        if not re.search(r"[A-Za-zА-Яа-яЁё]{3}", line):
            continue

        # Номенклатурный номер — последнее число перед наименованием: перед ним
        # в обеих формах стоит счёт бухучёта, и он бывает разным (001400, 108000),
        # так что отличать его по виду ненадёжно.
        name_at = re.search(r"[A-Za-zА-Яа-яЁё]{3}", line)
        head = line[:name_at.start()] if name_at else line
        nums = list(RE_SKU.finditer(head))
        if not nums:
            continue
        sku, sku_end = nums[-1].group(1), nums[-1].end()

        rest = line[sku_end:]
        money = _first_money(rest)
        name = _clean_name(rest[:money.start()] if money else rest)
        # «15] uzs» и прочий мусор со сканов: наименование короче шести знаков
        # или почти без букв — это не позиция накладной
        letters = len(re.findall(r"[A-Za-zА-Яа-яЁё]", name))
        if len(name) < 6 or letters < 4:
            continue

        qty = ""
        mq = RE_QTY3.search(rest)
        if mq:
            qty = str(int(mq.group(1)))

        # первая сумма после наименования — это «Цена в валюте», цена за единицу;
        # дальше по строке идут стоимость по строке и итог с НДС, они нам не нужны
        cost = money_value(money.group(0)) if money else ""

        out.append({"sku": sku, "name": name[:200], "qty": qty, "cost": cost,
                    "target": "", "catId": "", "typeId": "", "supplyId": ""})
    return out


RE_NUM_DATE = re.compile(r"(?<!\d)(\d{5,9})\s*от\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})")


def analyze(cfg, path, max_pages=10):
    """Полный разбор документа: текст, строки, номер, дата, склад.

    Поля берём из лучшего поворота, а чего в нём не нашлось — ищем в остальных:
    у повёрнутого скана шапка и таблица нередко читаются при разных углах.
    """
    text, pages, how, alts, angle, trows = recognize(cfg, path, max_pages)
    rows = trows or parse_rows(text)
    number, doc_date = parse_header(text)
    warehouse = parse_warehouse(text)

    for alt in alts:
        if alt is text:
            continue
        if not number or not doc_date:
            n2, d2 = parse_header(alt)
            number = number or n2
            doc_date = doc_date or d2
        if not warehouse:
            warehouse = parse_warehouse(alt)
        if not rows:
            rows = parse_rows(alt)

    return {"text": text, "pages": pages, "how": how, "angle": angle,
            "rows": rows, "number": number, "date": doc_date, "warehouse": warehouse}


def _mkdate(d, m, y):
    """Дата из трёх кусков, или None, если такой даты не бывает."""
    y = int(y)
    if y < 100:
        y += 2000
    try:
        return datetime.date(y, int(m), int(d)).isoformat()
    except ValueError:
        return None


def order_date(flat):
    """Дата из шапки — та, что стоит после «№ Заказ».

    Внизу формы есть ещё «Документ № … от …», но он читается не на всяком скане,
    а в шапке дата стоит в обеих формах накладной. Берём первую правильную дату
    в пределах строки после слова «Заказ»: дальше начинаются доверенность и
    сроки, их принимать нельзя.
    """
    m = re.search(r"заказ", flat, re.IGNORECASE)
    if not m:
        return None
    window = flat[m.end():m.end() + 120]
    for d in RE_DATE.finditer(window):
        got = _mkdate(d.group(1), d.group(2), d.group(3))
        if got:
            return got
    return None


def order_number(flat):
    """Номер из шапки — тот, что стоит после «№ Заказ».

    Заказчик просил брать именно его, а не «№ документ»: в форме они рядом,
    и снизу «Документ № … от …» даёт не тот номер. Берём первое число из
    пяти-девяти цифр в пределах строки после слова «Заказ», пропуская даты.
    """
    m = re.search(r"заказ", flat, re.IGNORECASE)
    if not m:
        return ""
    window = flat[m.end():m.end() + 80]
    # дальше шапки не лезем: за «Основанием» и «ИНН» идут чужие числа
    for stop in ("Основание", "Получател", "Отправител", "ИНН", "Доверенност"):
        i = window.find(stop)
        if i != -1:
            window = window[:i]
    # даты выкидываем, чтобы «09.09.2026» не сошло за номер
    window = RE_DATE.sub(" ", window)
    got = re.search(r"(?<!\d)(\d{5,9})(?!\d)", window)
    return got.group(1) if got else ""


def parse_header(text):
    """Номер и дата документа."""
    flat = " ".join((text or "").split())
    top = order_date(flat)
    top_num = order_number(flat)
    best = None
    for m in RE_NUM_DATE.finditer(flat):
        # ближе к слову «Документ» — вернее
        near = "документ" in flat[max(0, m.start() - 60):m.start()].lower()
        if best is None or near:
            best = m
            if near:
                break
    if best:
        # шапка вернее: «Документ № … от …» внизу есть не на каждом скане,
        # да и номер там документа, а не заказа
        return (top_num or best.group(1),
                top or _mkdate(best.group(2), best.group(3), best.group(4)))
    if top_num or top:
        return top_num, top
    head = "\n".join((text or "").splitlines()[:14])
    for m in RE_DATE.finditer(head):
        got = _mkdate(m.group(1), m.group(2), m.group(3))
        if got:
            return "", got
    return "", None
