#!/bin/sh
# Учёт ИТ-отдела — установка из офлайн-пакета (сервер без интернета).
# Запуск:  sudo sh install.sh
# Делает: загружает образы из images.tar, заводит папку документов и .env,
# поднимает контейнеры. Повторный запуск безопасен — обновляет образы и перезапускает.
set -e
cd "$(dirname "$0")"

echo
echo "  ============================================"
echo "    Учёт ИТ-отдела — установка в Docker (офлайн)"
echo "  ============================================"
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "  Docker не установлен."
  echo "  Поставьте его из папки docker-debs:  sudo sh install-docker.sh"
  echo "  (или любым другим способом), затем запустите install.sh снова."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "  Нет плагина docker compose. На Ubuntu/Debian он в пакете docker-compose-plugin"
  echo "  (лежит в docker-debs, ставится через install-docker.sh)."
  exit 1
fi

if [ ! -f images.tar ]; then
  echo "  Не найден images.tar рядом с install.sh — пакет неполный."
  exit 1
fi
echo "  Загружаю образы из images.tar (asset-it и postgres) ..."
docker load -i images.tar
echo

mkdir -p /opt/asset-it/documents
echo "  Папка документов: /opt/asset-it/documents"

if [ ! -f .env ]; then
  PW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)
  sed "s/^PGPASSWORD=.*/PGPASSWORD=$PW/" .env.example > .env
  chmod 600 .env
  echo "  Создан .env со случайным паролем базы (он нужен только контейнерам)."
else
  echo "  Файл .env уже есть — оставляю как есть."
  # Прежние версии ставились на 8000. Теперь приложение работает на 8020: старый
  # порт по умолчанию переводим, а свой, выбранный руками, не трогаем.
  if grep -q '^PORT=8000$' .env; then
    sed -i 's/^PORT=8000$/PORT=8020/' .env
    echo "  Порт в .env сменён с 8000 на 8020."
  fi
fi
echo

docker compose up -d
echo
echo "  Контейнеры запущены. Состояние:"
docker compose ps
echo
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PORT=$(grep '^PORT=' .env | cut -d= -f2)
echo "  Откройте в браузере:  http://${IP:-адрес-сервера}:${PORT:-8020}"
echo "  Первый запуск: страница попросит задать имя, логин и пароль администратора."
echo "  Журнал:  docker compose logs -f app"
echo
