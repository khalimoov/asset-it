#!/bin/sh
# Сборка ПАКЕТА ОБНОВЛЕНИЯ для Docker: только новый код (web/ и server/),
# Dockerfile.update и update.sh. На сервере образ собирается поверх уже
# загруженного asset-it:latest — без интернета, за минуту.
#
# Docker для сборки пакета не нужен. Запускать из корня репозитория:
#
#     sh packaging/build-update.sh
#
# Номер версии берётся из server/app.py (APP_BUILD) — он же должен совпадать с
# UI_BUILD в web/static/js/core.js, иначе сборка остановится.
# Результат: dist/asset-it-update-<версия>.tar.gz
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
UPD="$ROOT/packaging/update"
cd "$ROOT"

VER=$(grep -m1 '^APP_BUILD' server/app.py | cut -d'"' -f2)
UI=$(grep -m1 '^var UI_BUILD' web/static/js/core.js | cut -d'"' -f2)
[ -n "$VER" ] || { echo "Не нашёл APP_BUILD в server/app.py"; exit 1; }
[ "$VER" = "$UI" ] || { echo "Версии расходятся: server/app.py — $VER, core.js — $UI"; exit 1; }

NAME="asset-it-update-$VER"
OUT="$ROOT/dist/$NAME"
rm -rf "$OUT"; mkdir -p "$OUT/app"

# в образ идёт ровно то же, что при полной сборке (см. .dockerignore)
tar -cf - \
    --exclude='__pycache__' --exclude='*.log' --exclude='*.dump' \
    --exclude='server/.env' --exclude='server/FIRST_LOGIN_*.txt' \
    --exclude='server/tessdata' --exclude='server/tesseract' \
    web server | tar -xf - -C "$OUT/app"

cp "$UPD/Dockerfile.update" "$UPD/update.sh" "$OUT/"
{ cat "$UPD/ОБНОВЛЕНИЕ.txt"; echo; cat "$UPD/CHANGES.txt"; } > "$OUT/ОБНОВЛЕНИЕ.txt"
printf '%s\n' "$VER" > "$OUT/VERSION"
# скрипты — с переводом строки Unix, иначе sh на сервере спотыкается о \r
sed -i 's/\r$//' "$OUT/update.sh" "$OUT/Dockerfile.update"
chmod +x "$OUT/update.sh"

tar -czf "$ROOT/dist/$NAME.tar.gz" -C "$ROOT/dist" "$NAME"
echo "  Пакет обновления: dist/$NAME.tar.gz ($(du -h "$ROOT/dist/$NAME.tar.gz" | cut -f1))"
