#!/bin/sh
# Учёт ИТ-отдела — обновление в Docker без интернета и без полного образа.
#
# Запуск:  sudo sh update.sh                  папку установки найдёт сам
#          sudo sh update.sh /путь/к/папке    где лежит docker-compose.yml
#
# Делает: проверяет, что хватает уже загруженного образа (библиотеки те же),
# снимает копию базы, запоминает текущий образ для отката, собирает новый
# поверх него (только web/ и server/), пересоздаёт контейнер app и ждёт, пока
# откроется страница новой версии. База и документы не трогаются.
set -e
cd "$(dirname "$0")"
PKG=$(pwd)
VER=$(cat "$PKG/VERSION")
IMG=asset-it:latest
KEEP="asset-it:before-$VER"

say(){ echo "  $*"; }
fail(){ echo; say "ОШИБКА: $*"; echo; exit 1; }

echo
echo "  ============================================"
echo "    Учёт ИТ-отдела — обновление до версии $VER"
echo "  ============================================"
echo

command -v docker >/dev/null 2>&1 || fail "Docker не установлен."
docker compose version >/dev/null 2>&1 || fail "Нет плагина docker compose."
docker image inspect "$IMG" >/dev/null 2>&1 || \
  fail "Образ $IMG не найден. Пакет обновления ставится поверх уже установленного
         приложения — сначала поставьте полный офлайн-пакет (install.sh)."

# --- где установлено: папка, из которой запущен контейнер app
DIR="$1"
if [ -z "$DIR" ]; then
  for C in $(docker ps -aq --filter "label=com.docker.compose.service=app"); do
    if [ "$(docker inspect -f '{{.Config.Image}}' "$C")" = "$IMG" ]; then
      DIR=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$C")
      break
    fi
  done
fi
if [ -z "$DIR" ] && [ -f /opt/asset-it/asset-it-docker-offline/docker-compose.yml ]; then
  DIR=/opt/asset-it/asset-it-docker-offline
fi
[ -n "$DIR" ] && [ -f "$DIR/docker-compose.yml" ] || \
  fail "Не нашёл папку установки. Укажите её:  sudo sh update.sh /opt/asset-it/asset-it-docker-offline"
say "Папка установки: $DIR"

# --- что стоит сейчас
CUR=$(docker run --rm --entrypoint grep "$IMG" -m1 '^APP_BUILD' /app/server/app.py | cut -d'"' -f2)
say "Сейчас установлена версия: ${CUR:-неизвестно}"

# --- хватает ли библиотек в образе: requirements.txt должен совпадать
docker run --rm --entrypoint cat "$IMG" /app/server/requirements.txt | tr -d '\r' > /tmp/asset-it-req.old
tr -d '\r' < "$PKG/app/server/requirements.txt" > /tmp/asset-it-req.new
if ! cmp -s /tmp/asset-it-req.old /tmp/asset-it-req.new; then
  rm -f /tmp/asset-it-req.old /tmp/asset-it-req.new
  fail "В версии $VER другие библиотеки Python — пакетом обновления её не поставить.
         Нужен полный офлайн-пакет (asset-it-docker-offline.tar.gz, install.sh)."
fi
rm -f /tmp/asset-it-req.old /tmp/asset-it-req.new
say "Библиотеки в образе подходят."

cd "$DIR"

# --- копия базы
BK="$DIR/backup-before-$VER-$(date +%Y%m%d-%H%M%S).dump"
say "Копия базы: $BK"
# </dev/null: иначе exec заберёт себе остаток ввода (например, скрипт, поданный через stdin)
docker compose exec -T db pg_dump -U asset_it -F c asset_it > "$BK" </dev/null || fail "pg_dump не прошёл — обновление остановлено."
[ -s "$BK" ] || fail "Копия базы пустая — обновление остановлено."

# --- текущий образ — для отката. Повторный запуск того же обновления прежний
#     не перезаписывает: собираем снова от него же.
if docker image inspect "$KEEP" >/dev/null 2>&1; then
  say "Образ для отката уже есть: $KEEP"
else
  docker tag "$IMG" "$KEEP"
  say "Прежний образ сохранён как $KEEP"
fi

# --- сборка: только наш код поверх прежнего образа, из сети ничего не берётся
say "Собираю образ $VER ..."
docker build -f "$PKG/Dockerfile.update" --build-arg BASE="$KEEP" -t "$IMG" "$PKG" >/tmp/asset-it-build.log 2>&1 || {
  tail -20 /tmp/asset-it-build.log; fail "Образ не собрался (журнал: /tmp/asset-it-build.log). Работает прежняя версия."; }

# --- перезапуск только приложения; схема базы доводится при старте сама
say "Перезапускаю приложение ..."
docker compose up -d --no-deps app

# --- ждём страницу новой версии
OK=""
i=0
while [ $i -lt 60 ]; do
  if docker compose exec -T app python - <<'PY' 2>/dev/null | grep -q "?v=$VER"
import urllib.request
try:
    print(urllib.request.urlopen("http://127.0.0.1:8020/", timeout=3).read().decode("utf-8", "replace"))
except Exception:
    pass
PY
  then OK=1; break; fi
  i=$((i + 2)); sleep 2
done

echo
if [ -n "$OK" ]; then
  say "Готово: работает версия $VER."
else
  say "Приложение не ответило за минуту. Посмотрите журнал:  cd $DIR && docker compose logs --tail 50 app"
fi
echo
say "Откат на прежнюю версию (код и база вместе):"
say "  cd $DIR"
say "  docker tag $KEEP $IMG && docker compose up -d --no-deps app"
say "  docker compose exec -T db pg_restore -U asset_it -d asset_it -c < $BK"
echo
[ -n "$OK" ] || exit 1
