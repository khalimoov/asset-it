# -*- coding: utf-8 -*-
"""Акт на списание расходных материалов — заполнение шаблона Word.

Шаблон `act_template.docx` сделан из файла заказчика (`расходники.docx`) и
менять его содержимое мы не вправе: шапка, четыре сотрудника с должностями,
строка «УДОСТОВЕРЯЕТ, что, полученные по требованию №» и подписи внизу
остаются как есть. Подставляется только то, что знает учёт: месяц и год в
шапке, номер и дата акта и сам список материалов. Номер требования и дату к
строке «УДОСТОВЕРЯЕТ…» дописывают руками — в учёте их нет.

Библиотека для Word не нужна: .docx — это zip с XML, а работы здесь на
несколько замен текста и размножение одного абзаца. Лишняя зависимость в
офлайн-пакете обошлась бы дороже.
"""
import io
import os
import re
import zipfile

MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль",
          "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]

# Встроенный образец: с него начинали и он же остаётся запасным, пока
# учреждение не завело свой шаблон в справочнике «Шаблоны актов».
SAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "act_template.docx")

MARKS = ["{{МЕСЯЦ}}", "{{ГОД}}", "{{НОМЕР}}", "{{ДАТА}}", "{{СТРОКА}}"]


def sample():
    """Байты встроенного образца."""
    if not os.path.exists(SAMPLE):
        raise ValueError("Встроенный образец акта не найден: " + SAMPLE)
    with open(SAMPLE, "rb") as f:
        return f.read()


def marks_of(data):
    """Какие метки есть в файле. Заодно проверка, что это вообще .docx."""
    try:
        doc = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")
    except Exception:
        raise ValueError("Это не файл Word (.docx) или он повреждён")
    return [m for m in MARKS if m in doc]


def check(data):
    """Годится ли файл в шаблоны. Без {{СТРОКА}} акт остался бы без списка."""
    marks = marks_of(data)
    if "{{СТРОКА}}" not in marks:
        raise ValueError("В шаблоне нет метки {{СТРОКА}} — некуда подставлять список "
                         "материалов. Возьмите за основу образец.")
    return marks


def esc(s):
    """Текст внутри XML: без этого «&» или «<» в названии материала ломают файл."""
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def place_label(division, department, warehouse):
    """Куда ушло: подразделение и отдел, а если их нет — хотя бы склад."""
    parts = [x for x in (division, department) if x]
    if parts:
        return ", ".join(parts)
    return ("склад " + warehouse) if warehouse else "место не указано"


def material_line(name, sku, unit, total, places):
    """Строка списка.

    «Чернила Epson m3170 ном. № 7523878 в количестве 8 шт. Завод-1,
    Бухгалтерия — 5 шт.; Завод-1, ООТиЗ — 3 шт.»

    Слово «использован» заказчик просил убрать: в разных строках оно вставало
    бы то в мужском, то в женском роде, а дописать его руками проще.

    Номенклатуры может не быть (материал завели руками) — тогда и «ном. №»
    в строке не появляется.
    """
    unit = unit or "шт"
    s = name or "—"
    if sku:
        s += " ном. № " + sku
    s += " в количестве %s %s." % (total, unit)
    used = "; ".join("%s — %s %s." % (p["place"], p["qty"], unit) for p in places)
    if used:
        s += " " + used
    return s


def _para_with(doc, token):
    """Границы абзаца, внутри которого лежит метка.

    Ищем начало абзаца назад от метки. Просто `rindex("<w:p")` не годится:
    так же начинается `<w:pPr>`, а у абзаца без свойств тег выглядит как
    `<w:p>` — поэтому проверяем следующий знак.
    """
    at = doc.index(token)
    i = at
    while True:
        i = doc.rindex("<w:p", 0, i)
        nxt = doc[i + 4:i + 5]
        if nxt in (">", " "):
            break
    end = doc.index("</w:p>", at) + len("</w:p>")
    return i, end


def build(number, date, lines, template=None):
    """Готовый .docx байтами.

    number — номер акта как его завели в учёте, date — datetime.date,
    lines — уже собранные строки списка, template — байты шаблона (нет —
    берётся встроенный образец).
    """
    src = zipfile.ZipFile(io.BytesIO(template if template is not None else sample()))
    doc = src.read("word/document.xml").decode("utf-8")

    start, end = _para_with(doc, "{{СТРОКА}}")
    row_para = doc[start:end]
    # абзац-образец размножаем по числу материалов; нумерация в списке своя,
    # её ведёт сам Word — в шаблоне у абзаца стоит numPr
    rows = "".join(row_para.replace("{{СТРОКА}}", esc(t)) for t in lines) \
        or row_para.replace("{{СТРОКА}}", "")
    doc = doc[:start] + rows + doc[end:]

    doc = (doc.replace("{{МЕСЯЦ}}", esc(MONTHS[date.month - 1]))
              .replace("{{ГОД}}", esc(date.year))
              .replace("{{НОМЕР}}", esc(number))
              .replace("{{ДАТА}}", esc(date.strftime("%d.%m.%Y"))))

    buf = io.BytesIO()
    out = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename == "word/document.xml":
            data = doc.encode("utf-8")
        out.writestr(item, data)
    out.close()
    src.close()
    return buf.getvalue()


