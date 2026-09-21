#!/bin/sh
# Сборка ОФЛАЙН-пакета Docker: образы приложения и PostgreSQL сохраняются в один
# images.tar, рядом кладутся compose, установщик и инструкция. На сервере без
# интернета остаётся docker load + docker compose up.
#
# Запускать там, где есть Docker и интернет (ноутбук с Docker Desktop, любой Linux),
# из корня репозитория или из распакованного asset-it-docker:
#
#     sh packaging/build-offline.sh                 только образы
#     sh packaging/build-offline.sh --debs noble    плюс .deb-пакеты Docker Engine
#                                                   для Ubuntu 24.04 (jammy — 22.04,
#                                                   bookworm — Debian 12), если на
#                                                   сервере Docker ещё не стоит
#
# Результат: dist/asset-it-docker-offline/ и dist/asset-it-docker-offline.tar.gz
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
# корень: там лежит Dockerfile (в репозитории — родитель packaging/, в пакете — сама папка)
if [ -f "$HERE/../Dockerfile" ]; then ROOT=$(cd "$HERE/.." && pwd)
elif [ -f "$HERE/Dockerfile" ]; then ROOT=$HERE
else echo "Не нашёл Dockerfile рядом — запускайте из репозитория или из пакета asset-it-docker"; exit 1; fi
OFF="$HERE/offline"
[ -d "$OFF" ] || OFF="$ROOT/offline"
OUT="$ROOT/dist/asset-it-docker-offline"
PG_IMAGE=postgres:16
APP_IMAGE=asset-it:latest

DEBS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --debs) DEBS="$2"; shift ;;
    *) echo "Неизвестный ключ: $1"; exit 1 ;;
  esac
  shift
done

command -v docker >/dev/null 2>&1 || { echo "Docker не найден: сборка образа требует Docker"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker не запущен (docker info не отвечает)"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT"

echo "  1/4 собираю образ $APP_IMAGE ..."
docker build -t "$APP_IMAGE" "$ROOT"

echo "  2/4 скачиваю $PG_IMAGE ..."
docker pull "$PG_IMAGE"

echo "  3/4 сохраняю образы в images.tar (это несколько минут и ~500 МБ) ..."
docker save -o "$OUT/images.tar" "$APP_IMAGE" "$PG_IMAGE"

cp "$OFF/docker-compose.yml" "$OUT/docker-compose.yml"
cp "$OFF/install.sh" "$OFF/install-docker.sh" "$OUT/"
cp "$ROOT/.env.example" "$OUT/.env.example"
cp "$OFF/УСТАНОВКА-OFFLINE.txt" "$OUT/УСТАНОВКА-OFFLINE.txt"
chmod +x "$OUT"/*.sh 2>/dev/null || true
docker image inspect "$APP_IMAGE" --format '{{.Id}}' > "$OUT/IMAGE_ID"

if [ -n "$DEBS" ]; then
  echo "  4/4 качаю .deb-пакеты Docker Engine для «$DEBS» ..."
  case "$DEBS" in
    jammy|noble|focal) DIST=ubuntu ;;
    bookworm|bullseye|trixie) DIST=debian ;;
    *) echo "  Неизвестный выпуск «$DEBS»: жду jammy, noble, focal, bookworm, bullseye или trixie"; exit 1 ;;
  esac
  BASE="https://download.docker.com/linux/$DIST/dists/$DEBS/pool/stable/amd64/"
  mkdir -p "$OUT/docker-debs"
  INDEX=$(curl -fsSL "$BASE") || { echo "  Не удалось прочитать $BASE"; exit 1; }
  for P in containerd.io docker-ce-cli docker-ce docker-buildx-plugin docker-compose-plugin; do
    F=$(echo "$INDEX" | grep -o "href=\"${P}_[^\"]*\.deb\"" | sed 's/href="//;s/"$//' | sort -V | tail -1)
    [ -n "$F" ] || { echo "  Не нашёл пакет $P в $BASE"; exit 1; }
    echo "      $F"
    curl -fsSL -o "$OUT/docker-debs/$F" "$BASE$F"
  done
  echo "$DIST $DEBS amd64" > "$OUT/docker-debs/VERSION"
else
  echo "  4/4 .deb-пакеты Docker не запрошены (ключ --debs <выпуск>) — пропускаю"
fi

echo "  упаковываю ..."
( cd "$ROOT/dist" && tar -czf asset-it-docker-offline.tar.gz asset-it-docker-offline )
SIZE=$(du -h "$ROOT/dist/asset-it-docker-offline.tar.gz" | cut -f1)
echo
echo "  Готово: dist/asset-it-docker-offline.tar.gz ($SIZE)"
echo "  На сервере: tar -xzf asset-it-docker-offline.tar.gz && cd asset-it-docker-offline && sudo sh install.sh"
