# -*- coding: utf-8 -*-
"""Собирает пакет для установки на сервер без интернета.

    python packaging/build.py            собрать dist/asset-it-server и zip
    python packaging/build.py --no-zip   только папку

Что складывается:

    it-inventory.html   страница приложения
    server/             сервер, схема, миграции
    packaging/*.bat     установка, запуск, остановка, копии базы
    packaging/УСТАНОВКА.txt
    wheels/             библиотеки Python под Windows x64

Колёса берутся из уже собранного пакета, если он есть; иначе качаются через pip —
для этого нужен интернет на той машине, где собирают. На сервере интернет не нужен.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "packaging"
OUT = ROOT / "dist" / "asset-it-server"

# то, что ставится в окружение сервера
REQUIREMENTS = ["flask", "psycopg[binary]", "waitress", "ldap3",
                "pypdfium2", "pytesseract", "pillow"]

# Языковые данные Tesseract: сам движок ставится на сервере отдельно, а словари
# едут с пакетом — качать их на сервере без интернета неоткуда.
TESSDATA = ("rus", "eng")
TESSDATA_URL = "https://github.com/tesseract-ocr/tessdata/raw/main/%s.traineddata"

# Установщик самого движка: на сервере без интернета winget бесполезен,
# поэтому кладём .exe рядом и ставим с него.
TESSERACT_EXE = "tesseract-ocr-setup.exe"
TESSERACT_URL = ("https://github.com/UB-Mannheim/tesseract/releases/download/"
                 "v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe")

# из server/ берём только исходники, без настроек и служебных файлов
SERVER_SKIP = {".env", "__pycache__"}


def copy_server():
    dst = OUT / "server"
    dst.mkdir(parents=True, exist_ok=True)
    for f in (ROOT / "server").iterdir():
        if f.name in SERVER_SKIP or f.name.startswith("FIRST_LOGIN") or f.suffix == ".log":
            continue
        if f.is_dir():
            if f.name == "migrations":
                shutil.copytree(f, dst / f.name, dirs_exist_ok=True)
            continue        # tessdata кладёт ensure_tessdata
        shutil.copy2(f, dst / f.name)
    print("  server/ — скопирован")


def copy_packaging():
    for f in PKG.iterdir():
        if f.suffix in (".bat",) or f.name.endswith(".txt"):
            shutil.copy2(f, OUT / f.name)
    print("  .bat и инструкция — скопированы")


def ensure_wheels():
    wheels = OUT / "wheels"
    if wheels.exists() and any(wheels.glob("*.whl")):
        print("  wheels/ — уже собраны, оставляю как есть")
        return
    wheels.mkdir(parents=True, exist_ok=True)
    print("  wheels/ — качаю через pip (нужен интернет) ...")
    subprocess.run([sys.executable, "-m", "pip", "download", *REQUIREMENTS,
                    "-d", str(wheels), "--only-binary=:all:"], check=True)


def ensure_tessdata():
    """Словари для распознавания: сначала из репозитория, иначе качаем."""
    src = ROOT / "server" / "tessdata"
    dst = OUT / "server" / "tessdata"
    dst.mkdir(parents=True, exist_ok=True)
    import urllib.request
    for lang in TESSDATA:
        name = lang + ".traineddata"
        if (dst / name).exists():
            continue
        if (src / name).exists():
            shutil.copy2(src / name, dst / name)
            continue
        print("  tessdata/%s — качаю (нужен интернет) ..." % name)
        urllib.request.urlretrieve(TESSDATA_URL % lang, dst / name)
    got = sorted(f.name for f in dst.glob("*.traineddata"))
    print("  tessdata/ — %s" % ", ".join(got))


def ensure_tesseract():
    """Установщик движка распознавания — в пакет, чтобы ставить без интернета."""
    dst = OUT / "tesseract"
    dst.mkdir(parents=True, exist_ok=True)
    f = dst / TESSERACT_EXE
    if f.exists() and f.stat().st_size > 10 * 1024 * 1024:
        print("  tesseract/ — установщик уже на месте")
        return
    import urllib.request
    print("  tesseract/ — качаю установщик, 48 МБ (нужен интернет) ...")
    urllib.request.urlretrieve(TESSERACT_URL, f)
    print("  tesseract/%s — %.0f МБ" % (TESSERACT_EXE, f.stat().st_size / 1024 / 1024))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "it-inventory.html", OUT / "it-inventory.html")
    print("  it-inventory.html — скопирован")
    copy_server()
    copy_packaging()
    ensure_wheels()
    ensure_tessdata()
    ensure_tesseract()

    # настройки прошлой установки в пакет не попадают
    for junk in (OUT / "server" / ".env",):
        if junk.exists():
            junk.unlink()

    if "--no-zip" not in sys.argv:
        zip_path = ROOT / "dist" / "asset-it-server"
        shutil.make_archive(str(zip_path), "zip", str(ROOT / "dist"), "asset-it-server")
        size = (ROOT / "dist" / "asset-it-server.zip").stat().st_size
        print("  архив: dist/asset-it-server.zip (%.1f МБ)" % (size / 1024 / 1024))
    print()
    print("Готово.")


if __name__ == "__main__":
    main()
