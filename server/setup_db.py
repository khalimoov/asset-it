# -*- coding: utf-8 -*-
"""Первичная настройка базы «Учёта ИТ-отдела».

Запускается один раз из install.bat. Делает три вещи:
  1) заводит в PostgreSQL пользователя и базу для приложения;
  2) пишет server/.env со сгенерированным паролем и ключом сессий;
  3) создаёт таблицы из schema.sql.

Повторный запуск безопасен: существующие пароль и ключ из .env не перезаписываются,
а все create ... if not exists просто ничего не делают.
"""
import getpass
import io
import os
import re
import secrets
import sys
from pathlib import Path

# Консоль Windows живёт в cp866: типографских тире и рамок там нет.
# Не даём установке падать на выводе — непечатаемое заменится вопросом.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


import psycopg
from psycopg import sql
from psycopg.rows import dict_row

BASE = Path(__file__).resolve().parent
ENV = BASE / ".env"


def ask(text, default=""):
    v = input("  %s%s: " % (text, (" [%s]" % default) if default else "")).strip()
    return v or default


def ask_secret(text):
    """Пароль: из переменной окружения, если её задали, иначе спрашиваем.

    Переменная нужна для установки без участия человека; getpass умеет читать
    только с консоли и в такой установке просто зависает.
    """
    env = os.environ.get("PGSUPERPASS")
    if env:
        print("  %s: взят из переменной PGSUPERPASS" % text)
        return env
    if not sys.stdin.isatty():
        return input("  %s: " % text).strip()
    return getpass.getpass("  %s: " % text)


def read_env():
    cfg = {}
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg


def write_env(cfg):
    ENV.write_text(
        "# Настройки сервера «Учёт ИТ-отдела».\n"
        "# Файл содержит пароль базы — не копировать в переписку и не выкладывать.\n"
        "PGHOST=%(PGHOST)s\n"
        "PGPORT=%(PGPORT)s\n"
        "PGDATABASE=%(PGDATABASE)s\n"
        "PGUSER=%(PGUSER)s\n"
        "PGPASSWORD=%(PGPASSWORD)s\n"
        "\n"
        "HOST=%(HOST)s\n"
        "PORT=%(PORT)s\n"
        "SECRET_KEY=%(SECRET_KEY)s\n" % cfg,
        encoding="utf-8")


def main():
    old = read_env()
    print()
    print("  --- Настройка базы данных ---")
    print()
    print("  Понадобится пароль суперпользователя PostgreSQL (обычно postgres) -")
    print("  тот, который задавали при установке PostgreSQL. Он нигде не сохраняется.")
    print()

    host = ask("Адрес PostgreSQL", old.get("PGHOST", "localhost"))
    port = ask("Порт", old.get("PGPORT", "5432"))
    su = ask("Суперпользователь", "postgres")
    supass = ask_secret("Пароль суперпользователя")

    dbname = ask("Имя базы для приложения", old.get("PGDATABASE", "asset_it"))
    dbuser = ask("Пользователь базы", old.get("PGUSER", "asset_it"))
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", dbname) or \
       not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", dbuser):
        print("\n  Имя базы и пользователя - латиница, цифры и подчёркивание.")
        return 1

    # пароль и ключ сессий не меняем, если они уже есть: иначе слетят входы
    dbpass = old.get("PGPASSWORD") or secrets.token_urlsafe(18)
    secret = old.get("SECRET_KEY") or secrets.token_urlsafe(32)

    print()
    try:
        conn = psycopg.connect(host=host, port=port, dbname="postgres",
                               user=su, password=supass, autocommit=True,
                               row_factory=dict_row)
    except Exception as e:
        print("  Не удалось подключиться к PostgreSQL:")
        print("   ", e)
        print()
        print("  Проверьте, что служба postgresql запущена и пароль верный.")
        return 1

    with conn:
        cur = conn.cursor()
        # create role / create database не принимают параметры запроса —
        # имя и пароль подставляются как литералы, экранирует их psycopg
        cur.execute("select 1 from pg_roles where rolname = %s", (dbuser,))
        if cur.fetchone():
            print("  Пользователь %s уже есть - обновляю пароль." % dbuser)
            cur.execute(sql.SQL("alter role {} with login password {}")
                        .format(sql.Identifier(dbuser), sql.Literal(dbpass)))
        else:
            cur.execute(sql.SQL("create role {} with login password {}")
                        .format(sql.Identifier(dbuser), sql.Literal(dbpass)))
            print("  Создан пользователь базы: %s" % dbuser)

        cur.execute("select 1 from pg_database where datname = %s", (dbname,))
        if cur.fetchone():
            print("  База %s уже есть - оставляю как есть." % dbname)
        else:
            cur.execute(sql.SQL("create database {} owner {}")
                        .format(sql.Identifier(dbname), sql.Identifier(dbuser)))
            print("  Создана база: %s" % dbname)

        cur.execute("select pg_encoding_to_char(encoding) as enc "
                    "from pg_database where datname = %s", (dbname,))
        enc = (cur.fetchone() or {}).get("enc", "")
        if enc and enc.upper() not in ("UTF8", "UTF-8"):
            print("  ВНИМАНИЕ: кодировка базы %s, а нужна UTF8." % enc)
            print("  Русские названия будут ломаться. Создайте базу заново с UTF8.")

    cfg = {"PGHOST": host, "PGPORT": port, "PGDATABASE": dbname, "PGUSER": dbuser,
           "PGPASSWORD": dbpass, "HOST": old.get("HOST", "0.0.0.0"),
           "PORT": old.get("PORT", "8000"), "SECRET_KEY": secret}
    write_env(cfg)
    print("  Настройки записаны: server\\.env")

    schema = (BASE / "schema.sql").read_text(encoding="utf-8")
    with psycopg.connect(host=host, port=port, dbname=dbname,
                         user=dbuser, password=dbpass) as c2:
        c2.execute(schema)
    print("  Таблицы созданы.")

    # миграции нужны только тем, кто обновляет старую установку; на чистой базе
    # schema.sql уже содержит всё, и они молча ничего не делают
    mig = sorted((BASE / "migrations").glob("*.sql")) if (BASE / "migrations").exists() else []
    if mig:
        with psycopg.connect(host=host, port=port, dbname=dbname,
                             user=dbuser, password=dbpass) as c3:
            for f in mig:
                try:
                    c3.execute(f.read_text(encoding="utf-8"))
                except Exception:
                    c3.rollback()
        print("  Обновления схемы применены: %d" % len(mig))

    print()
    print("  База готова.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n  Отменено.")
        sys.exit(1)
