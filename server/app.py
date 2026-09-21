# -*- coding: utf-8 -*-
"""
Сервер «Учёт ИТ-отдела»: PostgreSQL + вход по логину + права доступа.

Запуск:  python app.py
Настройки берутся из файла .env рядом со скриптом.
"""

import os
import sys
import json
import re
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
import docscan

# Версия сборки. Должна совпадать с UI_BUILD в it-inventory.html: если файлы
# обновили, а сервер не перезапустили, приложение об этом само скажет.
APP_BUILD = "2026-09-21.1"

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

# Что видно всем вошедшим без всяких прав: своё учреждение, общий дашборд,
# уведомления, ремонты, история передач, весь «Учёт» и справочники — сотрудники,
# учреждения, склады, подразделения, отделы, места, модели. Права нужны, чтобы
# ПРАВИТЬ, и для закрытых страниц: пользователи ИТ, роли, Active Directory,
# «Все учреждения», журнал удалений.
PERMS = [
    ("admin",           "Полный доступ и админ-панель"),
    # --- учёт: одно право на всё редактирование, ниже — по частям ---
    ("ledger.edit",     "Учёт: редактировать всё (записи, разделы, IP, накладные, материалы, ремонты, списание)"),
    ("registry.manage", "Учёт: категории, типы, характеристики, наборы"),
    ("ip.manage",       "Учёт: диапазоны и резерв IP-адресов"),
    ("docs.scan",       "Учёт: приходные накладные — загрузка, разбор, заведение записей"),
    ("supply.receive",  "Учёт: приход расходных материалов"),
    ("supply.issue",    "Учёт: списание материалов на сотрудников и оборудование"),
    ("repair.send",     "Учёт: отправлять оборудование в ремонт"),
    ("repair.close",    "Учёт: выводить из ремонта"),
    ("repair.assign",   "Учёт: назначать мастера"),
    ("item.writeoff",   "Учёт: списывать оборудование"),
    # --- справочники ---
    ("dict.edit",       "Справочники: заполнять сотрудников, подразделения, отделы, места, склады, модели"),
    ("users.manage",    "Справочники: сотрудники, подразделения, отделы, места, склады"),
    ("staff.view",      "Пользователи ИТ и роли: просмотр"),
    ("staff.manage",    "Пользователи ИТ и роли: редактирование"),
    ("ad.view",         "Active Directory: просмотр настроек"),
    ("ad.sync",         "Active Directory: настройки и загрузка"),
    ("org.manage",      "Учреждения: создание и перевод пользователей ИТ"),
    # --- все учреждения ---
    ("org.viewall",     "Все учреждения: просмотр — сводка и выбор учреждения в учёте"),
    ("org.editall",     "Все учреждения: редактирование учёта в любом учреждении"),
    # --- журнал удалений ---
    ("deletions.view",  "История удалений: просмотр"),
    ("deletions.manage", "История удалений: удаление записей журнала"),
]
PERM_CODES = [p[0] for p in PERMS]

# Составные права раскрываются в частные: так проверки по всему коду остаются
# простыми («есть ли ip.manage»), а роль выдаёт одну галочку.
PERM_IMPLIES = {
    "ledger.edit": ["registry.manage", "ip.manage", "docs.scan", "supply.receive", "supply.issue",
                    "repair.send", "repair.close", "repair.assign", "item.writeoff"],
    "dict.edit":   ["users.manage"],
    "staff.manage": ["staff.view"],
    "ad.sync":     ["ad.view"],
    "org.editall": ["org.viewall"],
    "deletions.manage": ["deletions.view"],
}

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


# ------------------------------------------------------------------ номера в учёте
# Номер бывает двух видов: номенклатурный — 7 цифр, общий для одинаковых единиц,
# и инвентарный — 10 цифр, свой у каждой. Одинаковые номенклатурные различаем
# хвостом «/2», «/3»… — его дописывает сервер, а не человек.
NOM_LEN, INV_LEN = 7, 10

def inv_base(inv):
    """Номер без хвоста «/N»."""
    s = (inv or "").strip()
    i = s.rfind("/")
    if i > 0 and s[i + 1:].isdigit():
        s = s[:i]
    return s


def inv_problem(inv):
    """Почему номер не годится — или пустая строка, если всё в порядке.

    Разные промахи получают разные слова: так человеку сразу ясно, что править.
    """
    base = inv_base(inv)
    if not base:
        return ""
    if not base.isdigit():
        return "Номер состоит только из цифр: 7 — номенклатурный, 10 — инвентарный"
    n = len(base)
    if n < NOM_LEN:
        return "Неправильный номенклатурный номер: в нём 7 цифр, а здесь %d" % n
    if NOM_LEN < n < INV_LEN:
        return "Что вы хотели написать: номенклатурный (7 цифр) или инвентарный (10 цифр)?"
    if n > INV_LEN:
        return "Извините, такого инвентарного номера в вашей конторе нет: их 10 цифр, а здесь %d" % n
    return ""


def next_inv(cur, org_id, inv, skip_id=None):
    """Номенклатурный номер, который уже есть в учреждении, получает хвост /2, /3…

    Первая единица остаётся с голым номером, инвентарные (10 цифр) не трогаем.
    Считаем по всем разделам учреждения: номенклатура одна на всё предприятие.
    """
    base = inv_base(inv)
    if not (base.isdigit() and len(base) == NOM_LEN):
        return (inv or "").strip()
    cur.execute("""select i.inv from item i join registry r on r.id = i.registry_id
                    where r.org_id = %s and i.id is distinct from %s
                      and (i.inv = %s or i.inv like %s)""",
                (org_id, skip_id, base, base + "/%"))
    top = 0
    for row in cur.fetchall():
        tail = row["inv"][len(base) + 1:]
        n = int(tail) if tail.isdigit() else 1
        top = max(top, n)
    return base if top == 0 else "%s/%d" % (base, top + 1)


def perms_of(row) -> set:
    """Набор прав сотрудника: из роли; admin открывает всё, составные раскрываются."""
    p = set(row.get("perms") or [])
    if "admin" in p:
        return set(PERM_CODES)
    for code, more in PERM_IMPLIES.items():
        if code in p:
            p.update(more)
    return p


