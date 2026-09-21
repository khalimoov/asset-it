#!/bin/sh
# Установка Docker Engine из .deb-пакетов в папке docker-debs (Ubuntu/Debian без интернета).
# Пакеты кладёт сборщик build-offline.sh под конкретный выпуск ОС — см. файл
# docker-debs/VERSION: он должен совпадать с выпуском на сервере (lsb_release -cs).
# Запуск:  sudo sh install-docker.sh
set -e
cd "$(dirname "$0")"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "  Docker и compose уже установлены: $(docker --version)"
  exit 0
fi
if [ ! -d docker-debs ] || ! ls docker-debs/*.deb >/dev/null 2>&1; then
  echo "  В папке docker-debs нет пакетов. Соберите пакет с ключом --debs <выпуск>,"
  echo "  например:  sh build-offline.sh --debs noble   (Ubuntu 24.04)"
  exit 1
fi
if [ -f docker-debs/VERSION ]; then
  echo "  Пакеты собраны для: $(cat docker-debs/VERSION)"
  echo "  Этот сервер:        $(lsb_release -cs 2>/dev/null || . /etc/os-release && echo "$VERSION_CODENAME")"
fi
echo "  Ставлю Docker из docker-debs ..."
dpkg -i docker-debs/*.deb || apt-get -f install -y --no-download 2>/dev/null || true
systemctl enable --now docker
if [ -n "$SUDO_USER" ]; then
  usermod -aG docker "$SUDO_USER" && echo "  Пользователь $SUDO_USER добавлен в группу docker (перезайдите в систему)."
fi
echo "  Готово: $(docker --version)"
docker compose version
