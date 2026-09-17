# -*- coding: utf-8 -*-
"""
Сервер «Учёт ИТ-отдела»: PostgreSQL + вход по логину + права доступа.

Запуск:  python app.py
Настройки берутся из файла .env рядом со скриптом.
"""

import os
import sys
import json
import secrets
import hashlib
import datetime
import functools
import threading
import time
import traceback
from pathlib import Path

# Консоль Windows живёт в cp866: типографских кавычек и тире там нет.
# Пусть непечатаемое заменяется вопросом, а не роняет запуск.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


import psycopg
from psycopg.rows import dict_row
from flask import Flask, request, jsonify, make_response, send_from_directory

import adsync
import netscan

# Версия сборки. Должна совпадать с UI_BUILD в it-inventory.html: если файлы
# обновили, а сервер не перезапустили, приложение об этом само скажет.
APP_BUILD = "2026-09-16.3"

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent


# ------------------------------------------------------------------ настройки

def load_env():
    cfg = {}
    f = BASE / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    for k, v in cfg.items():
        os.environ.setdefault(k, v)
    return cfg


ENV = load_env()
DSN = "host={} port={} dbname={} user={} password={}".format(
    os.environ.get("PGHOST", "localhost"),
    os.environ.get("PGPORT", "5432"),
    os.environ.get("PGDATABASE", "asset_it"),
    os.environ.get("PGUSER", "asset_it"),
    os.environ.get("PGPASSWORD", ""),
)
SESSION_DAYS = 30
COOKIE = "asset_it_session"

app = Flask(__name__, static_folder=None)


def db():
    return psycopg.connect(DSN, row_factory=dict_row)


# ------------------------------------------------------------------ пароли

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$" + salt.hex() + "$" + key.hex()


def check_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, key_hex = (stored or "").split("$")
        if algo != "scrypt":
            return False
        key = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
                             n=2 ** 14, r=8, p=1, dklen=32)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


# ------------------------------------------------------------------ права

PERMS = [
    ("admin",           "Полный доступ и админ-панель"),
    ("staff.manage",    "Сотрудники ИТ и роли"),
    ("users.manage",    "Пользователи, подразделения, отделы"),
    ("registry.manage", "Настройка разделов, категорий, типов, характеристик"),
    ("ip.manage",       "Диапазоны и резерв IP-адресов"),
    ("supply.receive",  "Приход расходных материалов"),
    ("supply.issue",    "Списание материалов на сотрудников"),
    ("repair.send",     "Отправлять оборудование в ремонт"),
    ("repair.close",    "Выводить из ремонта: готово / в эксплуатацию"),
    ("repair.assign",   "Назначать мастера"),
    ("item.writeoff",   "Списывать оборудование"),
    ("deletions.view",  "Журнал удалений: кто что удалил"),
    ("org.manage",      "Учреждения: создание и выдача доступа"),
    ("org.viewall",     "Видеть все учреждения: сводки и списки"),
]
PERM_CODES = [p[0] for p in PERMS]

SEED_ROLES = [
    ("role_admin", "Администратор", "Полный доступ ко всему", ["admin"], "edit", 0),
    ("role_master", "Мастер", "Ремонтирует технику: принимает и возвращает",
     ["repair.send", "repair.close", "supply.issue"], "edit", 1),
    ("role_it", "Сотрудник ИТ", "Ведёт учёт, отправляет в ремонт",
     ["repair.send", "supply.issue", "supply.receive", "users.manage"], "edit", 2),
    ("role_view", "Только просмотр", "Видит данные, ничего не меняет", [], "view", 3),
]

SEED_REGISTRIES = [
    ("equipment", "ПК и сетевое оборудование", "▣", "assets", 0),
    ("ipphone",   "IP-телефоны",                "☎", "assets", 1),
    ("supplies",  "Расходные материалы",        "❏", "supplies", 2),
    ("radio",     "Рации",                      "≈", "assets", 3),
]
# «На списание» — техника ждёт решения комиссии, месяцами; списанной её
# называть ещё нельзя, а в эксплуатации её уже нет.
DEF_STATUSES = ["В эксплуатации", "На складе", "В ремонте", "Готово к эксплуатации",
                "На списание", "Списано"]
DEF_LAYOUT = {"subs": True, "specs": True, "presets": True, "dash": True}
DEF_UNITS = ["шт", "компл", "уп", "л", "мл", "кг", "м"]


def perms_of(row) -> set:
    """Набор прав сотрудника: из роли; admin открывает всё."""
    p = set(row.get("perms") or [])
    if "admin" in p:
        return set(PERM_CODES)
    return p


ORG_COOKIE = "asset_it_org"


def sees_all_orgs(user):
    """Кому видны все учреждения: администратору и начальнику с правом просмотра."""
    p = user["perms"]
    return "admin" in p or "org.viewall" in p or "org.manage" in p


def orgs_of(user):
    """Учреждения, доступные сотруднику.

    Обычный сотрудник обслуживает ровно одно — оно записано в его карточке.
    Администратору и тем, кому выдано «видеть все учреждения», видны все.
    """
    with db() as conn, conn.cursor() as cur:
        if sees_all_orgs(user):
            cur.execute("select * from org order by sort, name")
        else:
            cur.execute("""select o.* from org o
                             join staff s on s.org_id = o.id
                            where s.id = %s""", (user["id"],))
        return cur.fetchall()


def current_org(user, orgs=None):
    """Выбранное учреждение: из cookie, если оно доступно, иначе первое.

    Проверять обязательно: cookie подделывается тривиально, а от неё зависит,
    чьи данные человек увидит.
    """
    orgs = orgs if orgs is not None else orgs_of(user)
    ids = [o["id"] for o in orgs]
    want = request.cookies.get(ORG_COOKIE)
    if want and want in ids:
        return want
    return ids[0] if ids else None


def reg_access_of(row) -> dict:
    return dict(row.get("reg_access") or {})


def can(user, code: str) -> bool:
    return code in user["perms"]


def reg_level(user, registry_id: str) -> str:
    """none | view | edit — уровень доступа к разделу.

    Две вещи помимо роли:

    1. Доступ к учреждению сам по себе даёт только просмотр — правка включается
       отдельной галочкой в карточке сотрудника. Иначе выдача доступа новому
       человеку сразу пускала бы его менять чужой учёт.
    2. Разделы других учреждений заводятся с приставкой «<учреждение>_», поэтому
       уровень из роли ищем и по исходному имени раздела — роли общие на всю базу.
    """
    if "admin" in user["perms"]:
        return "edit"
    lvl = user["reg_access"].get(registry_id)
    if lvl is None:
        base = registry_id.split("_", 1)[1] if "_" in registry_id else registry_id
        lvl = user["reg_access"].get(base, "none")
    if lvl == "edit" and not user.get("can_edit"):
        return "view"
    if lvl == "none" and sees_all_orgs(user):
        return "view"          # начальник отдела видит всё, но не правит
    return lvl


# ------------------------------------------------------------------ сессии