def need_any(*codes):
    """Достаточно любого из прав — для страниц с отдельными «просмотр» и «правка»."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            user = current_user()
            if not user:
                return jsonify({"error": "not_authenticated"}), 401
            if not any(c in user["perms"] for c in codes):
                return jsonify({"error": "forbidden", "need": codes[0]}), 403
            request.user = user
            return fn(*a, **kw)
        return wrapper
    return deco


_REG_ORG = {}


def reg_org_of(registry_id):
    """Учреждение раздела; кэш сбрасывается при изменении разделов."""
    if registry_id not in _REG_ORG:
        with db() as conn, conn.cursor() as cur:
            cur.execute("select org_id from registry where id = %s", (registry_id,))
            r = cur.fetchone()
            _REG_ORG[registry_id] = (r["org_id"] if r else None) or "org_main"
    return _REG_ORG[registry_id]


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
    # «Учёт» видят все; право ledger.edit даёт правку во всех разделах
    if lvl == "none":
        lvl = "view"
    if "ledger.edit" in user["perms"]:
        lvl = "edit"
    if lvl == "edit" and not user.get("can_edit"):
        return "view"
    # чужое учреждение: смотреть можно с org.viewall, править — только с org.editall
    if lvl == "edit" and reg_org_of(registry_id) != (user.get("org_id") or ""):
        if "org.editall" not in user["perms"]:
            return "view"
    return lvl


# ------------------------------------------------------------------ сессии

def current_user():
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            select s.token, s.expires_at, st.id, st.full_name, st.position, st.login,
                   st.is_master, st.active, st.role_id, st.can_edit, st.org_id,
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
        "can_edit": bool(row["can_edit"]), "org_id": row.get("org_id") or "",
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

        # Учётную запись администратора не выдумываем: пока в базе нет ни одного
        # логина, страница показывает экран первого запуска, и администратор
        # сам задаёт себе логин и пароль (/api/setup).
        if not has_accounts(cur):
            print("\n  Учётных записей ещё нет: откройте страницу в браузере и задайте")
            print("  логин и пароль администратора на экране первого запуска.")


# ------------------------------------------------------------------ чтение состояния

def js_date(v):
    return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (v or "")


def js_num(v):
    """Деньги из базы в JSON: numeric приезжает как Decimal, а его jsonify не умеет."""
    return None if v is None else float(v)


def to_num(v):
    """Деньги из браузера в базу: пустое поле — это «не указано», а не ноль."""
    if v is None or v == "":
        return None
    try:
        return round(float(str(v).replace(",", ".").replace(" ", "").replace(" ", "")), 2)
    except (TypeError, ValueError):
        return None


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
        # фото не тащим в состояние — оно отдаётся отдельным запросом по надобности
        models = [{"id": r["id"], "name": r["name"], "note": r["note"],
                   "registryId": r["registry_id"], "hasPhoto": bool(r["has_photo"])}
                  for r in (rows("""select id, name, note, registry_id, photo is not null as has_photo
                                      from model where registry_id = any(%s) order by name""", (reg_ids,))
                            if reg_ids else [])]
        places = [{"id": r["id"], "name": r["name"], "note": r["note"]}
                  for r in by_org("place", "order by name")]

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
                  "isMaster": r["is_master"], "active": r["active"],
                  "auth": r["auth"] or "local"}
                 for r in rows("select * from staff order by full_name")]

        roles = [{"id": r["id"], "name": r["name"], "descr": r["descr"], "perms": r["perms"],
                  "regAccess": r["reg_access"], "builtin": r["builtin"]}
                 for r in rows("select * from role order by sort, name")]

        warehouses = [{"id": r["id"], "code": r["code"], "name": r["name"], "note": r["note"],
                       "orgId": r["org_id"] or ""}
                      for r in by_org("warehouse", "order by code, name")]
        divisions = [{"id": r["id"], "name": r["name"]} for r in by_org("division", "order by name")]
        departments = [{"id": r["id"], "name": r["name"], "divisionId": r["division_id"] or ""}
                       for r in by_org("department", "order by name")]

        pools = [{"id": r["id"], "name": r["name"], "prefix": r["prefix"], "from": r["host_from"],
                  "to": r["host_to"], "note": r["note"], "registryId": r["registry_id"] or "",
                  "categoryId": r["category_id"] or ""} for r in by_org("ip_pool", "order by prefix")]
        reserved = [{"id": r["id"], "ip": r["ip"], "note": r["note"]}
                    for r in by_org("ip_reserved", "order by ip")]

        supplies = [{"id": r["id"], "name": r["name"], "unit": r["unit"], "note": r["note"], "qty": 0}
                    for r in by_org("supply", "order by name")]
        receipts = [{"id": r["id"], "supplyId": r["supply_id"], "qty": r["qty"],
                     "sku": r["sku"] or "", "cost": js_num(r["cost"]),
                     "date": js_date(r["d"]), "note": r["note"]}
                    for r in rows("""select r.* from supply_receipt r
                                              join supply s on s.id = r.supply_id
                                             where s.org_id = %s
                                          order by r.d desc nulls last""", (org_id,))]
        issues = [{"id": r["id"], "supplyId": r["supply_id"], "userId": r["person_id"] or "",
                   "itemId": r["item_id"] or "",
                   "sku": r["sku"] or "", "cost": js_num(r["cost"]),
                   "qty": r["qty"], "date": js_date(r["d"]), "note": r["note"]}
                  for r in rows("""select i.* from supply_issue i
                                            join supply s on s.id = i.supply_id
                                           where s.org_id = %s
                                        order by i.d desc nulls last""", (org_id,))]
        # документальный склад: списания «по бумагам», на фактические остатки не влияют
        writeoffs = [{"id": r["id"], "supplyId": r["supply_id"], "sku": r["sku"] or "",
                      "cost": js_num(r["cost"]), "qty": r["qty"], "date": js_date(r["d"]),
                      "note": r["note"], "who": r["who"] or "",
                      "at": r["at"].isoformat() if r["at"] else ""}
                     for r in by_org("stock_writeoff", "order by d desc nulls last, at desc")]
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
            for r in rows("""select h.item_id, h.d, h.t, h.who, h.transfer_id, h.at,
                                    (t.path <> '') as has_file
                               from item_history h
                               join item i on i.id = h.item_id
                               left join transfer t on t.id = h.transfer_id
                              where i.registry_id = any(%s) order by h.id""", (reg_ids,)):
                # ссылка на накладную — только у той передачи, где файл прикладывали
                hist.setdefault(r["item_id"], []).append(
                    {"d": r["d"], "t": r["t"], "who": r["who"] or "",
                     "at": r["at"].isoformat() if r["at"] else "",
                     "transferId": r["transfer_id"] if r["has_file"] else ""})

        items = []
        if reg_ids:
            for r in rows("select * from item where registry_id = any(%s) order by inv", (reg_ids,)):
                items.append({
                    "id": r["id"], "registryId": r["registry_id"], "inv": r["inv"],
                    "cost": js_num(r["cost"]),
                    "type": r["type_id"] or "", "status": r["status"],
                    "owner": r["owner_id"] or "", "division": r["division_id"] or "",
                    "department": r["department_id"] or "", "notes": r["notes"],
                    "specs": r["specs"], "specsNone": r["specs_none"],
                    "warehouse": r["warehouse_id"] or "",
                    "transferred": bool(r["transferred_at"]),
                    "model": r["model_id"] or "", "holder": r["holder"] or "person",
                    "place": r["place_id"] or "", "parent": r["parent_id"] or "",
                    "hideAttached": bool(r["hide_attached"]),
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
        "issues": issues, "writeoffs": writeoffs, "repairs": repairs, "notices": notices, "units": units,
        "netStatus": net_status, "warehouses": warehouses,
        "models": models, "places": places,
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
    if "admin" in user["perms"] or "ledger.edit" in user["perms"]:
        return True
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
            _REG_ORG.clear()
            sync_table(cur, "registry", {
                "name": lambda r: g(r, "name"), "icon": lambda r: g(r, "icon", "\u25a3"),
                "kind": lambda r: g(r, "kind", "assets"), "builtin": lambda r: bool(g(r, "builtin", False)),
                "statuses": lambda r: json.dumps(g(r, "statuses", [])),
                "layout": lambda r: json.dumps(g(r, "layout", DEF_LAYOUT)),
                "org_id": org,
            }, cfg["registries"], scope=in_org)

        if "warehouses" in cfg and can(user, "users.manage"):
            # Администратор может отдать склад другому учреждению — тогда техника,
            # переданная на этот склад, появится в учёте того учреждения. Остальным
            # склад всегда принадлежит текущему.
            cur.execute("select id from org")
            all_orgs = {r["id"] for r in cur.fetchall()}

            def wh_org(r):
                want = (g(r, "orgId") or "").strip()
                return want if (can(user, "admin") and want in all_orgs) else org_id
            for r in cfg["warehouses"]:
                if wh_org(r) != org_id:
                    cur.execute("""select count(*) as n from item i join registry g on g.id = i.registry_id
                                    where i.warehouse_id = %s and g.org_id = %s""", (r.get("id"), org_id))
                    if cur.fetchone()["n"]:
                        raise ValueError("На складе «%s» числится техника этого учреждения — "
                                         "сначала передайте её, потом меняйте учреждение склада"
                                         % (g(r, "code") or g(r, "name")))
            sync_table(cur, "warehouse", {
                "code": lambda r: g(r, "code"), "name": lambda r: g(r, "name"),
                "note": lambda r: g(r, "note"), "org_id": wh_org},
                cfg["warehouses"], scope=in_org)

        # --- модели: справочник, его заполняет тот, кому выдано dict.edit ---
        # фото через sync не ходит: оно грузится отдельным запросом, а upsert
        # по имени/примечанию его не трогает
        if "models" in cfg and can(user, "dict.edit"):
            sync_table(cur, "model", {
                "name": lambda r: g(r, "name"), "note": lambda r: g(r, "note"),
                "registry_id": lambda r: g(r, "registryId") or None},
                cfg["models"], scope=in_regs)

        # --- подразделения, отделы и места раньше людей ---
        for name, table in (("divisions", "division"), ("departments", "department"),
                            ("places", "place")):
            if name in cfg and can(user, "users.manage"):
                # примечание есть только у мест, подразделение — только у отделов
                cols = {"name": lambda r: g(r, "name"), "org_id": org}
                if table == "place":
                    cols["note"] = lambda r: g(r, "note")
                if table == "department":
                    cols["division_id"] = lambda r: g(r, "divisionId") or None
                sync_table(cur, table, cols, cfg[name], scope=in_org)

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
            if not can(user, "admin"):
                cur.execute("select value from setting where key = 'units'")
                u = cur.fetchone()
                known = {x.lower() for x in (u["value"] if u else DEF_UNITS)}
                for r in cfg["supplies"]:
                    un = (r.get("unit") or "").strip()
                    if un and un.lower() not in known:
                        raise ValueError("Единицы «%s» нет в списке. Новую единицу "
                                         "измерения может добавить только администратор" % un)
            sync_table(cur, "supply", {
                "name": lambda r: g(r, "name"), "unit": lambda r: g(r, "unit", "\u0448\u0442"),
                "note": lambda r: g(r, "note"), "org_id": org},
                cfg["supplies"], scope=in_org)
        if "receipts" in cfg and can(user, "supply.receive"):
            sync_table(cur, "supply_receipt", {
                "supply_id": lambda r: g(r, "supplyId"), "qty": lambda r: int(g(r, "qty", 0) or 0),
                "sku": lambda r: g(r, "sku"), "cost": lambda r: to_num(r.get("cost")),
                "d": lambda r: g(r, "date") or None, "note": lambda r: g(r, "note")},
                cfg["receipts"], scope=in_supplies)
        if "issues" in cfg and can(user, "supply.issue"):
            sync_table(cur, "supply_issue", {
                "supply_id": lambda r: g(r, "supplyId"),
                "person_id": lambda r: g(r, "userId") or None,
                "item_id": lambda r: g(r, "itemId") or None,
                "qty": lambda r: int(g(r, "qty", 1) or 1),
                "sku": lambda r: g(r, "sku"), "cost": lambda r: to_num(r.get("cost")),
                "d": lambda r: g(r, "date") or None, "note": lambda r: g(r, "note")},
                cfg["issues"], scope=in_supplies)
        if "writeoffs" in cfg and can(user, "supply.issue"):
            # документальные списания: тот же приём, что и у выдачи, но отдельной таблицей —
            # «Таблица склада» ведёт свой счёт и фактических остатков не трогает
            sync_table(cur, "stock_writeoff", {
                "supply_id": lambda r: g(r, "supplyId"),
                "sku": lambda r: g(r, "sku"), "cost": lambda r: to_num(r.get("cost")),
                "qty": lambda r: int(g(r, "qty", 0) or 0),
                "d": lambda r: g(r, "date") or None, "note": lambda r: g(r, "note"),
                "who": lambda r: g(r, "who"), "org_id": org},
                cfg["writeoffs"], scope=in_org)

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


def _follow_parent(cur, parent_id, user, depth=0):
    """Прикреплённое повторяет основное: статус, склад, ремонт, отметка передачи.

    Ответственный, подразделение и отдел у прикреплённого не хранятся — они берутся
    от корня цепочки при показе. А вот статус и склад копируем в базу: так «Списано»
    у компьютера списывает и его диск, и сводки считают их одинаково. Изменение
    отмечается в истории прикреплённого строкой «Вслед за инв. N». Цепочка не
    глубже пяти шагов — от случайных колец.
    """
    if depth > 5:
        return
    cur.execute("select * from item where id = %s", (parent_id,))
    p = cur.fetchone()
    if not p:
        return
    cur.execute("select * from item where parent_id = %s and holder = 'item'", (parent_id,))
    for c in cur.fetchall():
        changes = []
        if (c["status"] or "") != (p["status"] or ""):
            changes.append("статус %s → %s" % (c["status"] or "—", p["status"] or "—"))
        if (c["warehouse_id"] or "") != (p["warehouse_id"] or ""):
            changes.append("склад " + (_wh_label(cur, p["warehouse_id"]) or "—"))
        if (c["master_id"] or "") != (p["master_id"] or "") and p["status"] == "В ремонте":
            changes.append("в ремонт вместе с основным")
        cur.execute("""update item set status = %s, status_date = %s, status_note = %s,
                                       master_id = %s, warehouse_id = %s,
                                       transferred_at = %s,
                                       owner_id = null, division_id = null, department_id = null
                        where id = %s""",
                    (p["status"], p["status_date"], p["status_note"], p["master_id"],
                     p["warehouse_id"], p["transferred_at"], c["id"]))
        if changes:
            cur.execute("""insert into item_history (item_id, d, t, staff_id, who)
                           values (%s,%s,%s,%s,%s)""",
                        (c["id"], datetime.date.today().strftime("%d.%m.%Y"),
                         "Вслед за инв. %s: %s" % (p["inv"] or "—", ", ".join(changes)),
                         user["id"], user["name"]))
        _follow_parent(cur, c["id"], user, depth + 1)


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
            cur.execute("select inv from item where id = %s", (it["id"],))
            was = cur.fetchone()
            is_new = was is None
            # проверяем только новый или изменённый номер: старые записи
            # с номерами другого вида остаются как есть
            inv = (it.get("inv") or "").strip()
            if inv and (is_new or (was["inv"] or "").strip() != inv):
                why = inv_problem(inv)
                if why:
                    # исключение, а не return: транзакция откатится целиком,
                    # и из партии не запишется половина
                    raise ValueError(why)
                inv = next_inv(cur, org_id, inv, it["id"])
            it["inv"] = inv

            holder = it.get("holder") or "person"
            if holder not in ("person", "place", "item"):
                holder = "person"
            parent = (it.get("parent") or "") if holder == "item" else ""
            if parent == it["id"]:
                parent = ""                      # к самой себе не прикрепить
            cur.execute("""
                insert into item (id, registry_id, inv, cost, type_id, status, owner_id,
                                  division_id,
                                  department_id, notes, specs, specs_none, master_id,
                                  status_date, status_note, warehouse_id,
                                  model_id, holder, place_id, parent_id, hide_attached,
                                  updated_by, updated_by_name, updated_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                on conflict (id) do update set
                  registry_id = excluded.registry_id, inv = excluded.inv,
                  cost = excluded.cost, type_id = excluded.type_id,
                  status = excluded.status, owner_id = excluded.owner_id,
                  division_id = excluded.division_id, department_id = excluded.department_id,
                  notes = excluded.notes, specs = excluded.specs, specs_none = excluded.specs_none,
                  master_id = excluded.master_id, status_date = excluded.status_date,
                  status_note = excluded.status_note, warehouse_id = excluded.warehouse_id,
                  model_id = excluded.model_id, holder = excluded.holder,
                  place_id = excluded.place_id, parent_id = excluded.parent_id,
                  hide_attached = excluded.hide_attached,
                  updated_by = excluded.updated_by,
                  updated_by_name = excluded.updated_by_name, updated_at = now(),
                  transferred_at = case when excluded.status = 'На складе'
                                        then item.transferred_at else null end
            """, (it["id"], reg, it.get("inv", ""),
                  to_num(it.get("cost")), it.get("type") or None, it.get("status", ""),
                  it.get("owner") or None, it.get("division") or None, it.get("department") or None,
                  it.get("notes", ""), json.dumps(it.get("specs", {})),
                  json.dumps(it.get("specsNone", {})), it.get("masterId") or None,
                  it.get("statusDate") or None, it.get("statusNote", ""),
                  it.get("warehouse") or None,
                  it.get("model") or None, holder,
                  (it.get("place") or None) if holder == "place" else None,
                  parent or None, bool(it.get("hideAttached")) and holder == "item",
                  user["id"], user["name"]))

            # само прикреплённое подтягивается к основному, а его прикреплённое — к нему
            if holder == "item" and parent:
                _follow_parent(cur, parent, user)
            else:
                _follow_parent(cur, it["id"], user)

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

def _adauth_cfg(cur):
    cur.execute("select value from setting where key = 'adauth'")
    r = cur.fetchone()
    return adsync.merge_auth(r["value"] if r else {})


def _ad_login(cur, login, password, row):
    """Вход через домен. Возвращает строку staff или None.

    Локальные учётки (с паролем у нас) через домен не пускаем: иначе доменная
    учётка с таким же логином открывала бы чужой доступ. Через домен заходят
    только те, кто заведён как «ad», и те, кого ещё нет — их заводим сами с
    ролью и учреждением по умолчанию из настроек входа.
    """
    auth = _adauth_cfg(cur)
    if not auth.get("enabled"):
        return None
    if row is not None and (row["auth"] or "local") != "ad":
        return None
    ldap_cfg = _ldap_cfg(cur, auth.get("orgId") or "")
    try:
        who = adsync.authenticate(ldap_cfg, auth, login, password)
    except Exception:
        traceback.print_exc()
        return None
    if not who:
        return None
    if row is None:
        sid = "st" + secrets.token_hex(6)
        cur.execute("""insert into staff (id, full_name, position, login, role_id, is_master,
                                          active, org_id, can_edit, auth)
                       values (%s,%s,%s,%s,%s,false,true,%s,false,'ad')""",
                    (sid, who["name"] or who["login"], who.get("position") or "", who["login"],
                     auth.get("roleId") or None, auth.get("newOrgId") or None))
    else:
        sid = row["id"]
        if not row["active"]:
            return None
        # ФИО и должность держим свежими — домену виднее
        cur.execute("update staff set full_name = %s, position = %s where id = %s",
                    (who["name"] or row["full_name"], who.get("position") or row["position"], sid))
    cur.execute("select * from staff where id = %s", (sid,))
    return cur.fetchone()


def has_accounts(cur):
    """Есть ли хоть одна учётная запись с логином — иначе установка ещё не настроена."""
    cur.execute("select count(*) as n from staff where login is not null")
    return cur.fetchone()["n"] > 0


def _open_session(cur, staff_id):
    """Заводит сессию и отдаёт ответ с cookie — общее для входа и первого запуска."""
    token = secrets.token_urlsafe(32)
    expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=SESSION_DAYS)
    cur.execute("insert into session (token, staff_id, expires_at) values (%s,%s,%s)",
                (token, staff_id, expires))
    resp = make_response(jsonify({"ok": True}))
    resp.set_cookie(COOKIE, token, httponly=True, samesite="Lax",
                    max_age=SESSION_DAYS * 24 * 3600, path="/")
    return resp


@app.get("/api/login-info")
def api_login_info():
    """Что показать до входа: включён ли вход через домен и не первый ли это запуск."""
    with db() as conn, conn.cursor() as cur:
        return jsonify({"ad": bool(_adauth_cfg(cur).get("enabled")),
                        "setup": not has_accounts(cur)})


RE_LOGIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{2,63}$")


@app.post("/api/setup")
def api_setup():
    """Первый запуск: администратор сам задаёт логин и пароль.

    Работает только пока в базе нет ни одного логина — как только первая учётная
    запись создана, повторный вызов отвечает 409. Таблица блокируется на время
    проверки, чтобы два одновременных запроса не завели двух администраторов.
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    login = (data.get("login") or "").strip()
    password = data.get("password") or ""
    if not name:
        return jsonify({"error": "bad_value", "message": "Укажите имя"}), 400
    if not RE_LOGIN.match(login):
        return jsonify({"error": "bad_value",
                        "message": "Логин — от 3 до 64 знаков: латиница, цифры, точка, дефис"}), 400
    if len(password) < 6:
        return jsonify({"error": "bad_value", "message": "Пароль — не короче 6 знаков"}), 400
    with db() as conn, conn.cursor() as cur:
        cur.execute("lock table staff in share row exclusive mode")
        if has_accounts(cur):
            return jsonify({"error": "already_set_up"}), 409
        cur.execute("select id from org order by sort, name limit 1")
        row = cur.fetchone()
        org_id = row["id"] if row else None
        cur.execute("""
            insert into staff (id, full_name, position, login, pass_hash, role_id,
                               is_master, active, org_id, can_edit, auth)
            values ('st_admin', %s, 'Администратор системы', %s, %s, 'role_admin',
                    false, true, %s, true, 'local')
            on conflict (id) do update set
              full_name = excluded.full_name, login = excluded.login,
              pass_hash = excluded.pass_hash, role_id = 'role_admin', active = true,
              org_id = excluded.org_id, can_edit = true, auth = 'local'
        """, (name, login, hash_password(password), org_id))
        print("  Создана учётная запись администратора: " + login)
        return _open_session(cur, "st_admin")


@app.post("/api/login")
def api_login():
    data = request.get_json(silent=True) or {}
    login = (data.get("login") or "").strip()
    password = data.get("password") or ""
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from staff where lower(login) = lower(%s)", (login,))
        row = cur.fetchone()
        local_ok = bool(row and row["active"] and (row["auth"] or "local") == "local"
                        and check_password(password, row["pass_hash"] or ""))
        if not local_ok:
            row = _ad_login(cur, login, password, row)
            if not row:
                return jsonify({"error": "bad_credentials"}), 401
        return _open_session(cur, row["id"])


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
    _REG_ORG.clear()          # у нового учреждения появятся свои разделы
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
@need_auth
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
                        "toOff": by_status.get("На списание", 0),
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
    try:
        save_cfg(cfg, request.user, org_id)
    except ValueError as e:
        return jsonify({"error": "bad_value", "message": str(e)}), 400
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
    try:
        res = save_items(data.get("items", []), request.user, org_id)
    except ValueError as e:
        return jsonify({"error": "bad_inv", "message": str(e)}), 400
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
        cur.execute("""select item_id, d, t, who, at from item_history
                        where item_id = any(%s) order by id""", (ids,))
        hist = {}
        for h in cur.fetchall():
            hist.setdefault(h["item_id"], []).append(
                {"d": h["d"], "t": h["t"], "who": h["who"] or "",
                 "at": h["at"].isoformat() if h["at"] else ""})

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


@app.post("/api/deletions/delete")
@need_perm("deletions.manage")
def api_deletions_delete():
    """Запись журнала убирает тот, кому выдано deletions.manage. Без следа:
    журнал — последняя инстанция, второго журнала под него нет."""
    d = request.get_json(silent=True) or {}
    try:
        did = int(d.get("id") or 0)
    except (TypeError, ValueError):
        did = 0
    with db() as conn, conn.cursor() as cur:
        cur.execute("delete from deletion where id = %s", (did,))
        return jsonify({"ok": True, "deleted": cur.rowcount})


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


# ------------------------------------------------------------------ накладные

def _docs_cfg(cur):
    cur.execute("select value from setting where key = 'docs'")
    r = cur.fetchone()
    return docscan.merge_config(r["value"] if r else {})


def _doc_row(r):
    return {"id": r["id"], "orgId": r["org_id"] or "", "number": r["number"],
            "date": js_date(r["doc_date"]), "supplier": r["supplier"],
            "warehouse": r["warehouse"],
            "origName": r["orig_name"], "path": r["path"], "size": r["size_bytes"],
            "pages": r["pages"], "rows": r["rows_json"], "status": r["status"],
            "who": r["who"], "at": r["at"].isoformat() if r["at"] else "",
            "appliedAt": r["applied_at"].isoformat() if r["applied_at"] else ""}


@app.get("/api/docs")
@need_auth
def api_docs_list():
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _docs_cfg(cur)
        cur.execute("""select * from document where org_id = %s
                    order by at desc limit 200""", (org_id,))
        docs = [_doc_row(r) for r in cur.fetchall()]
    return jsonify({"docs": docs, "config": cfg, "ocr": docscan.ocr_status(cfg)})


@app.post("/api/docs/config")
@need_perm("docs.scan")
def api_docs_config():
    data = request.get_json(silent=True) or {}
    with db() as conn, conn.cursor() as cur:
        cfg = _docs_cfg(cur)
        for k in ("path", "lang"):
            if k in data:
                cfg[k] = str(data[k] or "").strip()
        if "dpi" in data:
            try:
                cfg["dpi"] = int(data["dpi"])
            except (TypeError, ValueError):
                pass
        cfg = docscan.merge_config(cfg)
        cur.execute("""insert into setting (key, value) values ('docs', %s)
                       on conflict (key) do update set value = excluded.value""",
                    (json.dumps(cfg, ensure_ascii=False),))
    return jsonify({"ok": True, "config": cfg, "ocr": docscan.ocr_status(cfg)})


@app.post("/api/docs/upload")
@need_perm("docs.scan")
def api_docs_upload():
    """Файл из браузера: кладём в архив, распознаём, разбираем на строки."""
    if not may_write(request.user):
        return jsonify({"error": "read_only", "message": "Вам открыт только просмотр."}), 403
    org_id = current_org(request.user)
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "no_file"}), 400
    data = f.read()

    with db() as conn, conn.cursor() as cur:
        cfg = _docs_cfg(cur)
        cur.execute("select name from org where id = %s", (org_id,))
        row = cur.fetchone()
        org_name = row["name"] if row else org_id
        try:
            rel, full = docscan.store(cfg, org_id, org_name, data, f.filename)
        except (ValueError, OSError) as e:
            return jsonify({"error": "store", "message": str(e)}), 400

        text, pages, how, angle, trows = "", 0, "none", 0, []
        try:
            # recognize подбирает поворот страницы сам и возвращает его пятым,
            # шестым — строки таблицы, прочитанные по ячейкам бланка
            text, pages, how, _alts, angle, trows = docscan.recognize(cfg, full)
        except Exception as e:
            traceback.print_exc()
            text, pages, how, angle, trows = "", 0, "none", 0, []
            note = str(e)
        else:
            note = ""

        # по ячейкам надёжнее (двухстрочные наименования), по тексту — запасной путь
        rows = trows or docscan.parse_rows(text)
        number, doc_date = docscan.parse_header(text)
        wh_code = docscan.parse_warehouse(text)

        # подсказываем, куда такая номенклатура уходила в прошлый раз
        if rows:
            cur.execute("""select sku, registry_id, type_id, supply_id from sku_hint
                            where org_id = %s and sku = any(%s)""",
                        (org_id, [r["sku"] for r in rows]))
            hint = {h["sku"]: h for h in cur.fetchall()}
            for r in rows:
                h = hint.get(r["sku"])
                if h:
                    r["target"] = h["registry_id"] or ""
                    r["typeId"] = h["type_id"] or ""
                    r["supplyId"] = h["supply_id"] or ""

        did = "doc" + secrets.token_hex(6)
        cur.execute("""
            insert into document (id, org_id, number, doc_date, orig_name, path, size_bytes,
                                  pages, ocr_text, rows_json, status, staff_id, who, warehouse)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'parsed',%s,%s,%s)
        """, (did, org_id, number or "", doc_date, f.filename, rel, len(data), pages,
              text[:200000], json.dumps(rows, ensure_ascii=False),
              request.user["id"], request.user["name"], wh_code or ""))
        cur.execute("select * from document where id = %s", (did,))
        doc = _doc_row(cur.fetchone())
    return jsonify({"ok": True, "doc": doc, "ocr": docscan.ocr_status(cfg),
                    "how": how, "angle": angle, "note": note})


