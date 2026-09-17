# -*- coding: utf-8 -*-
"""Загрузка пользователей из Active Directory по LDAP.

Берём только те учётные записи, у которых в атрибуте-признаке (по умолчанию
employeeType) стоит условленное значение — так администратор домена сам решает,
кто попадает в учёт, не трогая наше приложение.

Что откуда:

    вкладка «Общие»        givenName        Имя
                           initials         Инициалы
                           sn               Фамилия
                           telephoneNumber  Номер телефона
                           mail             Эл. почта

    вкладка «Организация»  title            Должность
                           department       Отдел
                           company          Организация -> Подразделение

Отделы и подразделения, которых в учёте ещё нет, заводятся сами.
Ничего не удаляем: человек, пропавший из выборки AD, остаётся в справочнике —
за ним может числиться техника.
"""
import datetime
import secrets

from ldap3 import Server, Connection, ALL, SUBTREE, LEVEL, SIMPLE

# Атрибуты, которые забираем из домена
ATTRS = ["givenName", "initials", "sn", "telephoneNumber", "mail",
         "title", "department", "company", "displayName", "cn",
         "sAMAccountName", "objectGUID", "userAccountControl"]

DEFAULTS = {
    "server": "", "baseDn": "", "user": "", "password": "",
    "ou": "",                 # искать только в этом подразделении AD
    "subtree": True,          # вместе с вложенными или только на одном уровне
    "markAttr": "employeeType", "markValue": "ok",
    "skipDisabled": True, "useSsl": False, "port": 0,
}

ACCOUNT_DISABLED = 0x0002


def merge_config(saved):
    cfg = dict(DEFAULTS)
    cfg.update(saved or {})
    return cfg


def public_config(cfg):
    """То, что можно отдать в браузер: пароль наружу не уходит никогда."""
    out = {k: v for k, v in cfg.items() if k != "password"}
    out["hasPassword"] = bool(cfg.get("password"))
    return out


def _one(entry, attr):
    """Значение атрибута строкой. ldap3 отдаёт то список, то одиночное значение."""
    v = entry.get(attr)
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        v = v[0] if v else ""
    if isinstance(v, bytes):
        try:
            v = v.decode("utf-8", "replace")
        except Exception:
            v = ""
    return str(v).strip()


def _guid(entry):
    """objectGUID: ldap3 отдаёт то строку вида {...}, то сырые 16 байт."""
    v = entry.get("objectGUID")
    if isinstance(v, (list, tuple)):
        v = v[0] if v else None
    if v is None:
        return ""
    if isinstance(v, bytes):
        if len(v) != 16:
            return ""
        import uuid
        return str(uuid.UUID(bytes_le=v))
    return str(v).strip().strip("{}").lower()


def full_name(entry):
    """Фамилия Имя Инициалы — как принято в русских документах.

    Если в домене имя не разложено по полям, берём отображаемое имя целиком.
    """
    parts = [_one(entry, "sn"), _one(entry, "givenName"), _one(entry, "initials")]
    name = " ".join(p for p in parts if p).strip()
    return name or _one(entry, "displayName") or _one(entry, "cn") or _one(entry, "sAMAccountName")


def escape_filter(v):
    """Экранирование по RFC 4515 — иначе значение с * или ( сломает запрос."""
    out = []
    for ch in str(v):
        if ch in "\\*()\0":
            out.append("\\%02x" % ord(ch))
        else:
            out.append(ch)
    return "".join(out)


def build_filter(cfg):
    attr = (cfg.get("markAttr") or "employeeType").strip()
    val = escape_filter((cfg.get("markValue") or "ok").strip())
    return "(&(objectCategory=person)(objectClass=user)(%s=%s))" % (attr, val)


def search_base(cfg):
    """Откуда искать.

    Тянуть всё дерево домена незачем: обычно люди завода лежат в своём OU.
    Можно указать либо полный DN («OU=PLANT1,DC=company,DC=local»), либо просто
    название подразделения — тогда оно подставится перед базой поиска.
    """
    base = (cfg.get("baseDn") or "").strip()
    ou = (cfg.get("ou") or "").strip()
    if not ou:
        return base
    if "=" in ou:
        return ou
    # несколько уровней через «/»: «Заводы/Завод-1» -> OU=Завод-1,OU=Заводы,...
    parts = [x.strip() for x in ou.replace("\\", "/").split("/") if x.strip()]
    return ",".join("OU=" + x for x in reversed(parts)) + ("," + base if base else "")


def connect(cfg):
    """Подключение и вход под служебной учётной записью."""
    host = (cfg.get("server") or "").strip()
    if not host:
        raise ValueError("не указан адрес сервера домена")
    if not search_base(cfg):
        raise ValueError("не указана база поиска (Base DN)")

    use_ssl = bool(cfg.get("useSsl"))
    port = int(cfg.get("port") or 0) or (636 if use_ssl else 389)
    if host.startswith("ldap://"):
        host, use_ssl = host[7:], False
    elif host.startswith("ldaps://"):
        host, use_ssl = host[8:], True
    if ":" in host and not host.startswith("["):
        host, _, p = host.partition(":")
        port = int(p or port)

    server = Server(host, port=port, use_ssl=use_ssl, get_info=ALL, connect_timeout=10)
    conn = Connection(server,
                      user=(cfg.get("user") or "").strip() or None,
                      password=cfg.get("password") or None,
                      authentication=SIMPLE if cfg.get("user") else None,
                      auto_bind=False, raise_exceptions=False, receive_timeout=30)
    if not conn.bind():
        raise RuntimeError("вход не принят: %s" % (conn.result.get("description") or conn.result))
    return conn