def current_user():
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            select s.token, s.expires_at, st.id, st.full_name, st.position, st.login,
                   st.is_master, st.active, st.role_id, st.can_edit,
                   r.name as role_name, r.perms, r.reg_access
              from session s
              join staff st on st.id = s.staff_id
              left join role r on r.id = st.role_id
             where s.token = %s
        """, (token,))
        row = cur.fetchone()
        if not row or not row["active"]:
            return None
        if row["expires_at"] < datetime.datetime.now(datetime.timezone.utc):
            cur.execute("delete from session where token = %s", (token,))
            return None
        cur.execute("update session set seen_at = now() where token = %s", (token,))
    return {
        "id": row["id"], "name": row["full_name"], "position": row["position"],
        "login": row["login"], "isMaster": row["is_master"],
        "roleId": row["role_id"], "roleName": row["role_name"] or "",
        "perms": perms_of(row), "reg_access": reg_access_of(row),
        "can_edit": bool(row["can_edit"]),
    }


def need_auth(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user:
            return jsonify({"error": "not_authenticated"}), 401
        request.user = user
        return fn(*a, **kw)
    return wrapper


def need_view_all(fn):
    """Сводки по всем учреждениям: администратор, начальник отдела, управляющий."""
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user:
            return jsonify({"error": "not_authenticated"}), 401
        if not sees_all_orgs(user):
            return jsonify({"error": "forbidden", "need": "org.viewall"}), 403
        request.user = user
        return fn(*a, **kw)
    return wrapper


def need_perm(code):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            user = current_user()
            if not user:
                return jsonify({"error": "not_authenticated"}), 401
            if code not in user["perms"]:
                return jsonify({"error": "forbidden", "need": code}), 403
            request.user = user
            return fn(*a, **kw)
        return wrapper
    return deco


# ------------------------------------------------------------------ первичное заполнение

def apply_migrations():
    """Доводит схему до текущей при каждом запуске.

    Обновление на сервере обычно делают просто: распаковали файлы поверх старых
    и перезапустили. Если при этом забыть install.bat, новых таблиц в базе не
    появится и половина разделов сломается. Все миграции написаны идемпотентно
    (create ... if not exists, add column if not exists), поэтому прогнать их
    лишний раз ничего не стоит.
    """
    folder = BASE / "migrations"
    if not folder.exists():
        return
    for f in sorted(folder.glob("*.sql")):
        try:
            with db() as conn:
                conn.execute(f.read_text(encoding="utf-8"))
        except Exception as e:
            print("  миграция %s: %s" % (f.name, e))


def seed():
    apply_migrations()
    with db() as conn, conn.cursor() as cur:
        # Учреждение должно существовать раньше разделов: без него заводские
        # разделы легли бы с пустым org_id и не попали бы ни в одну выборку.
        cur.execute("select id from org order by sort, name limit 1")
        row = cur.fetchone()
        if row:
            org_id = row["id"]
        else:
            org_id = "org_main"
            cur.execute("""insert into org (id, name, sort) values (%s, 'Основное', 0)
                           on conflict (id) do nothing""", (org_id,))

        for rid, name, descr, perms, level, sort in SEED_ROLES:
            access = {r[0]: level for r in SEED_REGISTRIES} if level else {}
            cur.execute("""
                insert into role (id, name, descr, perms, reg_access, builtin, sort)
                values (%s,%s,%s,%s,%s,true,%s)
                on conflict (id) do nothing
            """, (rid, name, descr, json.dumps(perms), json.dumps(access), sort))

        for rid, name, icon, kind, sort in SEED_REGISTRIES:
            statuses = [] if kind == "supplies" else DEF_STATUSES
            cur.execute("""
                insert into registry (id, name, icon, kind, builtin, statuses, layout, sort, org_id)
                values (%s,%s,%s,%s,true,%s,%s,%s,%s)
                on conflict (id) do nothing
            """, (rid, name, icon, kind, json.dumps(statuses), json.dumps(DEF_LAYOUT), sort, org_id))

        cur.execute("""
            insert into setting (key, value) values ('units', %s)
            on conflict (key) do nothing
        """, (json.dumps(DEF_UNITS),))

        cur.execute("select count(*) as n from staff where login is not null")
        if cur.fetchone()["n"] == 0:
            password = secrets.token_urlsafe(9)
            cur.execute("""
                insert into staff (id, full_name, position, login, pass_hash, role_id, is_master, active)
                values ('st_admin', 'Администратор', 'Администратор системы',
                        'admin', %s, 'role_admin', false, true)
                on conflict (id) do nothing
            """, (hash_password(password),))
            fname = "FIRST_LOGIN_" + os.environ.get("PGDATABASE", "asset_it") + ".txt"
            (BASE / fname).write_text(
                "Первый вход в «Учёт ИТ-отдела»\n\n"
                "  логин:  admin\n"
                "  пароль: " + password + "\n\n"
                "Смените пароль после входа: Сотрудники ИТ → карточка admin → поле «Пароль».\n"
                "Этот файл после смены пароля можно удалить.\n", encoding="utf-8")
            print("\n  Создана учётная запись администратора:")
            print("    логин:  admin")
            print("    пароль: " + password)
            print("  (продублировано в server/" + fname + ")")
            cur.execute("update staff set org_id = %s where id = 'st_admin'", (org_id,))


# ------------------------------------------------------------------ чтение состояния

def js_date(v):
    return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (v or "")


def load_state(user, org_id):
    """Собирает дерево данных одного учреждения.

    Чужие учреждения сюда не попадают вовсе — фильтр стоит в запросах, а не
    в интерфейсе, иначе данные уезжали бы в браузер и «прятались» бы только на вид.
    """
    allowed = None
    if "admin" not in user["perms"] and not sees_all_orgs(user):
        # считаем через reg_level: там же учитываются приставка учреждения
        # и правило «доступ без галочки правки — это просмотр»
        allowed = "by-level"

    with db() as conn, conn.cursor() as cur:
        def rows(sql, args=()):
            cur.execute(sql, args)
            return cur.fetchall()

        def by_org(table, order=""):
            return rows("select * from " + table + " where org_id = %s " + order, (org_id,))

        regs = [r for r in by_org("registry", "order by sort, name")
                if allowed is None or reg_level(user, r["id"]) != "none"]
        reg_ids = [r["id"] for r in regs]

        registries = [{"id": r["id"], "name": r["name"], "icon": r["icon"], "kind": r["kind"],
                       "builtin": r["builtin"], "statuses": r["statuses"], "layout": r["layout"]}
                      for r in regs]

        def in_regs(table):
            if not reg_ids:
                return []
            return rows("select * from " + table + " where registry_id = any(%s)", (reg_ids,))

        categories = [{"id": r["id"], "name": r["name"], "registryId": r["registry_id"]}
                      for r in in_regs("category")]
        subcategories = [{"id": r["id"], "name": r["name"], "categoryId": r["category_id"] or "",
                          "registryId": r["registry_id"]} for r in in_regs("subcategory")]
        types = [{"id": r["id"], "name": r["name"], "categoryId": r["category_id"] or "",
                  "subcategoryId": r["subcategory_id"] or "", "registryId": r["registry_id"]}
                 for r in in_regs("item_type")]

        specs = [{"id": r["id"], "name": r["name"], "kind": r["kind"], "unit": r["unit"],
                  "options": r["options"], "req": r["req"], "uniq": r["uniq"], "opt": r["opt"],
                  "reqStatuses": r["req_statuses"], "group": r["grp"], "poolId": r["pool_id"] or "",
                  "subcategoryId": r["subcategory_id"] or "", "typeId": r["type_id"] or ""}
                 for r in rows("""select s.* from spec s
                                   left join subcategory g on g.id = s.subcategory_id
                                   left join item_type t on t.id = s.type_id
                                  where coalesce(g.registry_id, t.registry_id) = any(%s)""",
                              (reg_ids or [""],))]

        presets = [{"id": r["id"], "name": r["name"], "specs": r["specs"]}
                   for r in by_org("preset", "order by name")]

        persons = [{"id": r["id"], "name": r["name"], "position": r["position"],
                    "phone": r["phone"], "email": r["email"],
                    "fromAd": bool(r["ad_guid"]),
                    "divisionId": r["division_id"] or "", "departmentId": r["department_id"] or ""}
                   for r in by_org("person", "order by name")]

        # сотрудники ИТ общие на всю базу, но в списке видно, кто где работает
        staff = [{"id": r["id"], "name": r["full_name"], "position": r["position"],
                  "login": r["login"] or "", "role": r["role_id"] or "",
                  "orgId": r["org_id"] or "", "canEdit": r["can_edit"],
                  "isMaster": r["is_master"], "active": r["active"]}
                 for r in rows("select * from staff order by full_name")]

        roles = [{"id": r["id"], "name": r["name"], "descr": r["descr"], "perms": r["perms"],
                  "regAccess": r["reg_access"], "builtin": r["builtin"]}
                 for r in rows("select * from role order by sort, name")]

        divisions = [{"id": r["id"], "name": r["name"]} for r in by_org("division", "order by name")]
        departments = [{"id": r["id"], "name": r["name"]} for r in by_org("department", "order by name")]

        pools = [{"id": r["id"], "name": r["name"], "prefix": r["prefix"], "from": r["host_from"],
                  "to": r["host_to"], "note": r["note"], "registryId": r["registry_id"] or "",
                  "categoryId": r["category_id"] or ""} for r in by_org("ip_pool", "order by prefix")]
        reserved = [{"id": r["id"], "ip": r["ip"], "note": r["note"]}
                    for r in by_org("ip_reserved", "order by ip")]

        supplies = [{"id": r["id"], "name": r["name"], "unit": r["unit"], "note": r["note"], "qty": 0}
                    for r in by_org("supply", "order by name")]
        receipts = [{"id": r["id"], "supplyId": r["supply_id"], "qty": r["qty"],
                     "date": js_date(r["d"]), "note": r["note"]}
                    for r in rows("""select r.* from supply_receipt r
                                              join supply s on s.id = r.supply_id
                                             where s.org_id = %s
                                          order by r.d desc nulls last""", (org_id,))]
        issues = [{"id": r["id"], "supplyId": r["supply_id"], "userId": r["person_id"] or "",
                   "qty": r["qty"], "date": js_date(r["d"]), "note": r["note"]}
                  for r in rows("""select i.* from supply_issue i
                                            join supply s on s.id = i.supply_id
                                           where s.org_id = %s
                                        order by i.d desc nulls last""", (org_id,))]
        got = {}
        for rc in receipts:
            got[rc["supplyId"]] = got.get(rc["supplyId"], 0) + (rc["qty"] or 0)
        for m in supplies:
            m["qty"] = got.get(m["id"], 0)

        repairs = [{"id": r["id"], "itemId": r["item_id"] or "", "registryId": r["registry_id"] or "",
                    "inv": r["inv"], "typeName": r["type_name"], "masterId": r["master_id"] or "",
                    "masterName": r["master_name"], "from": js_date(r["from_date"]),
                    "to": js_date(r["to_date"]), "result": r["result"], "note": r["note"],
                    "doneNote": r["done_note"]}
                   for r in by_org("repair", "order by from_date desc nulls last")]

        notices = [{"id": r["id"], "at": r["at"].isoformat(), "type": r["type"],
                    "itemId": r["item_id"] or "", "registryId": r["registry_id"] or "",
                    "inv": r["inv"], "typeName": r["type_name"], "masterId": r["master_id"] or "",
                    "text": r["text"], "forStaffId": r["for_staff_id"] or "", "seen": r["seen"]}
                   for r in rows("""select * from notice where org_id = %s
                                        order by at desc limit 300""", (org_id,))]

        cur.execute("select value from setting where key = 'units'")
        u = cur.fetchone()
        units = u["value"] if u else DEF_UNITS

        hist = {}
        if reg_ids:
            for r in rows("""select h.item_id, h.d, h.t, h.who from item_history h
                               join item i on i.id = h.item_id
                              where i.registry_id = any(%s) order by h.id""", (reg_ids,)):
                hist.setdefault(r["item_id"], []).append(
                    {"d": r["d"], "t": r["t"], "who": r["who"] or ""})

        items = []
        if reg_ids:
            for r in rows("select * from item where registry_id = any(%s) order by inv", (reg_ids,)):
                items.append({
                    "id": r["id"], "registryId": r["registry_id"], "inv": r["inv"],
                    "type": r["type_id"] or "", "status": r["status"],
                    "owner": r["owner_id"] or "", "division": r["division_id"] or "",
                    "department": r["department_id"] or "", "notes": r["notes"],
                    "specs": r["specs"], "specsNone": r["specs_none"],
                    "masterId": r["master_id"] or "", "statusDate": js_date(r["status_date"]),
                    "statusNote": r["status_note"], "history": hist.get(r["id"], []),
                    "updatedBy": r["updated_by_name"] or "",
                    "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else "",
                })

        net_status = {
            r["ip"]: {"alive": r["alive"], "method": r["method"],
                      "lastSeen": r["last_seen"].isoformat() if r["last_seen"] else "",
                      "lastCheck": r["last_check"].isoformat() if r["last_check"] else ""}
            for r in by_org("ip_status")}

    cfg = {
        "registries": registries, "categories": categories, "subcategories": subcategories,
        "types": types, "specs": specs, "presets": presets, "users": persons,
        "staff": staff, "roles": roles, "divisions": divisions, "departments": departments,
        "ipPools": pools, "ipReserved": reserved, "supplies": supplies, "receipts": receipts,
        "issues": issues, "repairs": repairs, "notices": notices, "units": units,
        "netStatus": net_status,
    }

    me = dict(user)
    me["perms"] = sorted(user["perms"])
    me["canEdit"] = bool(user.get("can_edit")) or "admin" in user["perms"]
    me["seesAllOrgs"] = sees_all_orgs(user)
    return {"cfg": cfg, "items": items, "me": me, "build": APP_BUILD,
            "permList": [{"code": c, "title": t} for c, t in PERMS]}


# ------------------------------------------------------------------ запись состояния

def sync_table(cur, table, key_cols, rows_in, scope=None):
    """Приводит таблицу к присланному списку: upsert всех и удаление лишних.

    scope — («условие sql», [аргументы]): удаление ограничивается этим подмножеством,
    чтобы пользователь с доступом к части разделов не стёр чужие строки.
    """
    ids = [r["id"] for r in rows_in]
    cols = list(key_cols.keys())
    for r in rows_in:
        values = [r["id"]] + [key_cols[c](r) for c in cols]
        placeholders = ", ".join(["%s"] * (len(cols) + 1))
        updates = ", ".join([c + " = excluded." + c for c in cols])
        cur.execute(
            "insert into " + table + " (id, " + ", ".join(cols) + ") values (" + placeholders + ")"
            " on conflict (id) do update set " + updates,
            values)
    where, args = "true", []
    if scope:
        where, args = scope[0], list(scope[1])
    if ids:
        cur.execute("delete from " + table + " where " + where + " and id <> all(%s)", args + [ids])
    else:
        cur.execute("delete from " + table + " where " + where, args)


def manages_all_registries(user):
    """Справочники разделов правит тот, кому доступны все разделы на запись."""
    if "admin" in user["perms"]:
        return True
    if "registry.manage" not in user["perms"]:
        return False
    return False    # частичный доступ к разделам справочники не правит


def may_write(user):
    """Без галочки «разрешено редактирование» доступ к учреждению — только просмотр."""
    return "admin" in user["perms"] or bool(user.get("can_edit"))


def save_cfg(cfg, user, org_id):
    """Сохраняет справочники одного учреждения.

    Порядок важен: сначала то, на что ссылаются остальные. И ещё важнее область
    удаления: sync_table стирает всё, чего нет в присланном списке, а клиент
    присылает только своё учреждение — без scope он снёс бы справочники соседнего.
    """
    g = lambda r, k, d="": r.get(k, d)
    full = manages_all_registries(user)
    org = lambda r: org_id
    in_org = ("org_id = %s", [org_id])

    with db() as conn, conn.cursor() as cur:
        # что принадлежит этому учреждению: нужно, чтобы ограничить удаление
        cur.execute("select id from registry where org_id = %s", (org_id,))
        my_regs = [r["id"] for r in cur.fetchall()] or [""]
        cur.execute("select id from supply where org_id = %s", (org_id,))
        my_supplies = [r["id"] for r in cur.fetchall()] or [""]
        in_regs = ("registry_id = any(%s)", [my_regs])
        in_supplies = ("supply_id = any(%s)", [my_supplies])
        # --- разделы учёта ---
        if "registries" in cfg and full:
            sync_table(cur, "registry", {
                "name": lambda r: g(r, "name"), "icon": lambda r: g(r, "icon", "\u25a3"),
                "kind": lambda r: g(r, "kind", "assets"), "builtin": lambda r: bool(g(r, "builtin", False)),
                "statuses": lambda r: json.dumps(g(r, "statuses", [])),
                "layout": lambda r: json.dumps(g(r, "layout", DEF_LAYOUT)),
                "org_id": org,
            }, cfg["registries"], scope=in_org)

        # --- подразделения и отделы раньше людей ---
        for name, table in (("divisions", "division"), ("departments", "department")):
            if name in cfg and can(user, "users.manage"):
                sync_table(cur, table, {"name": lambda r: g(r, "name"), "org_id": org},
                           cfg[name], scope=in_org)

        if "users" in cfg and can(user, "users.manage"):
            sync_table(cur, "person", {
                "name": lambda r: g(r, "name"), "position": lambda r: g(r, "position"),
                "division_id": lambda r: g(r, "divisionId") or None,
                "department_id": lambda r: g(r, "departmentId") or None,
                "phone": lambda r: g(r, "phone"), "email": lambda r: g(r, "email"),
                "org_id": org},
                cfg["users"], scope=in_org)

        # --- дерево справочников раздела ---
        if full:
            for name, table, cols in (
                ("categories", "category", {
                    "name": lambda r: g(r, "name"),
                    "registry_id": lambda r: g(r, "registryId") or None}),
                ("subcategories", "subcategory", {
                    "name": lambda r: g(r, "name"),
                    "category_id": lambda r: g(r, "categoryId") or None,
                    "registry_id": lambda r: g(r, "registryId") or None}),
                ("types", "item_type", {
                    "name": lambda r: g(r, "name"),
                    "category_id": lambda r: g(r, "categoryId") or None,
                    "subcategory_id": lambda r: g(r, "subcategoryId") or None,
                    "registry_id": lambda r: g(r, "registryId") or None}),
                ("specs", "spec", {
                    "name": lambda r: g(r, "name"), "kind": lambda r: g(r, "kind", "text"),
                    "unit": lambda r: g(r, "unit"), "options": lambda r: json.dumps(g(r, "options", [])),
                    "req": lambda r: bool(g(r, "req", False)), "uniq": lambda r: bool(g(r, "uniq", False)),
                    "opt": lambda r: bool(g(r, "opt", False)),
                    "req_statuses": lambda r: json.dumps(g(r, "reqStatuses", [])),
                    "grp": lambda r: g(r, "group"), "pool_id": lambda r: g(r, "poolId") or None,
                    "subcategory_id": lambda r: g(r, "subcategoryId") or None,
                    "type_id": lambda r: g(r, "typeId") or None}),
                ("presets", "preset", {
                    "name": lambda r: g(r, "name"), "org_id": org,
                    "specs": lambda r: json.dumps(g(r, "specs", []))}),
            ):
                if name in cfg:
                    if table == "preset":
                        scope = in_org
                    elif table == "spec":
                        # характеристики висят не на разделе, а на подкатегории или типе
                        scope = ("""(subcategory_id in (select id from subcategory
                                                         where registry_id = any(%s))
                                     or type_id in (select id from item_type
                                                     where registry_id = any(%s)))""",
                                 [my_regs, my_regs])
                    else:
                        scope = in_regs
                    sync_table(cur, table, cols, cfg[name], scope=scope)

        # --- IP ---
        if "ipPools" in cfg and can(user, "ip.manage"):
            sync_table(cur, "ip_pool", {
                "name": lambda r: g(r, "name"), "prefix": lambda r: g(r, "prefix"),
                "host_from": lambda r: int(g(r, "from", 1) or 1),
                "host_to": lambda r: int(g(r, "to", 254) or 254),
                "note": lambda r: g(r, "note"),
                "registry_id": lambda r: g(r, "registryId") or None,
                "category_id": lambda r: g(r, "categoryId") or None,
                "org_id": org}, cfg["ipPools"], scope=in_org)
        if "ipReserved" in cfg and can(user, "ip.manage"):
            sync_table(cur, "ip_reserved", {
                "ip": lambda r: g(r, "ip"), "note": lambda r: g(r, "note"),
                "org_id": org}, cfg["ipReserved"], scope=in_org)

        # --- расходные материалы: справочник, приходы, выдачи ---
        if "supplies" in cfg and can(user, "supply.receive"):
            sync_table(cur, "supply", {
                "name": lambda r: g(r, "name"), "unit": lambda r: g(r, "unit", "\u0448\u0442"),
                "note": lambda r: g(r, "note"), "org_id": org},
                cfg["supplies"], scope=in_org)
        if "receipts" in cfg and can(user, "supply.receive"):
            sync_table(cur, "supply_receipt", {
                "supply_id": lambda r: g(r, "supplyId"), "qty": lambda r: int(g(r, "qty", 0) or 0),
                "d": lambda r: g(r, "date") or None, "note": lambda r: g(r, "note")},
                cfg["receipts"], scope=in_supplies)
        if "issues" in cfg and can(user, "supply.issue"):
            sync_table(cur, "supply_issue", {
                "supply_id": lambda r: g(r, "supplyId"),
                "person_id": lambda r: g(r, "userId") or None,
                "qty": lambda r: int(g(r, "qty", 1) or 1),
                "d": lambda r: g(r, "date") or None, "note": lambda r: g(r, "note")},
                cfg["issues"], scope=in_supplies)

        # --- ремонты и уведомления пишет всякий, кто может менять статус ---
        if "repairs" in cfg:
            sync_table(cur, "repair", {
                "item_id": lambda r: g(r, "itemId") or None,
                "registry_id": lambda r: g(r, "registryId") or None,
                "inv": lambda r: g(r, "inv"), "type_name": lambda r: g(r, "typeName"),
                "master_id": lambda r: g(r, "masterId") or None,
                "master_name": lambda r: g(r, "masterName"),
                "from_date": lambda r: g(r, "from") or None,
                "to_date": lambda r: g(r, "to") or None,
                "result": lambda r: g(r, "result"), "note": lambda r: g(r, "note"),
                "done_note": lambda r: g(r, "doneNote"), "org_id": org},
                cfg["repairs"], scope=in_org)

        if "notices" in cfg:
            sync_table(cur, "notice", {
                "type": lambda r: g(r, "type"), "item_id": lambda r: g(r, "itemId") or None,
                "registry_id": lambda r: g(r, "registryId") or None, "inv": lambda r: g(r, "inv"),
                "type_name": lambda r: g(r, "typeName"),
                "master_id": lambda r: g(r, "masterId") or None, "text": lambda r: g(r, "text"),
                "for_staff_id": lambda r: g(r, "forStaffId") or None,
                "seen": lambda r: bool(g(r, "seen", False)), "org_id": org},
                cfg["notices"], scope=in_org)

        if "units" in cfg and full:
            cur.execute("""insert into setting (key, value) values ('units', %s)
                           on conflict (key) do update set value = excluded.value""",
                        (json.dumps(cfg["units"]),))


def save_items(items, user, org_id):
    """Пишет записи и дописывает события истории от имени текущего пользователя.

    Клиент присылает новые события в historyAdd; готовую историю из него не берём,
    иначе автора можно было бы подделать или затереть чужие строки.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute("select id from registry where org_id = %s", (org_id,))
        my_regs = {r["id"] for r in cur.fetchall()}
        for it in items:
            reg = it.get("registryId") or "equipment"
            if reg not in my_regs:
                return {"error": "foreign_registry", "registry": reg}
            if reg_level(user, reg) != "edit":
                return {"error": "forbidden", "registry": reg}
            cur.execute("select 1 from item where id = %s", (it["id"],))
            is_new = cur.fetchone() is None

            cur.execute("""
                insert into item (id, registry_id, inv, type_id, status, owner_id, division_id,
                                  department_id, notes, specs, specs_none, master_id,
                                  status_date, status_note, updated_by, updated_by_name, updated_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                on conflict (id) do update set
                  registry_id = excluded.registry_id, inv = excluded.inv, type_id = excluded.type_id,
                  status = excluded.status, owner_id = excluded.owner_id,
                  division_id = excluded.division_id, department_id = excluded.department_id,
                  notes = excluded.notes, specs = excluded.specs, specs_none = excluded.specs_none,
                  master_id = excluded.master_id, status_date = excluded.status_date,
                  status_note = excluded.status_note, updated_by = excluded.updated_by,
                  updated_by_name = excluded.updated_by_name, updated_at = now()
            """, (it["id"], reg, it.get("inv", ""), it.get("type") or None, it.get("status", ""),
                  it.get("owner") or None, it.get("division") or None, it.get("department") or None,
                  it.get("notes", ""), json.dumps(it.get("specs", {})),
                  json.dumps(it.get("specsNone", {})), it.get("masterId") or None,
                  it.get("statusDate") or None, it.get("statusNote", ""),
                  user["id"], user["name"]))

            events = it.get("historyAdd") or []
            if is_new and not events and it.get("history"):
                # запись создана старым клиентом — переносим её историю один раз
                events = [{"d": h.get("d", ""), "t": h.get("t", "")} for h in it["history"]]
            for h in events:
                cur.execute("""insert into item_history (item_id, d, t, staff_id, who)
                               values (%s,%s,%s,%s,%s)""",
                            (it["id"], h.get("d", ""), h.get("t", ""), user["id"], user["name"]))
    return {"ok": True}