@app.post("/api/docs/apply")
@need_perm("docs.scan")
def api_docs_apply():
    """Заводит записи по размеченным строкам накладной.

    Оборудование — по отдельной записи на каждую единицу: у них разные
    инвентарные номера. Материалы — одним приходом на всё количество.
    """
    if not may_write(request.user):
        return jsonify({"error": "read_only", "message": "Вам открыт только просмотр."}), 403
    d = request.get_json(silent=True) or {}
    did, rows = d.get("id"), d.get("rows") or []
    org_id = current_org(request.user)
    made = {"items": 0, "receipts": 0, "skipped": 0, "already": 0}
    log = []

    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from document where id = %s and org_id = %s", (did, org_id))
        doc = cur.fetchone()
        if not doc:
            return jsonify({"error": "not_found"}), 404
        if doc["status"] == "applied":
            return jsonify({"error": "already_applied",
                            "message": "По этой накладной уже заводили записи. "
                                       "Чтобы дописать пропущенное, попросите "
                                       "администратора открыть её заново."}), 400
        # что уже заведено в прошлый раз — по нему и сверяем
        done = {r.get("sku", "") + "|" + (r.get("name") or "")
                for r in (doc["rows_json"] or []) if r.get("done")}
        cur.execute("select id, kind from registry where org_id = %s", (org_id,))
        regs = {r["id"]: r["kind"] for r in cur.fetchall()}

        # склад из документа: заводим по номеру, если такого ещё нет
        wh_id = None
        wh_code = (d.get("warehouse") or doc["warehouse"] or "").strip()
        if not wh_code:
            return jsonify({"error": "no_warehouse",
                            "message": "Укажите склад-получатель: без него техника "
                                       "заводится в никуда"}), 400
        # раздел и номер проверяем до записи, чтобы не завести половину накладной
        for n, r in enumerate(rows, 1):
            if r.get("done"):
                continue
            target = (r.get("target") or "").strip()
            if not target or target not in regs:
                return jsonify({"error": "no_target",
                                "message": "Строка %d: выберите, куда заводить" % n}), 400
            if regs[target] != "supplies":
                why = inv_problem(r.get("sku") or "")
                if not (r.get("sku") or "").strip():
                    why = "впишите номенклатурный номер"
                if why:
                    return jsonify({"error": "bad_inv",
                                    "message": "Строка %d: %s" % (n, why)}), 400
        if wh_code:
            cur.execute("""select id from warehouse where org_id = %s
                            and btrim(code) = btrim(%s)""", (org_id, wh_code))
            got = cur.fetchone()
            if got:
                wh_id = got["id"]
            else:
                wh_id = "wh" + secrets.token_hex(5)
                cur.execute("""insert into warehouse (id, org_id, code, name)
                               values (%s,%s,%s,%s)""",
                            (wh_id, org_id, wh_code, "Склад " + wh_code))
                log.append("новый склад: " + wh_code)

        for r in rows:
            target = (r.get("target") or "").strip()
            if not target or target not in regs:
                made["skipped"] += 1
                continue
            # строку, заведённую при прошлом открытии, второй раз не проводим
            key = (r.get("sku") or "") + "|" + (r.get("name") or "")
            if r.get("done") or key in done:
                r["done"] = True
                made["already"] = made.get("already", 0) + 1
                continue
            qty = int(float(r.get("qty") or 1) or 1)
            name = (r.get("name") or "").strip()
            sku = (r.get("sku") or "").strip()

            if regs[target] == "supplies":
                sid = (r.get("supplyId") or "").strip()
                if not sid:
                    cur.execute("""select id from supply where org_id = %s
                                    and lower(btrim(name)) = lower(btrim(%s))""", (org_id, name))
                    got = cur.fetchone()
                    if got:
                        sid = got["id"]
                    else:
                        sid = "sup" + secrets.token_hex(6)
                        cur.execute("""insert into supply (id, name, unit, note, org_id)
                                       values (%s,%s,'шт','',%s)""", (sid, name, org_id))
                        log.append("новый материал: " + name)
                cur.execute("""insert into supply_receipt (id, supply_id, qty, sku, cost,
                                                          d, note, document_id)
                               values (%s,%s,%s,%s,%s,%s,%s,%s)""",
                            ("rcp" + secrets.token_hex(6), sid, qty, sku, to_num(r.get("cost")),
                             doc["doc_date"], "накладная " + (doc["number"] or ""), did))
                made["receipts"] += 1
                log.append("%s — приход %d" % (name, qty))
                cur.execute("""insert into sku_hint (org_id, sku, registry_id, supply_id, name)
                               values (%s,%s,%s,%s,%s)
                               on conflict (org_id, sku) do update set registry_id = excluded.registry_id,
                                   supply_id = excluded.supply_id, name = excluded.name,
                                   type_id = null, seen_at = now()""",
                            (org_id, sku, target, sid, name))
            else:
                # «Наименование материала» из накладной становится типом
                # оборудования в выбранной категории — заводим, если такого нет
                tid = (r.get("typeId") or "").strip() or None
                cat_id, sub_id = None, None
                pick = (r.get("catId") or "").strip()
                if pick.startswith("sub:"):
                    sub_id = pick[4:]
                    cur.execute("select category_id from subcategory where id = %s", (sub_id,))
                    got = cur.fetchone()
                    cat_id = got["category_id"] if got else None
                elif pick.startswith("cat:"):
                    cat_id = pick[4:]
                if not tid and name:
                    cur.execute("""select id from item_type where registry_id = %s
                                    and lower(btrim(name)) = lower(btrim(%s))""", (target, name))
                    got = cur.fetchone()
                    if got:
                        tid = got["id"]
                    else:
                        tid = "typ" + secrets.token_hex(5)
                        cur.execute("""insert into item_type (id, name, category_id,
                                                              subcategory_id, registry_id)
                                       values (%s,%s,%s,%s,%s)""",
                                    (tid, name, cat_id, sub_id, target))
                        log.append("новый тип: " + name)
                for _ in range(max(1, qty)):
                    item_id = "itm" + secrets.token_hex(6)
                    # одинаковая номенклатура на несколько единиц: 12345678, /2, /3…
                    inv = next_inv(cur, org_id, sku)
                    cur.execute("""
                        insert into item (id, registry_id, inv, cost, type_id, status, notes,
                                          specs, specs_none, document_id, warehouse_id,
                                          updated_by, updated_by_name)
                        values (%s,%s,%s,%s,%s,'На складе',%s,'{}','{}',%s,%s,%s,%s)
                    """, (item_id, target, inv, to_num(r.get("cost")), tid,
                          "накладная " + doc["number"] if doc["number"] else "",
                          did, wh_id, request.user["id"], request.user["name"]))
                    # в истории записи должно быть видно, кто и по какому
                    # документу её завёл — иначе потом не разобраться
                    cur.execute("""insert into item_history (item_id, d, t, staff_id, who)
                                   values (%s,%s,%s,%s,%s)""",
                                (item_id, datetime.date.today().strftime("%d.%m.%Y"),
                                 "Заведено по накладной" +
                                 (" № " + doc["number"] if doc["number"] else "") +
                                 (" от " + doc["doc_date"].strftime("%d.%m.%Y")
                                  if doc["doc_date"] else "") +
                                 (", склад " + wh_code if wh_code else ""),
                                 request.user["id"], request.user["name"]))
                    made["items"] += 1
                log.append("%s — записей: %d" % (name, max(1, qty)))
                cur.execute("""insert into sku_hint (org_id, sku, registry_id, type_id, name)
                               values (%s,%s,%s,%s,%s)
                               on conflict (org_id, sku) do update set registry_id = excluded.registry_id,
                                   type_id = excluded.type_id, name = excluded.name,
                                   supply_id = null, seen_at = now()""",
                            (org_id, sku, target, tid, name))

            # строка проведена: при повторном открытии её пропустим
            r["done"] = True

        # Клиент мог прислать не все строки — например, сотрудник удалил лишнюю
        # из таблицы. Ранее разобранные строки при этом терять нельзя: именно их
        # потом дописывают, когда накладную открывают заново.
        merged, seen = [], set()
        for r in rows:
            key = (r.get("sku") or "") + "|" + (r.get("name") or "")
            seen.add(key)
            merged.append(r)
        for r in (doc["rows_json"] or []):
            key = (r.get("sku") or "") + "|" + (r.get("name") or "")
            if key not in seen:
                merged.append(r)

        cur.execute("""update document set rows_json = %s, status = 'applied',
                              applied_at = now() where id = %s""",
                    (json.dumps(merged, ensure_ascii=False), did))
    return jsonify({"ok": True, "made": made, "log": log})