# ------------------------------------------------- наклейки «Номенклатура»

NOM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nom_template.docx")

# Мельче 8 пт название типа не делаем: заказчик выбрал «номер и склад 11 пт, тип
# 8-9 пт». Ширина блока в шаблоне подобрана так, чтобы настоящие названия из учёта
# в эти два кегля укладывались; что не влезло и в 8 пт — режется с многоточием.
NOM_MIN_PT = 8.0


def _int(doc, pattern, default=0):
    m = re.search(pattern, doc)
    try:
        return int(m.group(1)) if m else default
    except ValueError:
        return default


# Шрифт наклейки — Times New Roman (он задан стилем в шаблоне заказчика).
# Меряем ширину строки настоящими метриками шрифта: прежняя оценка «знак равен
# половине кегля» врала почти на пятую часть, из-за неё название типа уезжало на
# четыре строки вместо двух. Pillow в проекте уже есть — он читает накладные.
FONTS = [r"C:\Windows\Fonts\times.ttf",
         "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf",
         "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"]
# Номер и склад набраны жирным, а он шире обычного примерно на пятую часть:
# мерили обычным — и «0117 Центральный склад РУ «Северное»» уезжал на вторую строку
FONTS_BOLD = [r"C:\Windows\Fonts\timesbd.ttf",
              "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"]
_font_cache = {}


def _font(pt, bold=False):
    """Шрифт нужного кегля или None, если ни одного файла не нашлось."""
    key = (int(pt * 4), bool(bold))
    if key in _font_cache:
        return _font_cache[key]
    f = None
    try:
        from PIL import ImageFont
        for path in (FONTS_BOLD if bold else FONTS):
            if os.path.exists(path):
                # берём вчетверо крупнее и потом делим: так меньше ошибка округления
                f = ImageFont.truetype(path, key[0])
                break
    except Exception:
        f = None
    _font_cache[key] = f
    return f


def text_twips(text, pt, bold=False):
    """Ширина строки в твипах (1 пункт = 20 твипов)."""
    f = _font(pt, bold)
    if f is not None:
        return f.getlength(text) / 4.0 * 20.0
    # шрифта под рукой нет (бывает в контейнере) — считаем с запасом, чтобы
    # скорее уменьшить кегль, чем получить лишнюю строку
    return len(text) * pt * 20.0 * (0.66 if bold else 0.58)


def _fits(text, width, pt, bold=False):
    return text_twips(text, pt, bold) <= width


def _cut_to_width(text, width, pt, bold=False):
    """Самый длинный кусок текста с начала, который влезает в строку.

    Ищем делением пополам: перебор по одному знаку на длинных названиях
    оборачивался десятками тысяч замеров и подвешивал запрос.
    """
    if _fits(text, width, pt, bold):
        return len(text)
    lo, hi = 1, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if _fits(text[:mid], width, pt, bold):
            lo = mid
        else:
            hi = mid - 1
    return max(1, lo)


def wrap_twips(text, width, pt, limit=0, bold=False):
    """Раскладывает текст по строкам указанной ширины. Рвём по пробелам и «/».

    limit — сколько строк максимум нужно вызывающему: дальше считать незачем,
    и на длинном тексте это экономит время.
    """
    out, cur = [], ""
    for part in re.split(r"(?<=[ /])", " ".join((text or "").split())):
        if not part:
            continue
        probe = cur + part
        if cur and not _fits(probe.rstrip(), width, pt, bold):
            out.append(cur.rstrip())
            cur = part
        else:
            cur = probe
        while not _fits(cur.rstrip(), width, pt, bold) and len(cur) > 1:
            n = _cut_to_width(cur, width, pt, bold)   # слово шире строки — режем его
            out.append(cur[:n])
            cur = cur[n:]
        if limit and len(out) > limit:
            return out
    if cur.strip():
        out.append(cur.rstrip())
    return out or [""]