# ------------------------------------------------------------------ API

@app.post("/api/login")
def api_login():
    data = request.get_json(silent=True) or {}
    login = (data.get("login") or "").strip()
    password = data.get("password") or ""
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from staff where lower(login) = lower(%s)", (login,))
        row = cur.fetchone()
        if not row or not row["active"] or not check_password(password, row["pass_hash"] or ""):
            return jsonify({"error": "bad_credentials"}), 401
        token = secrets.token_urlsafe(32)
        expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=SESSION_DAYS)
        cur.execute("insert into session (token, staff_id, expires_at) values (%s,%s,%s)",
                    (token, row["id"], expires))
    resp = make_response(jsonify({"ok": True}))
    resp.set_cookie(COOKIE, token, httponly=True, samesite="Lax",
                    max_age=SESSION_DAYS * 24 * 3600, path="/")
    return resp


@app.post("/api/logout")
def api_logout():
    token = request.cookies.get(COOKIE)
    if token:
        with db() as conn, conn.cursor() as cur:
            cur.execute("delete from session where token = %s", (token,))
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(COOKIE, path="/")
    return resp


@app.get("/api/state")
@need_auth
def api_state():
    orgs = orgs_of(request.user)
    org_id = current_org(request.user, orgs)
    if not org_id:
        return jsonify({"error": "no_org",
                        "message": "Вам не открыт доступ ни к одному учреждению. "
                                   "Обратитесь к администратору."}), 403
    data = load_state(request.user, org_id)
    data["orgs"] = [{"id": o["id"], "name": o["name"], "note": o["note"]} for o in orgs]
    data["orgId"] = org_id
    resp = make_response(jsonify(data))
    # запоминаем выбор, чтобы после перезагрузки страницы остаться там же
    resp.set_cookie(ORG_COOKIE, org_id, httponly=True, samesite="Lax", path="/",
                    max_age=SESSION_DAYS * 24 * 3600)
    return resp