@app.post("/api/docs/reopen")
@need_perm("admin")
def api_docs_reopen():
    """Открывает уже заведённую накладную, чтобы дописать пропущенное.

    Только администратор: иначе по одному документу заведут технику дважды.
    Строки, заведённые в прошлый раз, помечены и повторно не проводятся.
    """
    d = request.get_json(silent=True) or {}
    did = d.get("id")
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from document where id = %s and org_id = %s", (did, org_id))
        doc = cur.fetchone()
        if not doc:
            return jsonify({"error": "not_found"}), 404
        cur.execute("""update document set status = 'parsed', applied_at = null
                        where id = %s""", (did,))
    return jsonify({"ok": True})


@app.post("/api/docs/delete")
@need_perm("docs.scan")
def api_docs_delete():
    """Убирает ошибочно загруженный документ — с причиной и следом в журнале.

    Накладную, по которой уже заведены записи, не удаляем: иначе у техники
    пропадёт основание, откуда она взялась. Сначала удаляют записи.
    """
    if not may_write(request.user):
        return jsonify({"error": "read_only", "message": "Вам открыт только просмотр."}), 403
    d = request.get_json(silent=True) or {}
    did = d.get("id")
    reason = (d.get("reason") or "").strip()
    if len(reason) < 3:
        return jsonify({"error": "reason_required"}), 400

    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from document where id = %s and org_id = %s", (did, org_id))
        doc = cur.fetchone()
        if not doc:
            return jsonify({"error": "not_found"}), 404

        cur.execute("select count(*) as n from item where document_id = %s", (did,))
        used = cur.fetchone()["n"]
        cur.execute("select count(*) as n from supply_receipt where document_id = %s", (did,))
        used += cur.fetchone()["n"]
        if used:
            return jsonify({"error": "in_use", "count": used,
                            "message": "По этой накладной заведено записей: %d. "
                                       "Сначала удалите их." % used}), 400

        cfg = _docs_cfg(cur)
        rows = doc["rows_json"] or []
        # тот же журнал, что и для записей учёта: искать потом надо в одном месте
        cur.execute("""
            insert into deletion (org_id, staff_id, who, reason, item_id, registry_id,
                                  registry_name, inv, type_name, status, notes, snapshot)
            values (%s,%s,%s,%s,%s,'','Накладные',%s,%s,'документ',%s,%s)
        """, (org_id, request.user["id"], request.user["name"], reason, did,
              doc["number"] or "", doc["orig_name"] or "",
              "склад " + (doc["warehouse"] or "—") + ", строк: %d" % len(rows),
              json.dumps({"specs": [{"name": "Файл в архиве", "value": doc["path"] or ""},
                                    {"name": "Дата документа", "value": js_date(doc["doc_date"])},
                                    {"name": "Принял", "value": doc["who"] or ""}],
                          "history": [{"d": (doc["at"].strftime("%d.%m.%Y")
                                             if doc["at"] else ""),
                                       "t": "Накладная загружена", "who": doc["who"] or ""}]},
                         ensure_ascii=False)))

        # файл в архиве тоже убираем: документ загружен по ошибке
        removed = False
        try:
            f = Path(cfg["path"]) / doc["path"]
            if doc["path"] and f.exists():
                f.unlink()
                removed = True
        except OSError:
            pass

        cur.execute("delete from document where id = %s", (did,))
    return jsonify({"ok": True, "fileRemoved": removed})