def fetch(cfg, limit=0):
    """Возвращает список словарей с уже разобранными полями."""
    conn = connect(cfg)
    try:
        conn.search(search_base=search_base(cfg), search_filter=build_filter(cfg),
                    search_scope=(SUBTREE if cfg.get("subtree", True) else LEVEL),
                    attributes=ATTRS, paged_size=500, size_limit=limit or 0)
        out = []
        for e in conn.response or []:
            if e.get("type") != "searchResEntry":
                continue
            a = e.get("attributes") or {}
            # Отключённые учётки отсеиваем здесь, а не в фильтре LDAP: битовая
            # проверка userAccountControl есть не в каждом каталоге, а перенос
            # десятка лишних записей по сети ничего не стоит.
            if cfg.get("skipDisabled", True):
                try:
                    if int(_one(a, "userAccountControl") or 0) & ACCOUNT_DISABLED:
                        continue
                except ValueError:
                    pass
            guid = _guid(a)
            out.append({
                "guid": guid,
                "login": _one(a, "sAMAccountName"),
                "name": full_name(a),
                "position": _one(a, "title"),
                "department": _one(a, "department"),
                "company": _one(a, "company"),
                "phone": _one(a, "telephoneNumber"),
                "email": _one(a, "mail"),
            })
            if limit and len(out) >= limit:
                break
        return out
    finally:
        try:
            conn.unbind()
        except Exception:
            pass


# ------------------------------------------------------------------ перенос в учёт

def _new_id(prefix):
    return prefix + secrets.token_hex(6)


def _find_ref(cur, table, name, org_id):
    """Ищет справочник учреждения по названию, без учёта регистра и лишних пробелов."""
    cur.execute("select id from %s where org_id = %%s and lower(btrim(name)) = lower(btrim(%%s))"
                % table, (org_id, name))
    r = cur.fetchone()
    return r["id"] if r else None


def sync(cur, cfg, org_id):
    """Переносит выборку AD в справочник пользователей учреждения."""
    people = fetch(cfg)
    log = []
    stats = {"found": len(people), "added": 0, "updated": 0, "skipped": 0,
             "divisions": 0, "departments": 0}

    for p in people:
        if not p["name"]:
            stats["skipped"] += 1
            log.append("пропущен: у записи нет ни имени, ни фамилии")
            continue

        div_id = dep_id = None
        if p["company"]:
            div_id = _find_ref(cur, "division", p["company"], org_id)
            if not div_id:
                div_id = _new_id("d")
                cur.execute("insert into division (id, name, org_id) values (%s,%s,%s)",
                            (div_id, p["company"].strip(), org_id))
                stats["divisions"] += 1
                log.append("новое подразделение: " + p["company"].strip())
        if p["department"]:
            dep_id = _find_ref(cur, "department", p["department"], org_id)
            if not dep_id:
                dep_id = _new_id("p")
                cur.execute("insert into department (id, name, org_id) values (%s,%s,%s)",
                            (dep_id, p["department"].strip(), org_id))
                stats["departments"] += 1
                log.append("новый отдел: " + p["department"].strip())

        # ищем, кого обновляем: сначала по GUID, потом по почте, потом по ФИО
        pid = None
        if p["guid"]:
            cur.execute("select id from person where org_id = %s and ad_guid = %s",
                        (org_id, p["guid"]))
            r = cur.fetchone()
            pid = r["id"] if r else None
        if not pid and p["email"]:
            cur.execute("select id from person where org_id = %s and lower(email) = lower(%s)",
                        (org_id, p["email"]))
            r = cur.fetchone()
            pid = r["id"] if r else None
        if not pid:
            cur.execute("""select id from person where org_id = %s
                            and lower(btrim(name)) = lower(btrim(%s))""", (org_id, p["name"]))
            r = cur.fetchone()
            pid = r["id"] if r else None

        if pid:
            cur.execute("""update person set name = %s, position = %s, division_id = %s,
                                  department_id = %s, phone = %s, email = %s,
                                  ad_guid = coalesce(%s, ad_guid), ad_synced_at = now()
                            where id = %s""",
                        (p["name"], p["position"], div_id, dep_id, p["phone"], p["email"],
                         p["guid"] or None, pid))
            stats["updated"] += 1
        else:
            cur.execute("""insert into person (id, name, position, division_id, department_id,
                                               phone, email, ad_guid, ad_synced_at, org_id)
                           values (%s,%s,%s,%s,%s,%s,%s,%s, now(), %s)""",
                        (_new_id("u"), p["name"], p["position"], div_id, dep_id,
                         p["phone"], p["email"], p["guid"] or None, org_id))
            stats["added"] += 1
            log.append("добавлен: " + p["name"])

    stats["at"] = datetime.datetime.now().isoformat(timespec="seconds")
    return stats, log