@app.post("/api/org/select")
@need_auth
def api_org_select():
    """Переключение на другое учреждение. Чужое не примем."""
    want = (request.get_json(silent=True) or {}).get("id") or ""
    ids = [o["id"] for o in orgs_of(request.user)]
    if want not in ids:
        return jsonify({"error": "forbidden"}), 403
    resp = make_response(jsonify({"ok": True, "id": want}))
    resp.set_cookie(ORG_COOKIE, want, httponly=True, samesite="Lax", path="/",
                    max_age=SESSION_DAYS * 24 * 3600)
    return resp


@app.post("/api/orgs")
@need_perm("org.manage")
def api_orgs_save():
    o = request.get_json(silent=True) or {}
    oid = (o.get("id") or "").strip()
    name = (o.get("name") or "").strip()
    if not oid or not name:
        return jsonify({"error": "bad_request"}), 400
    with db() as conn, conn.cursor() as cur:
        cur.execute("select 1 from org where id = %s", (oid,))
        is_new = cur.fetchone() is None
        cur.execute("""insert into org (id, name, note, sort) values (%s,%s,%s,%s)
                       on conflict (id) do update set name = excluded.name,
                                                      note = excluded.note,
                                                      sort = excluded.sort""",
                    (oid, name, o.get("note", ""), int(o.get("sort") or 0)))
        if is_new:
            # новое учреждение начинает не с пустоты: те же четыре заводских раздела
            for rid, rname, icon, kind, sort in SEED_REGISTRIES:
                statuses = [] if kind == "supplies" else DEF_STATUSES
                cur.execute("""
                    insert into registry (id, name, icon, kind, builtin, statuses, layout, sort, org_id)
                    values (%s,%s,%s,%s,true,%s,%s,%s,%s)
                """, (oid + "_" + rid, rname, icon, kind, json.dumps(statuses),
                      json.dumps(DEF_LAYOUT), sort, oid))
    return jsonify({"ok": True, "id": oid})