def fit_text(text, width, max_pt, lines=2, min_pt=5.0, bold=False):
    """Название типа целиком в заданное число строк: уменьшаем кегль, пока влезает.

    Заказчик просил «уложить на 2 строки и полностью». Ширина наклейки задана его
    же формой, поэтому единственное, чем можно двигать, — размер шрифта. Совсем
    длинное название не влезает и в мелком кегле: тогда режем и ставим многоточие.
    """
    text = " ".join((text or "").split())
    if not text:
        return [""], float(max_pt)
    pt = float(max_pt)
    while pt >= min_pt:
        got = wrap_twips(text, width, pt, limit=lines, bold=bold)
        if len(got) <= lines:
            return got, pt
        pt -= 0.5
    # Не влезло ни в один кегль — режем, но **крупным**: в образце заказчика
    # обрезанное название набрано обычным размером, а не самым мелким.
    got = wrap_twips(text, width, max_pt, limit=lines, bold=bold)[:lines]
    tail = got[-1]
    while tail and not _fits(tail + "...", width, max_pt, bold):
        tail = tail[:-1]
    got[-1] = tail.rstrip() + "..."
    return got, float(max_pt)


def line_width(doc):
    """Ширина строки названия типа в твипах — по самому шаблону.

    Наклейка уже листа: у абзаца с `{{ТИП}}` стоит отступ справа, он и задаёт
    ширину, которую заказчик показал в своём файле.
    """
    w = _int(doc, r'<w:pgSz[^>]*w:w="(\d+)"', 11906)
    left = _int(doc, r'<w:pgMar[^>]*w:left="(\d+)"', 1134)
    right = _int(doc, r'<w:pgMar[^>]*w:right="(\d+)"', 1134)
    at = doc.find("{{ТИП}}")
    near = doc[max(0, at - 400):at] if at > 0 else ""
    ind = _int(near, r'<w:ind[^>]*w:right="(\d+)"', 0)
    return max(500, w - left - right - ind)


def _resize(para, pt):
    """Ставит абзацу нужный кегль (в половинах пункта, как в Word)."""
    half = max(2, int(round(pt * 2)))
    return re.sub(r'<w:sz(Cs)? w:val="\d+"/>',
                  lambda m: '<w:sz%s w:val="%d"/>' % (m.group(1) or "", half), para)


def build_nom(rows, template=None):
    """Наклейки: инвентарный номер, название типа, склад — по строке на запись."""
    if template is None:
        if not os.path.exists(NOM):
            raise ValueError("Шаблон «Номенк.» не найден: " + NOM)
        with open(NOM, "rb") as f:
            template = f.read()
    src = zipfile.ZipFile(io.BytesIO(template))
    doc = src.read("word/document.xml").decode("utf-8")

    s_inv, e_inv = _para_with(doc, "{{ИНВ}}")
    s_typ, e_typ = _para_with(doc, "{{ТИП}}")
    s_wh, e_wh = _para_with(doc, "{{СКЛАД}}")
    p_inv, p_typ, p_wh = doc[s_inv:e_inv], doc[s_typ:e_typ], doc[s_wh:e_wh]
    # пустой абзац-разделитель идёт сразу за складом
    gap_end = doc.find("</w:p>", e_wh)
    gap = doc[e_wh:gap_end + len("</w:p>")] if gap_end > 0 else ""
    width = line_width(doc)
    base_pt = _int(p_typ, r'<w:sz w:val="(\d+)"', 18) / 2.0
    inv_pt = _int(p_inv, r'<w:sz w:val="(\d+)"', 22) / 2.0
    wh_pt = _int(p_wh, r'<w:sz w:val="(\d+)"', 22) / 2.0

    def one_line(proto, mark, text, base):
        """Номер и склад — строго в одну строку: не влезает, уменьшаем кегль.

        Оба выровнены по центру наклейки, и перенос выглядел бы как вторая
        строка посередине — заказчик просил этого не допускать.
        """
        got, pt = fit_text(text, width, base, lines=1, min_pt=NOM_MIN_PT,
                           bold="<w:b/>" in proto)
        return _resize(proto.replace(mark, esc(got[0])), pt)

    body = []
    for r in rows:
        body.append(one_line(p_inv, "{{ИНВ}}", r.get("inv") or "", inv_pt))
        lines, pt = fit_text(r.get("type") or "", width, base_pt, min_pt=NOM_MIN_PT,
                             bold="<w:b/>" in p_typ)
        for ln in lines:
            body.append(_resize(p_typ.replace("{{ТИП}}", esc(ln)), pt))
        body.append(one_line(p_wh, "{{СКЛАД}}", r.get("warehouse") or "", wh_pt))
        body.append(gap)
    doc = doc[:s_inv] + "".join(body) + doc[e_wh + len(gap):]

    buf = io.BytesIO()
    out = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename == "word/document.xml":
            data = doc.encode("utf-8")
        out.writestr(item, data)
    out.close()
    src.close()
    return buf.getvalue()


def file_name(number, date):
    """Имя файла для скачивания; косую черту в номере (45/2026) браузер не примет."""
    num = re.sub(r"[\\/:*?\"<>|]", "-", str(number or "")).strip()
    return "Акт %s от %s.docx" % (num or "б-н", date.strftime("%d.%m.%Y"))