@app.get("/api/docs/<doc_id>/file")
@need_perm("docs.scan")
def api_docs_file(doc_id):
    """Отдаёт сам файл накладной из архива."""
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _docs_cfg(cur)
        cur.execute("select * from document where id = %s and org_id = %s", (doc_id, org_id))
        doc = cur.fetchone()
    if not doc:
        return jsonify({"error": "not_found"}), 404
    # старые записи могли попасть в базу с обратными косыми — приводим к общему виду
    rel = (doc["path"] or "").replace(chr(92), "/")
    full = Path(cfg["path"]) / rel
    if not rel or not full.exists():
        # голый 404 заставляет гадать; чаще всего папку архива меняли после загрузки
        return jsonify({"error": "file_missing",
                        "message": "Файл не найден по пути «%s». Проверьте папку архива "
                                   "в настройках: если её меняли после загрузки, файл "
                                   "остался в прежней." % full}), 404
    return send_from_directory(cfg["path"], rel, as_attachment=False,
                               download_name=doc["orig_name"])


# ------------------------------------------------------------------ фото моделей

PHOTO_MAX_SIDE = 900          # хватает, чтобы узнать технику; в базе — десятки КБ
PHOTO_MAX_BYTES = 12 * 1024 * 1024


def _model_of_org(cur, model_id, org_id):
    cur.execute("""select m.* from model m join registry r on r.id = m.registry_id
                    where m.id = %s and r.org_id = %s""", (model_id, org_id))
    return cur.fetchone()


