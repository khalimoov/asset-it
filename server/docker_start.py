# -*- coding: utf-8 -*-
"""Запуск в контейнере Docker.

Отличие от serve.py: здесь нет install.bat, который создавал базу и таблицы,
поэтому всё делаем сами при каждом старте:
  1) ждём PostgreSQL — контейнер базы поднимается не мгновенно;
  2) применяем schema.sql — он целиком из create ... if not exists, повторный
     прогон ничего не ломает;
  3) дальше обычный serve.main(): миграции, заводские записи, waitress.

Настройки — переменные окружения из docker-compose.yml (PGHOST, PGPASSWORD,
DOCS_PATH). Файл .env в контейнере не нужен.
"""
import os
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

import psycopg


def wait_db(attempts=60):
    kw = dict(host=os.environ.get("PGHOST", "db"), port=os.environ.get("PGPORT", "5432"),
              dbname=os.environ.get("PGDATABASE", "asset_it"),
              user=os.environ.get("PGUSER", "asset_it"),
              password=os.environ.get("PGPASSWORD", ""))
    last = None
    for i in range(attempts):
        try:
            with psycopg.connect(**kw) as conn:
                conn.execute("select 1")
            return kw
        except Exception as e:
            last = e
            if i == 0:
                print("  жду PostgreSQL на %s:%s ..." % (kw["host"], kw["port"]))
            time.sleep(2)
    print("  PostgreSQL так и не ответил: %s" % last)
    sys.exit(1)


def apply_schema(kw):
    schema = (BASE / "schema.sql").read_text(encoding="utf-8")
    with psycopg.connect(**kw) as conn:
        conn.execute(schema)
    print("  схема базы проверена")


def main():
    if not os.environ.get("PGPASSWORD"):
        print("  Не задан PGPASSWORD — впишите пароль базы в .env рядом с docker-compose.yml")
        sys.exit(1)
    docs = os.environ.get("DOCS_PATH", "/opt/asset-it/documents")
    Path(docs).mkdir(parents=True, exist_ok=True)
    print("  архив документов: %s" % docs)

    kw = wait_db()
    apply_schema(kw)

    import serve
    serve.main()


if __name__ == "__main__":
    main()