@app.post("/api/orgs/delete")
@need_perm("org.manage")
def api_orgs_delete():
    oid = (request.get_json(silent=True) or {}).get("id")
    with db() as conn, conn.cursor() as cur:
        cur.execute("select count(*) as n from org")
        if cur.fetchone()["n"] <= 1:
            return jsonify({"error": "last_org"}), 400
        cur.execute("select count(*) as n from item i join registry r on r.id = i.registry_id "
                    "where r.org_id = %s", (oid,))
        if cur.fetchone()["n"]:
            return jsonify({"error": "not_empty"}), 400
        cur.execute("delete from org where id = %s", (oid,))
    return jsonify({"ok": True})


@app.get("/api/orgs/access")
@need_perm("org.manage")
def api_orgs_access():
    """Список учреждений и кто в каком работает."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from org order by sort, name")
        orgs = [{"id": r["id"], "name": r["name"], "note": r["note"], "sort": r["sort"]}
                for r in cur.fetchall()]
        cur.execute("""select s.id, s.full_name, s.org_id, r.name as role_name,
                              coalesce(r.perms, '[]'::jsonb) as perms
                         from staff s left join role r on r.id = s.role_id
                     order by s.full_name""")
        staff = [{"id": r["id"], "name": r["full_name"], "orgId": r["org_id"] or "",
                  "roleName": r["role_name"] or "",
                  "isAdmin": "admin" in (r["perms"] or [])} for r in cur.fetchall()]
    return jsonify({"orgs": orgs, "staff": staff})


@app.post("/api/orgs/access")
@need_perm("org.manage")
def api_orgs_access_save():
    """Перевод сотрудника в другое учреждение."""
    d = request.get_json(silent=True) or {}
    sid, oid = d.get("staffId"), d.get("orgId") or None
    if not sid:
        return jsonify({"error": "bad_request"}), 400
    with db() as conn, conn.cursor() as cur:
        cur.execute("update staff set org_id = %s where id = %s", (oid, sid))
    return jsonify({"ok": True})


@app.get("/api/cross")
@need_view_all
def api_cross():
    """Данные по всем учреждениям сразу — для дашборда, ремонтов, уведомлений
    и журнала удалений администратора.

    Отдельный запрос, а не расширение /api/state: состояние приложения должно
    остаться строго в рамках одного учреждения, иначе правка записей стала бы
    опасной — непонятно, в чьи данные пишем.
    """
    with db() as conn, conn.cursor() as cur:
        def rows(sql, args=()):
            cur.execute(sql, args)
            return cur.fetchall()

        orgs = [{"id": r["id"], "name": r["name"]}
                for r in rows("select * from org order by sort, name")]

        items = [{"id": r["id"], "orgId": r["org_id"], "orgName": r["org_name"],
                  "regId": r["registry_id"], "regName": r["reg_name"],
                  "inv": r["inv"], "typeName": r["type_name"] or "",
                  "catName": r["cat_name"] or "", "status": r["status"],
                  "ownerName": r["owner_name"] or "", "divName": r["div_name"] or "",
                  "depName": r["dep_name"] or "", "masterId": r["master_id"] or "",
                  "statusDate": js_date(r["status_date"])}
                 for r in rows("""
                    select i.id, i.registry_id, i.inv, i.status, i.master_id, i.status_date,
                           g.org_id, o.name as org_name, g.name as reg_name,
                           t.name as type_name, c.name as cat_name, p.name as owner_name,
                           d.name as div_name, dep.name as dep_name
                      from item i
                      join registry g on g.id = i.registry_id
                      join org o on o.id = g.org_id
                      left join item_type t on t.id = i.type_id
                      left join category c on c.id = t.category_id
                      left join person p on p.id = i.owner_id
                      left join division d on d.id = i.division_id
                      left join department dep on dep.id = i.department_id
                  order by o.sort, o.name, i.inv""")]

        repairs = [{"id": r["id"], "orgId": r["org_id"] or "", "orgName": r["org_name"] or "",
                    "itemId": r["item_id"] or "", "registryId": r["registry_id"] or "",
                    "inv": r["inv"], "typeName": r["type_name"],
                    "masterId": r["master_id"] or "", "masterName": r["master_name"],
                    "from": js_date(r["from_date"]), "to": js_date(r["to_date"]),
                    "result": r["result"], "note": r["note"], "doneNote": r["done_note"]}
                   for r in rows("""select rp.*, o.name as org_name from repair rp
                                     left join org o on o.id = rp.org_id
                                 order by rp.from_date desc nulls last""")]

        notices = [{"id": r["id"], "orgId": r["org_id"] or "", "orgName": r["org_name"] or "",
                    "at": r["at"].isoformat(), "type": r["type"],
                    "itemId": r["item_id"] or "", "registryId": r["registry_id"] or "",
                    "inv": r["inv"], "typeName": r["type_name"],
                    "masterId": r["master_id"] or "", "text": r["text"],
                    "forStaffId": r["for_staff_id"] or "", "seen": r["seen"]}
                   for r in rows("""select nt.*, o.name as org_name from notice nt
                                     left join org o on o.id = nt.org_id
                                 order by nt.at desc limit 500""")]

        dels = [{"id": str(r["id"]), "orgId": r["org_id"] or "", "orgName": r["org_name"] or "",
                 "at": r["at"].isoformat() if r["at"] else "", "who": r["who"],
                 "reason": r["reason"], "itemId": r["item_id"], "registryId": r["registry_id"],
                 "regName": r["registry_name"], "inv": r["inv"], "typeName": r["type_name"],
                 "catName": r["cat_name"], "subName": r["sub_name"], "status": r["status"],
                 "ownerName": r["owner_name"], "divName": r["division_name"],
                 "depName": r["department_name"], "notes": r["notes"],
                 "specs": (r["snapshot"] or {}).get("specs", []),
                 "history": (r["snapshot"] or {}).get("history", [])}
                for r in rows("""select dl.*, o.name as org_name from deletion dl
                                  left join org o on o.id = dl.org_id
                              order by dl.at desc limit 1000""")]

        staff = [{"id": r["id"], "name": r["full_name"], "orgId": r["org_id"] or ""}
                 for r in rows("select * from staff order by full_name")]

    return jsonify({"orgs": orgs, "items": items, "repairs": repairs,
                    "notices": notices, "deletions": dels, "staff": staff})


@app.get("/api/overview")
@need_view_all
def api_overview():
    """Сводка по всем учреждениям сразу — только для администратора."""
    out = []
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from org order by sort, name")
        orgs = cur.fetchall()
        for o in orgs:
            oid = o["id"]
            cur.execute("""select count(*) as n from item i join registry r on r.id = i.registry_id
                            where r.org_id = %s""", (oid,))
            items = cur.fetchone()["n"]
            cur.execute("""select i.status, count(*) as n from item i
                             join registry r on r.id = i.registry_id
                            where r.org_id = %s group by i.status""", (oid,))
            by_status = {r["status"]: r["n"] for r in cur.fetchall()}
            cur.execute("select count(*) as n from repair where org_id = %s and to_date is null", (oid,))
            open_rep = cur.fetchone()["n"]
            cur.execute("select count(*) as n from person where org_id = %s", (oid,))
            people = cur.fetchone()["n"]
            cur.execute("select count(*) as n from division where org_id = %s", (oid,))
            divs = cur.fetchone()["n"]
            cur.execute("select count(*) as n from staff where org_id = %s", (oid,))
            staff = cur.fetchone()["n"]
            out.append({"id": oid, "name": o["name"], "note": o["note"],
                        "items": items, "inUse": by_status.get("В эксплуатации", 0),
                        "stock": by_status.get("На складе", 0),
                        "repair": by_status.get("В ремонте", 0),
                        "off": by_status.get("Списано", 0),
                        "openRepairs": open_rep, "people": people,
                        "divisions": divs, "staff": staff})
    return jsonify({"orgs": out})


@app.post("/api/cfg")
@need_auth
def api_cfg():
    cfg = request.get_json(silent=True) or {}
    org_id = current_org(request.user)
    if not org_id:
        return jsonify({"error": "no_org"}), 403
    if not may_write(request.user):
        return jsonify({"error": "read_only",
                        "message": "Вам открыт только просмотр. Редактирование "
                                   "включает администратор в карточке сотрудника."}), 403
    save_cfg(cfg, request.user, org_id)
    return jsonify({"ok": True})


@app.post("/api/items")
@need_auth
def api_items():
    data = request.get_json(silent=True) or {}
    org_id = current_org(request.user)
    if not org_id:
        return jsonify({"error": "no_org"}), 403
    if not may_write(request.user):
        return jsonify({"error": "read_only",
                        "message": "Вам открыт только просмотр."}), 403
    res = save_items(data.get("items", []), request.user, org_id)
    if res.get("error"):
        return jsonify(res), 403
    return jsonify(res)


@app.post("/api/items/delete")
@need_auth
def api_items_delete():
    """Удаляет записи и пишет журнал удалений.

    Снимок карточки собирается здесь же, из базы: клиенту в этом доверять нельзя,
    да и история записи уходит вместе с ней по cascade — сохранить её больше негде.
    """
    data = request.get_json(silent=True) or {}
    ids = data.get("ids", [])
    reason = (data.get("reason") or "").strip()
    if not ids:
        return jsonify({"ok": True})
    if not may_write(request.user):
        return jsonify({"error": "read_only",
                        "message": "Вам открыт только просмотр."}), 403
    if len(reason) < 3:
        return jsonify({"error": "reason_required"}), 400

    user = request.user
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            select i.*, r.name as reg_name, t.name as type_name,
                   c.name as cat_name, g.name as sub_name, p.name as owner_name,
                   d.name as div_name, dep.name as dep_name
              from item i
              left join registry r    on r.id = i.registry_id
              left join item_type t   on t.id = i.type_id
              left join category c    on c.id = t.category_id
              left join subcategory g on g.id = t.subcategory_id
              left join person p      on p.id = i.owner_id
              left join division d    on d.id = i.division_id
              left join department dep on dep.id = i.department_id
             where i.id = any(%s)
        """, (ids,))
        rows = cur.fetchall()
        for r in rows:
            if reg_level(user, r["registry_id"]) != "edit":
                return jsonify({"error": "forbidden", "registry": r["registry_id"]}), 403

        # названия характеристик, чтобы снимок читался без справочников
        cur.execute("select id, name, unit from spec")
        spec_names = {r["id"]: r["name"] + (", " + r["unit"] if r["unit"] else "")
                      for r in cur.fetchall()}
        cur.execute("""select item_id, d, t, who from item_history
                        where item_id = any(%s) order by id""", (ids,))
        hist = {}
        for h in cur.fetchall():
            hist.setdefault(h["item_id"], []).append(
                {"d": h["d"], "t": h["t"], "who": h["who"] or ""})

        for r in rows:
            specs = [{"name": spec_names.get(k, k), "value": v}
                     for k, v in (r["specs"] or {}).items() if v]
            for k in (r["specs_none"] or {}):
                specs.append({"name": spec_names.get(k, k), "value": "нет"})
            cur.execute("""
                insert into deletion (staff_id, who, reason, item_id, registry_id, registry_name,
                                      inv, type_name, cat_name, sub_name, status, owner_name,
                                      division_name, department_name, notes, snapshot)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (user["id"], user["name"], reason, r["id"], r["registry_id"],
                  r["reg_name"] or "", r["inv"] or "", r["type_name"] or "",
                  r["cat_name"] or "", r["sub_name"] or "", r["status"] or "",
                  r["owner_name"] or "", r["div_name"] or "", r["dep_name"] or "",
                  r["notes"] or "",
                  json.dumps({"specs": specs, "history": hist.get(r["id"], [])},
                             ensure_ascii=False)))

        cur.execute("delete from item where id = any(%s)", (ids,))
    return jsonify({"ok": True, "logged": len(rows)})


@app.get("/api/deletions")
@need_perm("deletions.view")
def api_deletions():
    """Журнал удалений. Отдаём последние 2000 записей — дальше листать незачем."""
    out = []
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from deletion order by at desc limit 2000")
        got = cur.fetchall()
    for r in got:
        snap = r["snapshot"] or {}
        out.append({
            "id": str(r["id"]), "at": r["at"].isoformat() if r["at"] else "",
            "who": r["who"], "reason": r["reason"], "itemId": r["item_id"],
            "registryId": r["registry_id"], "regName": r["registry_name"],
            "inv": r["inv"], "typeName": r["type_name"], "catName": r["cat_name"],
            "subName": r["sub_name"], "status": r["status"], "ownerName": r["owner_name"],
            "divName": r["division_name"], "depName": r["department_name"],
            "notes": r["notes"], "specs": snap.get("specs", []),
            "history": snap.get("history", []),
        })
    return jsonify({"deletions": out})


@app.errorhandler(Exception)
def on_error(e):
    """Любая необработанная ошибка уходит в браузер текстом, а не пустой страницей.

    Без этого пользователь видел только «Не удалось сохранить настройки» и гадал,
    а разобраться можно было лишь по консоли сервера. Подробности — в консоль,
    короткая причина — на экран; это внутренний инструмент отдела, не публичный сайт.
    """
    code = getattr(e, "code", None)
    if isinstance(code, int):           # 404, 405 и прочие штатные ответы Flask
        return jsonify({"error": "http", "message": getattr(e, "description", "")}), code
    traceback.print_exc()
    return jsonify({"error": "server",
                    "message": type(e).__name__ + ": " + str(e)}), 500


# ------------------------------------------------------------------ опрос сети

def org_setting_get(cur, org_id, key):
    cur.execute("select value from org_setting where org_id = %s and key = %s", (org_id, key))
    r = cur.fetchone()
    return r["value"] if r else None


def org_setting_set(cur, org_id, key, value):
    cur.execute("""insert into org_setting (org_id, key, value) values (%s,%s,%s)
                   on conflict (org_id, key) do update set value = excluded.value""",
                (org_id, key, json.dumps(value, ensure_ascii=False)))


def _net_cfg(cur, org_id):
    return netscan.merge_config(org_setting_get(cur, org_id, "netscan") or {})


@app.get("/api/netscan")
@need_perm("ip.manage")
def api_netscan_get():
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _net_cfg(cur, org_id)
        last = org_setting_get(cur, org_id, "netscan_last")
        count = len(netscan.targets(cur, cfg, org_id))
    return jsonify({"config": cfg, "last": last, "targets": count})


@app.post("/api/netscan")
@need_perm("ip.manage")
def api_netscan_save():
    data = request.get_json(silent=True) or {}
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _net_cfg(cur, org_id)
        for k in ("enabled", "wholePools"):
            if k in data:
                cfg[k] = bool(data[k])
        for k in ("everyMin", "timeoutMs", "workers"):
            if k in data:
                try:
                    cfg[k] = int(data[k])
                except (TypeError, ValueError):
                    pass
        cfg = netscan.merge_config(cfg)
        org_setting_set(cur, org_id, "netscan", cfg)
        count = len(netscan.targets(cur, cfg, org_id))
    return jsonify({"ok": True, "config": cfg, "targets": count})


@app.post("/api/netscan/run")
@need_perm("ip.manage")
def api_netscan_run():
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _net_cfg(cur, org_id)
        try:
            stats = netscan.run(cur, cfg, org_id)
        except Exception as e:
            conn.rollback()
            return jsonify({"error": "netscan", "message": str(e)}), 400
        stats["by"] = request.user["name"]
        org_setting_set(cur, org_id, "netscan_last", stats)
    return jsonify({"ok": True, "stats": stats})


def netscan_loop():
    """Фоновый обход по расписанию.

    Проверяем настройки перед каждым кругом: включили или поменяли интервал —
    подхватится само, перезапускать сервер не нужно.
    """
    while True:
        delay = 60
        try:
            with db() as conn, conn.cursor() as cur:
                cur.execute("select id from org order by sort, name")
                org_ids = [r["id"] for r in cur.fetchall()]
                waits = []
                for oid in org_ids:
                    cfg = _net_cfg(cur, oid)
                    if not cfg.get("enabled"):
                        continue
                    waits.append(int(cfg["everyMin"]) * 60)
                    last = org_setting_get(cur, oid, "netscan_last") or {}
                    # не гоняем чаще, чем просили: у каждого учреждения свой интервал
                    if last.get("at"):
                        try:
                            was = datetime.datetime.fromisoformat(last["at"])
                            if (datetime.datetime.now() - was).total_seconds() < int(cfg["everyMin"]) * 60:
                                continue
                        except ValueError:
                            pass
                    stats = netscan.run(cur, cfg, oid)
                    stats["by"] = "по расписанию"
                    org_setting_set(cur, oid, "netscan_last", stats)
                delay = min(waits) if waits else 60
                delay = max(60, min(delay, 300))
        except Exception as e:
            print("опрос сети: " + str(e))
        time.sleep(delay)


def start_netscan():
    t = threading.Thread(target=netscan_loop, name="netscan", daemon=True)
    t.start()
    return t


# ------------------------------------------------------------------ Active Directory

def _ldap_cfg(cur, org_id):
    return adsync.merge_config(org_setting_get(cur, org_id, "ldap") or {})


@app.get("/api/ldap")
@need_perm("users.manage")
def api_ldap_get():
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _ldap_cfg(cur, org_id)
        last = org_setting_get(cur, org_id, "ldap_last")
    return jsonify({"config": adsync.public_config(cfg), "last": last})


@app.post("/api/ldap")
@need_perm("users.manage")
def api_ldap_save():
    data = request.get_json(silent=True) or {}
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _ldap_cfg(cur, org_id)
        for k in ("server", "baseDn", "user", "ou", "markAttr", "markValue"):
            if k in data:
                cfg[k] = str(data[k] or "").strip()
        for k in ("skipDisabled", "useSsl", "subtree"):
            if k in data:
                cfg[k] = bool(data[k])
        if "port" in data:
            try:
                cfg["port"] = int(data["port"] or 0)
            except (TypeError, ValueError):
                cfg["port"] = 0
        # пустое поле пароля означает «оставить прежний», а не «стереть»
        if data.get("password"):
            cfg["password"] = str(data["password"])
        if data.get("clearPassword"):
            cfg["password"] = ""
        org_setting_set(cur, org_id, "ldap", cfg)
    return jsonify({"ok": True, "config": adsync.public_config(cfg)})


@app.post("/api/ldap/test")
@need_perm("users.manage")
def api_ldap_test():
    """Проверка: подключиться, войти и показать первые несколько человек."""
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _ldap_cfg(cur, org_id)
    try:
        sample = adsync.fetch(cfg, limit=5)
    except Exception as e:
        return jsonify({"error": "ldap", "message": str(e)}), 400
    return jsonify({"ok": True, "filter": adsync.build_filter(cfg),
                    "base": adsync.search_base(cfg), "sample": sample})


@app.post("/api/ldap/sync")
@need_perm("users.manage")
def api_ldap_sync():
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _ldap_cfg(cur, org_id)
        try:
            stats, log = adsync.sync(cur, cfg, org_id)
        except Exception as e:
            conn.rollback()
            return jsonify({"error": "ldap", "message": str(e)}), 400
        stats["by"] = request.user["name"]
        org_setting_set(cur, org_id, "ldap_last", stats)
    return jsonify({"ok": True, "stats": stats, "log": log})


@app.post("/api/staff")
@need_perm("staff.manage")
def api_staff():
    """Создание и правка учётных записей сотрудников ИТ."""
    s = request.get_json(silent=True) or {}
    sid = s.get("id")
    if not sid or not (s.get("name") or "").strip():
        return jsonify({"error": "bad_request"}), 400
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            insert into staff (id, full_name, position, login, role_id, is_master, active,
                               org_id, can_edit)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (id) do update set
              full_name = excluded.full_name, position = excluded.position,
              login = excluded.login, role_id = excluded.role_id,
              is_master = excluded.is_master, active = excluded.active,
              org_id = excluded.org_id, can_edit = excluded.can_edit
        """, (sid, s["name"].strip(), s.get("position", ""), (s.get("login") or "").strip() or None,
              s.get("role") or None, bool(s.get("isMaster")), bool(s.get("active", True)),
              s.get("orgId") or None, bool(s.get("canEdit"))))
        if s.get("password"):
            cur.execute("update staff set pass_hash = %s where id = %s",
                        (hash_password(s["password"]), sid))
    return jsonify({"ok": True})