@app.post("/api/models/<model_id>/photo")
@need_perm("dict.edit")
def api_model_photo_set(model_id):
    """Фотография модели: ужимаем до 900 px по большей стороне и храним в базе."""
    org_id = current_org(request.user)
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "no_file"}), 400
    raw = f.read()
    if len(raw) > PHOTO_MAX_BYTES:
        return jsonify({"error": "too_big", "message": "Файл больше 12 МБ"}), 400
    try:
        from PIL import Image, ImageOps
        import io as _io
        im = Image.open(_io.BytesIO(raw))
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((PHOTO_MAX_SIDE, PHOTO_MAX_SIDE))
        buf = _io.BytesIO()
        im.save(buf, "JPEG", quality=85, optimize=True)
        data = buf.getvalue()
    except Exception:
        return jsonify({"error": "bad_image", "message": "Это не изображение"}), 400
    with db() as conn, conn.cursor() as cur:
        if not _model_of_org(cur, model_id, org_id):
            return jsonify({"error": "not_found"}), 404
        cur.execute("update model set photo = %s, photo_type = 'image/jpeg' where id = %s",
                    (data, model_id))
    return jsonify({"ok": True, "size": len(data)})


@app.post("/api/models/<model_id>/photo/delete")
@need_perm("dict.edit")
def api_model_photo_delete(model_id):
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        if not _model_of_org(cur, model_id, org_id):
            return jsonify({"error": "not_found"}), 404
        cur.execute("update model set photo = null, photo_type = '' where id = %s", (model_id,))
    return jsonify({"ok": True})


@app.get("/api/models/<model_id>/photo")
@need_auth
def api_model_photo(model_id):
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        m = _model_of_org(cur, model_id, org_id)
    if not m or not m["photo"]:
        return jsonify({"error": "not_found"}), 404
    resp = make_response(bytes(m["photo"]))
    resp.headers["Content-Type"] = m["photo_type"] or "image/jpeg"
    resp.headers["Cache-Control"] = "private, max-age=60"
    return resp


# ------------------------------------------------------------------ передача по складам

def _wh_label(cur, wh_id):
    if not wh_id:
        return ""
    cur.execute("select code, name from warehouse where id = %s", (wh_id,))
    w = cur.fetchone()
    if not w:
        return ""
    return " · ".join(x for x in ((w["code"] or "").strip(), (w["name"] or "").strip()) if x) or wh_id


def _transfer_row(r):
    return {"id": r["id"], "itemId": r["item_id"] or "", "inv": r["inv"],
            "typeName": r["type_name"], "fromWh": r["from_wh_id"] or "",
            "fromLabel": r["from_label"], "toWh": r["to_wh_id"] or "", "toLabel": r["to_label"],
            "orgId": r["org_id"] or "", "toOrgId": r["to_org_id"] or "",
            "note": r["note"], "origName": r["orig_name"], "hasFile": bool(r["path"]),
            "who": r["who"], "at": r["at"].isoformat() if r["at"] else ""}


def _find_or_make(cur, table, cols, key, make):
    """Строка справочника по названию без учёта регистра — или новая.

    cols/key — условие поиска, make — значения для вставки. Нужна при переезде
    техники в другое учреждение: там свои категории, подкатегории и типы.
    """
    where = " and ".join("%s = %%s" % c for c in cols)
    cur.execute("select id from %s where %s and lower(btrim(name)) = lower(btrim(%%s))"
                % (table, where), tuple(key) + (make["name"],))
    got = cur.fetchone()
    if got:
        return got["id"]
    names = ", ".join(make.keys())
    holes = ", ".join(["%s"] * len(make))
    cur.execute("insert into %s (%s) values (%s)" % (table, names, holes), tuple(make.values()))
    return make["id"]


def _move_item_to_org(cur, it, to_org):
    """Переносит запись в раздел другого учреждения.

    Разделы у каждого учреждения свои (`<учреждение>_<раздел>`), поэтому ищем
    одноимённый по исходному имени, а если его нет — по названию. Тип, категорию и
    подкатегорию заводим там по названиям, если таких ещё нет. Характеристики
    переносим по названиям в пределах найденного типа/подкатегории; чему пары не
    нашлось — дописываем в примечание, чтобы значения не пропали.
    Возвращает (registry_id, type_id, specs, specs_none, notes, model_id).
    """
    src_reg = it["registry_id"]
    base = src_reg.split("_", 1)[1] if "_" in src_reg else src_reg
    cur.execute("select id, name from registry where org_id = %s and (id = %s or id = %s)",
                (to_org, base, to_org + "_" + base))
    reg = cur.fetchone()
    if not reg:
        cur.execute("select name from registry where id = %s", (src_reg,))
        nm = cur.fetchone()["name"]
        cur.execute("""select id, name from registry where org_id = %s and kind <> 'supplies'
                        and lower(btrim(name)) = lower(btrim(%s))""", (to_org, nm))
        reg = cur.fetchone()
        if not reg:
            raise ValueError("В учреждении-получателе нет раздела «%s» — заведите его там" % nm)
    dst_reg = reg["id"]

    type_id, specs, specs_none, notes = None, dict(it["specs"] or {}), dict(it["specs_none"] or {}), it["notes"] or ""
    if it["type_id"]:
        cur.execute("""select t.name, c.name as cat, sc.name as sub from item_type t
                         left join category c on c.id = t.category_id
                         left join subcategory sc on sc.id = t.subcategory_id
                        where t.id = %s""", (it["type_id"],))
        t = cur.fetchone()
        cat_id = sub_id = None
        if t and t["cat"]:
            cat_id = _find_or_make(cur, "category", ["registry_id"], [dst_reg],
                                   {"id": "cat" + secrets.token_hex(5), "name": t["cat"], "registry_id": dst_reg})
        if t and t["sub"] and cat_id:
            sub_id = _find_or_make(cur, "subcategory", ["registry_id", "category_id"], [dst_reg, cat_id],
                                   {"id": "sub" + secrets.token_hex(5), "name": t["sub"],
                                    "category_id": cat_id, "registry_id": dst_reg})
        if t:
            type_id = _find_or_make(cur, "item_type", ["registry_id"], [dst_reg],
                                    {"id": "typ" + secrets.token_hex(5), "name": t["name"],
                                     "category_id": cat_id, "subcategory_id": sub_id,
                                     "registry_id": dst_reg})
        # характеристики: по названию среди тех, что привязаны к найденному типу или подкатегории
        cur.execute("select id, name from spec where type_id = %s or subcategory_id = %s",
                    (type_id, sub_id or "-"))
        dst = {sp["name"].strip().lower(): sp["id"] for sp in cur.fetchall()}
        keys = list(specs.keys()) + list(specs_none.keys())
        cur.execute("select id, name from spec where id = any(%s)", (keys or [""],))
        src_names = {sp["id"]: sp["name"] for sp in cur.fetchall()}
        new_specs, new_none, lost = {}, {}, []
        for k, v in specs.items():
            nm = src_names.get(k, k)
            d = dst.get(nm.strip().lower())
            if d:
                new_specs[d] = v
            else:
                lost.append("%s=%s" % (nm, v))
        for k in specs_none:
            d = dst.get(src_names.get(k, k).strip().lower())
            if d:
                new_none[d] = True
        specs, specs_none = new_specs, new_none
        if lost:
            notes = (notes + "\n" if notes else "") + "Характеристики при передаче: " + "; ".join(lost)
    else:
        specs, specs_none = {}, {}
    model_id = None
    if it.get("model_id"):
        cur.execute("select name, note from model where id = %s", (it["model_id"],))
        m = cur.fetchone()
        if m:
            model_id = _find_or_make(cur, "model", ["registry_id"], [dst_reg],
                                     {"id": "mdl" + secrets.token_hex(5), "name": m["name"],
                                      "note": m["note"] or "", "registry_id": dst_reg})
    return dst_reg, type_id, specs, specs_none, notes, model_id


@app.post("/api/transfer")
@need_auth
def api_transfer():
    """Передаёт единицу оборудования на другой склад.

    Отдельный запрос, а не часть сохранения карточки: вместе с передачей приходит
    файл накладной, а JSON файлов не носит. Порядок в карточке: сначала обычное
    сохранение, потом передача — чтобы сохранение не затёрло новый склад.
    """
    if not may_write(request.user):
        return jsonify({"error": "read_only", "message": "Вам открыт только просмотр."}), 403
    org_id = current_org(request.user)
    item_id = (request.form.get("itemId") or "").strip()
    to_wh = (request.form.get("toWh") or "").strip()
    note = (request.form.get("note") or "").strip()
    f = request.files.get("file")

    with db() as conn, conn.cursor() as cur:
        cur.execute("""select i.*, r.org_id, t.name as type_name from item i
                         join registry r on r.id = i.registry_id
                         left join item_type t on t.id = i.type_id
                        where i.id = %s""", (item_id,))
        it = cur.fetchone()
        if not it or it["org_id"] != org_id:
            return jsonify({"error": "not_found"}), 404
        if reg_level(request.user, it["registry_id"]) != "edit":
            return jsonify({"error": "forbidden"}), 403
        # склад-получатель может быть в другом учреждении — тогда техника уедет туда
        cur.execute("""select w.id, w.org_id, o.name as org_name from warehouse w
                         left join org o on o.id = w.org_id where w.id = %s""", (to_wh,))
        dst = cur.fetchone()
        if not dst:
            return jsonify({"error": "no_warehouse", "message": "Выберите склад-получатель"}), 400
        if to_wh == (it["warehouse_id"] or ""):
            return jsonify({"error": "same_warehouse",
                            "message": "Техника и так на этом складе"}), 400
        to_org = dst["org_id"] or org_id
        cur.execute("select name from org where id = %s", (org_id,))
        _o = cur.fetchone()
        src_org_name = _o["name"] if _o else org_id

        rel, orig = "", ""
        if f and f.filename:
            cfg = _docs_cfg(cur)
            cur.execute("select name from org where id = %s", (org_id,))
            row = cur.fetchone()
            try:
                rel, _full = docscan.store(cfg, org_id, row["name"] if row else org_id,
                                           f.read(), f.filename, sub="передача")
            except (ValueError, OSError) as e:
                return jsonify({"error": "store", "message": str(e)}), 400
            orig = f.filename

        from_label, to_label = _wh_label(cur, it["warehouse_id"]), _wh_label(cur, to_wh)
        cross = to_org != org_id
        if cross:
            # в подписях — учреждения, чтобы в списке было видно, куда уехало
            from_label = (from_label or "—") + " (" + src_org_name + ")"
            to_label = (to_label or "—") + " (" + (dst["org_name"] or to_org) + ")"
            try:
                dst_reg, dst_type, specs, specs_none, notes, dst_model = _move_item_to_org(cur, it, to_org)
            except ValueError as e:
                return jsonify({"error": "no_registry", "message": str(e)}), 400
        tid = "trf" + secrets.token_hex(6)
        cur.execute("""insert into transfer (id, org_id, to_org_id, item_id, inv, type_name,
                                             from_wh_id, from_label, to_wh_id, to_label, note,
                                             orig_name, path, staff_id, who)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (tid, org_id, to_org, item_id, it["inv"] or "", it["type_name"] or "",
                     it["warehouse_id"], from_label, to_wh, to_label, note, orig, rel,
                     request.user["id"], request.user["name"]))
        # Переданная техника всегда оказывается «На складе» и без ответственного:
        # сотрудник одного учреждения не работает на технике другого. Так же и
        # внутри учреждения — на новом складе её ещё никому не выдали.
        cur.execute("""update item set warehouse_id = %s, status = 'На складе',
                                       owner_id = null, division_id = null, department_id = null,
                                       holder = 'person', place_id = null, parent_id = null,
                                       hide_attached = false,
                                       master_id = null, status_date = null, status_note = '',
                                       transferred_at = now(),
                                       updated_by = %s, updated_by_name = %s, updated_at = now()
                        where id = %s""", (to_wh, request.user["id"], request.user["name"], item_id))
        if cross:
            cur.execute("""update item set registry_id = %s, type_id = %s, specs = %s,
                                           specs_none = %s, notes = %s, model_id = %s where id = %s""",
                        (dst_reg, dst_type, json.dumps(specs), json.dumps(specs_none), notes,
                         dst_model, item_id))
            # прикреплённое переезжает в то же учреждение вслед за основным
            stack, seen = [item_id], set()
            while stack:
                pid = stack.pop()
                cur.execute("select * from item where parent_id = %s and holder = 'item'", (pid,))
                for c in cur.fetchall():
                    if c["id"] in seen:
                        continue
                    seen.add(c["id"]); stack.append(c["id"])
                    try:
                        c_reg, c_type, c_specs, c_none, c_notes, c_model = _move_item_to_org(cur, c, to_org)
                    except ValueError:
                        continue
                    cur.execute("""update item set registry_id = %s, type_id = %s, specs = %s,
                                                   specs_none = %s, notes = %s, model_id = %s where id = %s""",
                                (c_reg, c_type, json.dumps(c_specs), json.dumps(c_none), c_notes,
                                 c_model, c["id"]))
        _follow_parent(cur, item_id, request.user)

        today = datetime.date.today().strftime("%d.%m.%Y")
        who = (request.user["id"], request.user["name"])
        if it["owner_id"] or it["division_id"] or it["department_id"]:
            cur.execute("""select p.name as p, d.name as d, dep.name as dep
                             from (select 1) x
                             left join person p on p.id = %s
                             left join division d on d.id = %s
                             left join department dep on dep.id = %s""",
                        (it["owner_id"], it["division_id"], it["department_id"]))
            w = cur.fetchone()
            cur.execute("""insert into item_history (item_id, d, t, staff_id, who)
                           values (%s,%s,%s,%s,%s)""",
                        (item_id, today, "Снято с сотрудника при передаче: " +
                         ", ".join(x for x in ((w["p"] or "—"), w["d"] or "", w["dep"] or "") if x)) + who)
        if (it["status"] or "") != "На складе":
            cur.execute("""insert into item_history (item_id, d, t, staff_id, who)
                           values (%s,%s,%s,%s,%s)""",
                        (item_id, today, "Статус: %s → На складе" % (it["status"] or "—")) + who)
        text = "Передано со склада %s на склад %s" % (from_label or "—", to_label or "—")
        if note:
            text += ". Примечание: " + note
        if orig:
            text += " (накладная " + orig + ")"
        cur.execute("""insert into item_history (item_id, d, t, staff_id, who, transfer_id)
                       values (%s,%s,%s,%s,%s,%s)""",
                    (item_id, today, text) + who + (tid,))
        cur.execute("select * from transfer where id = %s", (tid,))
        return jsonify({"ok": True, "transfer": _transfer_row(cur.fetchone())})


@app.get("/api/transfers")
@need_auth
def api_transfers():
    """Накладные по передаче текущего учреждения, новые сверху."""
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cur.execute("""select * from transfer where org_id = %s or to_org_id = %s
                        order by at desc limit 1000""", (org_id, org_id))
        return jsonify({"transfers": [_transfer_row(r) for r in cur.fetchall()]})


@app.post("/api/transfers/delete")
@need_perm("admin")
def api_transfer_delete():
    """Запись о передаче убирает только администратор и только с причиной.

    Сама техника остаётся там, куда её передали: удаляется документ и строка
    списка, а в журнал удалений ложится снимок, чтобы потом было с чем сверять.
    Строка в истории карточки остаётся, но ссылка на файл из неё пропадает.
    """
    d = request.get_json(silent=True) or {}
    tid = (d.get("id") or "").strip()
    reason = (d.get("reason") or "").strip()
    if len(reason) < 3:
        return jsonify({"error": "reason_required", "message": "Укажите причину удаления"}), 400
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cur.execute("select * from transfer where id = %s and (org_id = %s or to_org_id = %s)",
                    (tid, org_id, org_id))
        t = cur.fetchone()
        if not t:
            return jsonify({"error": "not_found"}), 404
        # из «Истории передач» передачу с накладной не удалить: документ
        # убирают там, где его видно — на экране «Накладные по передаче»
        if (d.get("source") or "") == "hist" and t["path"]:
            return jsonify({"error": "has_doc",
                            "message": "У этой передачи есть накладная — удаляйте её на "
                                       "экране «Накладные по передаче»"}), 400
        cfg = _docs_cfg(cur)
        cur.execute("""
            insert into deletion (org_id, staff_id, who, reason, item_id, registry_id,
                                  registry_name, inv, type_name, status, notes, snapshot)
            values (%s,%s,%s,%s,%s,'','Передачи',%s,%s,'передача',%s,%s)
        """, (org_id, request.user["id"], request.user["name"], reason, tid,
              t["inv"] or "", t["type_name"] or "",
              "со склада %s на склад %s" % (t["from_label"] or "—", t["to_label"] or "—") +
              (", накладная " + t["orig_name"] if t["orig_name"] else ", без накладной"),
              json.dumps({"specs": [{"name": "Откуда", "value": t["from_label"] or ""},
                                    {"name": "Куда", "value": t["to_label"] or ""},
                                    {"name": "Примечание к передаче", "value": t["note"] or ""},
                                    {"name": "Файл в архиве", "value": t["path"] or ""},
                                    {"name": "Запись учёта", "value": t["item_id"] or ""}],
                          "history": [{"d": t["at"].strftime("%d.%m.%Y %H:%M") if t["at"] else "",
                                       "t": "Передача выполнена", "who": t["who"] or ""}]},
                         ensure_ascii=False)))
        cur.execute("update item_history set transfer_id = null where transfer_id = %s", (tid,))
        cur.execute("delete from transfer where id = %s", (tid,))
    if t["path"]:
        try:
            full = Path(cfg["path"]) / t["path"].replace(chr(92), "/")
            if full.exists():
                full.unlink()
        except OSError:
            pass
    return jsonify({"ok": True})


@app.get("/api/warehouses/all")
@need_auth
def api_warehouses_all():
    """Склады всех учреждений — для выбора получателя при передаче."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("""select w.id, w.code, w.name, w.org_id, o.name as org_name
                         from warehouse w left join org o on o.id = w.org_id
                        order by o.sort, o.name, w.code, w.name""")
        return jsonify({"warehouses": [{"id": r["id"], "code": r["code"], "name": r["name"],
                                        "orgId": r["org_id"] or "", "orgName": r["org_name"] or ""}
                                       for r in cur.fetchall()]})


@app.get("/api/transfers/<tid>/file")
@need_auth
def api_transfer_file(tid):
    org_id = current_org(request.user)
    with db() as conn, conn.cursor() as cur:
        cfg = _docs_cfg(cur)
        cur.execute("select * from transfer where id = %s and (org_id = %s or to_org_id = %s)",
                    (tid, org_id, org_id))
        t = cur.fetchone()
    if not t:
        return jsonify({"error": "not_found"}), 404
    rel = (t["path"] or "").replace(chr(92), "/")
    full = Path(cfg["path"]) / rel
    if not rel or not full.exists():
        return jsonify({"error": "file_missing",
                        "message": "Файл не найден по пути «%s». Проверьте папку архива "
                                   "в настройках: если её меняли после загрузки, файл "
                                   "остался в прежней." % full}), 404
    return send_from_directory(cfg["path"], rel, as_attachment=False, download_name=t["orig_name"])


# ------------------------------------------------------------------ Active Directory

def target_org(user, want):
    """Учреждение, с которым работает запрос.

    Явный выбор нужен, чтобы загрузка из домена не уехала не туда: человек
    смотрит одно учреждение, а грузит в другое. Чужое не отдаём — проверяем
    по тому же списку доступных, что и везде.
    """
    allowed = [o["id"] for o in orgs_of(user)]
    want = (want or "").strip()
    if want:
        return want if want in allowed else None
    return current_org(user)


def _ldap_cfg(cur, org_id):
    return adsync.merge_config(org_setting_get(cur, org_id, "ldap") or {})


@app.get("/api/adauth")
@need_any("ad.view", "ad.sync")
def api_adauth_get():
    with db() as conn, conn.cursor() as cur:
        return jsonify({"config": _adauth_cfg(cur)})


@app.post("/api/adauth")
@need_perm("admin")
def api_adauth_set():
    """Настройки входа через домен — только администратор: они решают, кто вообще
    может войти и с какой ролью."""
    d = request.get_json(silent=True) or {}
    cfg = adsync.merge_auth({
        "enabled": bool(d.get("enabled")), "orgId": (d.get("orgId") or "").strip(),
        "suffix": (d.get("suffix") or "").strip().lstrip("@"), "group": (d.get("group") or "").strip(),
        "roleId": (d.get("roleId") or "").strip(), "newOrgId": (d.get("newOrgId") or "").strip()})
    with db() as conn, conn.cursor() as cur:
        cur.execute("""insert into setting (key, value) values ('adauth', %s)
                       on conflict (key) do update set value = excluded.value""",
                    (json.dumps(cfg, ensure_ascii=False),))
    return jsonify({"ok": True, "config": cfg})


@app.post("/api/adauth/test")
@need_perm("admin")
def api_adauth_test():
    """Проверка входа: администратор вводит свой доменный логин и пароль."""
    d = request.get_json(silent=True) or {}
    with db() as conn, conn.cursor() as cur:
        auth = adsync.merge_auth(d.get("config") or _adauth_cfg(cur))
        ldap_cfg = _ldap_cfg(cur, auth.get("orgId") or "")
    # группу проверяем отдельно и заранее: опечатка в названии закрывала бы вход
    # всем, а выглядело бы это как «домен не принял пароль»
    group = None
    if (auth.get("group") or "").strip():
        try:
            group = adsync.check_group(ldap_cfg, auth["group"])
        except Exception as e:
            return jsonify({"error": "ldap", "message": str(e)}), 400
    try:
        who = adsync.authenticate(ldap_cfg, auth, d.get("login") or "", d.get("password") or "")
    except Exception as e:
        return jsonify({"error": "ldap", "message": str(e)}), 400
    if not who:
        msg = "Домен не принял логин и пароль или учётная запись отключена"
        if group:
            msg = ("Домен не принял логин и пароль, учётная запись отключена или человек "
                   "не состоит в группе %s (в ней сейчас %d чел.)"
                   % (group["dn"], group.get("members") or 0))
        return jsonify({"error": "bad_credentials", "message": msg, "group": group}), 401
    # домен-то принял, а войти на странице всё равно не выйдет, если под этим логином
    # уже заведена учётка с нашим паролем: через домен пускаем только «ad»-учётки
    with db() as conn, conn.cursor() as cur:
        cur.execute("""select full_name, auth, active from staff
                        where lower(login) = lower(%s)""", (who["login"],))
        row = cur.fetchone()
    clash = None
    if row and (row["auth"] or "local") != "ad":
        clash = {"name": row["full_name"], "active": bool(row["active"])}
    return jsonify({"ok": True, "who": who, "group": group,
                    "enabled": bool(auth.get("enabled")), "clash": clash})


@app.get("/api/ldap")
@need_any("ad.view", "ad.sync")
def api_ldap_get():
    org_id = target_org(request.user, request.args.get("orgId"))
    if not org_id:
        return jsonify({"error": "forbidden", "message": "Учреждение недоступно"}), 403
    with db() as conn, conn.cursor() as cur:
        cfg = _ldap_cfg(cur, org_id)
        last = org_setting_get(cur, org_id, "ldap_last")
    return jsonify({"config": adsync.public_config(cfg), "last": last, "orgId": org_id})


@app.post("/api/ldap")
@need_perm("ad.sync")
def api_ldap_save():
    data = request.get_json(silent=True) or {}
    org_id = target_org(request.user, data.get("orgId"))
    if not org_id:
        return jsonify({"error": "forbidden", "message": "Учреждение недоступно"}), 403
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
    return jsonify({"ok": True, "config": adsync.public_config(cfg), "orgId": org_id})


@app.post("/api/ldap/test")
@need_perm("ad.sync")
def api_ldap_test():
    """Проверка: подключиться, войти и показать первые несколько человек."""
    org_id = target_org(request.user, (request.get_json(silent=True) or {}).get("orgId"))
    if not org_id:
        return jsonify({"error": "forbidden", "message": "Учреждение недоступно"}), 403
    with db() as conn, conn.cursor() as cur:
        cfg = _ldap_cfg(cur, org_id)
    try:
        res = adsync.probe(cfg, limit=5)
    except Exception as e:
        return jsonify({"error": "ldap", "message": str(e)}), 400
    # base отдаём тот, который домен выдал на самом деле: название подразделения
    # из настроек разворачивается в полный DN, и это видно администратору
    return jsonify({"ok": True, "filter": res["filter"],
                    "base": res["base"], "sample": res["sample"]})


@app.post("/api/ldap/sync")
@need_perm("ad.sync")
def api_ldap_sync():
    org_id = target_org(request.user, (request.get_json(silent=True) or {}).get("orgId"))
    if not org_id:
        return jsonify({"error": "forbidden", "message": "Учреждение недоступно"}), 403
    if not may_write(request.user):
        return jsonify({"error": "read_only",
                        "message": "Вам открыт только просмотр."}), 403
    with db() as conn, conn.cursor() as cur:
        cfg = _ldap_cfg(cur, org_id)
        try:
            stats, log = adsync.sync(cur, cfg, org_id)
        except Exception as e:
            conn.rollback()
            return jsonify({"error": "ldap", "message": str(e)}), 400
        stats["by"] = request.user["name"]
        stats["org"] = org_id
        org_setting_set(cur, org_id, "ldap_last", stats)
    return jsonify({"ok": True, "stats": stats, "log": log, "orgId": org_id})


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
        # откуда пароль: «ad» — проверяет домен, свой пароль стирается
        auth = "ad" if s.get("auth") == "ad" else "local"
        cur.execute("update staff set auth = %s where id = %s", (auth, sid))
        if auth == "ad":
            cur.execute("update staff set pass_hash = null where id = %s", (sid,))
        elif s.get("password"):
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