@app.post("/api/staff/delete")
@need_perm("staff.manage")
def api_staff_delete():
    sid = (request.get_json(silent=True) or {}).get("id")
    if sid == request.user["id"]:
        return jsonify({"error": "self"}), 400
    with db() as conn, conn.cursor() as cur:
        cur.execute("delete from staff where id = %s", (sid,))
    return jsonify({"ok": True})


@app.post("/api/roles")
@need_perm("staff.manage")
def api_roles():
    r = request.get_json(silent=True) or {}
    rid = r.get("id")
    if not rid or not (r.get("name") or "").strip():
        return jsonify({"error": "bad_request"}), 400
    perms = [p for p in (r.get("perms") or []) if p in PERM_CODES]
    access = {k: v for k, v in (r.get("regAccess") or {}).items() if v in ("view", "edit")}
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            insert into role (id, name, descr, perms, reg_access, builtin)
            values (%s,%s,%s,%s,%s,false)
            on conflict (id) do update set
              name = excluded.name, descr = excluded.descr,
              perms = excluded.perms, reg_access = excluded.reg_access
        """, (rid, r["name"].strip(), r.get("descr", ""), json.dumps(perms), json.dumps(access)))
    return jsonify({"ok": True})


@app.post("/api/roles/delete")
@need_perm("staff.manage")
def api_roles_delete():
    rid = (request.get_json(silent=True) or {}).get("id")
    with db() as conn, conn.cursor() as cur:
        cur.execute("select builtin from role where id = %s", (rid,))
        row = cur.fetchone()
        if not row:
            return jsonify({"ok": True})
        if row["builtin"]:
            return jsonify({"error": "builtin"}), 400
        cur.execute("select count(*) as n from staff where role_id = %s", (rid,))
        if cur.fetchone()["n"]:
            return jsonify({"error": "in_use"}), 400
        cur.execute("delete from role where id = %s", (rid,))
    return jsonify({"ok": True})


# ------------------------------------------------------------------ статика

@app.get("/")
def index():
    return send_from_directory(ROOT, "it-inventory.html")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(ROOT, filename)


if __name__ == "__main__":
    seed()
    start_netscan()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    print("Сервер «Учёт ИТ-отдела» — http://{}:{}".format(
        "localhost" if host == "0.0.0.0" else host, port))
    app.run(host=host, port=port, threaded=True)
