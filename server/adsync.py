# -*- coding: utf-8 -*-
"""Active Directory по LDAP: подключение, загрузка сотрудников, вход.

Настройки — две части, как две вкладки раздела «LDAP»:

    подключение LDAP     одно на всё (setting.ldap): сервер, порт, режим, Base DN,
                         где искать пользователей, служебная учётка, таймауты.
                         Оно же — вход: пользователь ИТ с источником LDAP входит
                         доменным паролем, пока подключение включено. Кто входит —
                         решает администратор поимённо в «Пользователях ИТ».
    загрузка сотрудников у каждого учреждения своя (org_setting.ldap): подразделение
                         AD, признак, отключённые, вложенные OU

Загрузка берёт только те учётные записи, у которых в атрибуте-признаке (по умолчанию
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

from ldap3 import Server, Connection, ALL, SUBTREE, LEVEL, BASE, SIMPLE
from ldap3.utils.dn import parse_dn

# Атрибуты, которые забираем из домена
ATTRS = ["givenName", "initials", "sn", "telephoneNumber", "mail",
         "title", "department", "company", "displayName", "cn",
         "sAMAccountName", "objectGUID", "userAccountControl"]

# Подключение — одно на всю установку
CONN_DEFAULTS = {
    "enabled": True,          # «Использовать конфигурацию LDAP»
    "server": "", "port": 0,
    "mode": "plain",          # plain — без шифрования, ldaps — 636, starttls — 389 + STARTTLS
    "baseDn": "",
    "userBase": "",           # где искать пользователей для входа; пусто — Base DN
    "user": "", "password": "",
    "connectTimeout": 5000, "opTimeout": 10000,   # мс
}
MODES = ("plain", "ldaps", "starttls")

# Загрузка сотрудников — своя у каждого учреждения
LOAD_DEFAULTS = {
    "ou": "",                 # искать только в этом подразделении AD
    "subtree": True,          # вместе с вложенными или только на одном уровне
    "markAttr": "employeeType", "markValue": "ok",
    "skipDisabled": True,
}

ACCOUNT_DISABLED = 0x0002


def _ms(v, default):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return default
    return min(max(v, 500), 120000)


def merge_conn(saved):
    cfg = dict(CONN_DEFAULTS)
    cfg.update({k: v for k, v in (saved or {}).items() if k in CONN_DEFAULTS})
    if cfg["mode"] not in MODES:
        cfg["mode"] = "plain"
    cfg["connectTimeout"] = _ms(cfg["connectTimeout"], CONN_DEFAULTS["connectTimeout"])
    cfg["opTimeout"] = _ms(cfg["opTimeout"], CONN_DEFAULTS["opTimeout"])
    return cfg


def merge_load(saved):
    cfg = dict(LOAD_DEFAULTS)
    cfg.update({k: v for k, v in (saved or {}).items() if k in LOAD_DEFAULTS})
    return cfg


def merge_config(conn, load=None):
    """Рабочие настройки: подключение + загрузка выбранного учреждения."""
    cfg = merge_conn(conn)
    cfg.update(merge_load(load))
    return cfg


def conn_from_legacy(old):
    """Подключение из прежних настроек, когда сервер и пароль жили у учреждения."""
    old = old or {}
    return merge_conn({
        "server": old.get("server") or "", "port": old.get("port") or 0,
        "mode": "ldaps" if old.get("useSsl") else "plain",
        "baseDn": old.get("baseDn") or "", "user": old.get("user") or "",
        "password": old.get("password") or ""})


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


def ou_parts(ou):
    """«Заводы/Завод-1» или «Заводы\Завод-1» -> ["Заводы", "Завод-1"] (сверху вниз)."""
    return [x.strip() for x in str(ou or "").replace("\\", "/").split("/") if x.strip()]


def search_base(cfg):
    """Откуда искать — без обращения к домену.

    Годится, когда указан полный DN («OU=PLANT1,DC=company,DC=local») или когда OU
    не задан вовсе. Если написано просто название подразделения, настоящий DN
    знает только сам домен — его находит resolve_base(). Склеивать
    «OU=ГИТ» + база вслепую нельзя: в домене подразделение обычно лежит глубоко
    (OU=ГИТ,OU=Завод-1,OU=Площадка Северная,OU=Severnoye,DC=...), и такой DN просто
    не существует — поиск молча не находит никого.
    """
    base = (cfg.get("baseDn") or "").strip()
    ou = (cfg.get("ou") or "").strip()
    if not ou:
        return base
    if "=" in ou:
        return ou
    return base


def _ou_chain(dn):
    """Названия OU из DN сверху вниз: OU=ГИТ,OU=Завод-1,DC=... -> ["гит", "завод-1"]."""
    try:
        parts = parse_dn(dn)
    except Exception:
        return []
    return [v.strip().lower() for a, v, _ in parts if a.lower() == "ou"]


def resolve_base(conn, cfg):
    """Настоящий DN подразделения: название ищем по каталогу, а не склеиваем.

    Администратор пишет в настройках просто «ГИТ», а домен хранит его как
    OU=ГИТ,OU=Завод-1,OU=Площадка Северная,OU=Severnoye,DC=company,DC=local. Поэтому
    спрашиваем у домена, где это подразделение лежит. Если одноимённых
    несколько (в каждом заводе своё «ИТ»), выбрать за администратора нельзя —
    показываем найденные пути, чтобы он уточнил: «Завод-1/ГИТ» или полный DN.
    """
    base = (cfg.get("baseDn") or "").strip()
    ou = (cfg.get("ou") or "").strip()
    if not ou or "=" in ou:
        return search_base(cfg)

    parts = ou_parts(ou)
    conn.search(search_base=base,
                search_filter="(&(objectClass=organizationalUnit)(ou=%s))" % escape_filter(parts[-1]),
                search_scope=SUBTREE, attributes=["ou"], paged_size=500)
    found = [e.get("dn") for e in (conn.response or [])
             if e.get("type") == "searchResEntry" and e.get("dn")]

    if len(parts) > 1:
        # путь «Площадка Северная/Завод-1/ГИТ»: все его звенья должны идти по DN
        # снизу вверх подряд по порядку, но между ними могут быть и другие OU
        need = [p.strip().lower() for p in reversed(parts)]
        keep = []
        for dn in found:
            i = 0
            for name in _ou_chain(dn):
                if i < len(need) and name == need[i]:
                    i += 1
            if i == len(need):
                keep.append(dn)
        found = keep

    if not found:
        raise RuntimeError(
            "подразделение «%s» не найдено в домене (искали внутри %s). Проверьте "
            "написание или впишите полный путь: «Завод-1/ГИТ» либо DN целиком"
            % (ou, base or "всего каталога"))
    if len(found) > 1:
        show = ", ".join(found[:5]) + (" и ещё %d" % (len(found) - 5) if len(found) > 5 else "")
        raise RuntimeError(
            "подразделений с названием «%s» в домене несколько: %s. Уточните путь "
            "(«Завод-1/ГИТ») или впишите нужный DN целиком" % (ou, show))
    return found[0]


def host_port(cfg):
    """Адрес и порт сервера с учётом режима и приставок ldap:// / ldaps://."""
    host = (cfg.get("server") or "").strip()
    if not host:
        raise ValueError("не указан адрес LDAP-сервера")
    mode = cfg.get("mode") or "plain"
    if host.startswith("ldap://"):
        host = host[7:]
    elif host.startswith("ldaps://"):
        host, mode = host[8:], "ldaps"
    host = host.rstrip("/")
    port = int(cfg.get("port") or 0) or (636 if mode == "ldaps" else 389)
    if ":" in host and not host.startswith("["):
        host, _, p = host.partition(":")
        port = int(p or port)
    return host, port, mode


def make_server(cfg):
    """Сервер домена из настроек: адрес, порт, режим, таймаут подключения."""
    host, port, mode = host_port(cfg)
    return Server(host, port=port, use_ssl=(mode == "ldaps"), get_info=ALL,
                  connect_timeout=max(1, int(cfg.get("connectTimeout") or 5000) / 1000.0))


def _why(conn):
    r = conn.result or {}
    desc = r.get("description") or ""
    msg = (r.get("message") or "").strip()
    if desc == "invalidCredentials":
        return "неверная учётная запись или пароль"
    return (desc + (" — " + msg if msg else "")) or "нет ответа"


def _open(cfg, user, password, server=None, strategy=None):
    """Соединение, уже вошедшее под user. Не вошло — RuntimeError с причиной."""
    srv = server or make_server(cfg)
    kw = {"client_strategy": strategy} if strategy else {}
    # Таймаут операции — ЦЕЛЫЕ секунды. Под Linux ldap3 кладёт его в SO_RCVTIMEO
    # через pack('LL', …), и дробное 10.0 падает «required argument is not an
    # integer» — под Windows он сам умножает на 1000, поэтому здесь не ловилось.
    op = int(cfg.get("opTimeout") or 10000)
    conn = Connection(srv, user=user or None, password=password or None,
                      authentication=SIMPLE if user else None, auto_bind=False,
                      raise_exceptions=False, receive_timeout=max(1, -(-op // 1000)), **kw)
    try:
        if cfg.get("mode") == "starttls" and not strategy:
            conn.open()
            if not conn.start_tls():
                raise RuntimeError("сервер не принял STARTTLS: " + _why(conn))
        if not conn.bind():
            raise RuntimeError("вход не принят: " + _why(conn))
    except RuntimeError:
        raise
    except Exception as e:
        host, port, _ = host_port(cfg)
        raise RuntimeError("не удалось подключиться к %s:%s — %s" % (host, port, e))
    return conn


def connect(cfg, server=None, strategy=None):
    """Подключение и вход под служебной учётной записью."""
    if not cfg.get("enabled", True):
        raise RuntimeError("подключение к LDAP выключено: включите его на вкладке «Подключение LDAP»")
    return _open(cfg, (cfg.get("user") or "").strip(), cfg.get("password") or "",
                 server, strategy)


def _close(conn):
    try:
        conn.unbind()
    except Exception:
        pass


def test_connection(cfg):
    """Проверка вкладки «Подключение»: подключиться, войти, прочитать Base DN."""
    base = (cfg.get("baseDn") or "").strip()
    if not base:
        raise ValueError("не указан Base DN")
    host, port, mode = host_port(cfg)
    conn = connect(cfg)
    try:
        out = {"server": "%s:%s" % (host, port), "mode": mode, "base": base,
               "bindAs": (cfg.get("user") or "").strip() or "анонимно"}
        for key, dn in (("base", base), ("userBase", (cfg.get("userBase") or "").strip())):
            if not dn:
                continue
            conn.search(search_base=dn, search_filter="(objectClass=*)", search_scope=BASE,
                        attributes=["objectClass"])
            r = conn.result or {}
            if r.get("result") not in (0, None):
                what = "Base DN" if key == "base" else "User Search Base"
                if r.get("description") == "noSuchObject":
                    raise RuntimeError("%s «%s» в домене не найден" % (what, dn))
                raise RuntimeError("%s «%s» не читается: %s" % (what, dn, _why(conn)))
        out["userBase"] = (cfg.get("userBase") or "").strip() or base
        return out
    finally:
        _close(conn)

def fetch(cfg, limit=0, info=None):
    """Возвращает список словарей с уже разобранными полями.

    info — необязательный словарь, куда складываем, где именно искали: это
    показывается в «Проверке подключения», иначе администратору не видно,
    во что развернулось название подразделения.
    """
    conn = connect(cfg)
    try:
        base = resolve_base(conn, cfg)
        if not base:
            raise ValueError("не указан Base DN — задайте его на вкладке «Подключение LDAP»")
        if info is not None:
            info["base"] = base
        ok = conn.search(search_base=base, search_filter=build_filter(cfg),
                         search_scope=(SUBTREE if cfg.get("subtree", True) else LEVEL),
                         attributes=ATTRS, paged_size=500, size_limit=limit or 0)
        # без raise_exceptions ldap3 о неудаче сообщает только False: раньше
        # несуществующая база поиска выглядела как «никого не нашлось».
        # Но False бывает и при успехе: ldap3 так отвечает, когда домен вернул
        # success и ни одной записи — это пустая выборка, а не отказ.
        if not ok:
            r = conn.result or {}
            desc = r.get("description") or ""
            if desc in ("success", "sizeLimitExceeded") or r.get("result") == 0:
                pass
            elif desc == "noSuchObject":
                raise RuntimeError("домен не знает такой базы поиска: %s" % base)
            else:
                raise RuntimeError("домен отклонил запрос: %s %s"
                                   % (desc or r.get("result"), r.get("message") or ""))
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


def probe(cfg, limit=5):
    """Проверка настроек: где искали, каким запросом и кто нашёлся."""
    info = {}
    sample = fetch(cfg, limit=limit, info=info)
    return {"base": info.get("base") or search_base(cfg),
            "filter": build_filter(cfg), "sample": sample}


# ------------------------------------------------------------------ вход через домен

def domain_root(dn):
    """Корень домена из DN — только части DC=.

    «OU=Завод-1,OU=Площадка Северная,DC=company,DC=local» → «DC=company,DC=local».
    """
    dcs = [x.strip() for x in (dn or "").split(",") if x.strip().lower().startswith("dc=")]
    return ",".join(dcs)


def user_base(cfg):
    """Где искать пользователей: User Search Base, а без него — Base DN."""
    return (cfg.get("userBase") or "").strip() or (cfg.get("baseDn") or "").strip()


def _names(login):
    """sAMAccountName и UPN из того, что набрал человек."""
    login = (login or "").strip()
    sam = login.split("@")[0].split("\\")[-1]
    return sam, (login if "@" in login else "")


def _find_user(conn, cfg, sam, upn, attrs):
    """Запись человека по логину: (dn, атрибуты) или (None, None).

    Ищем от корня домена, а не от User Search Base: человек мог переехать в
    другое подразделение, а доступ ему уже выдан поимённо.
    """
    base = domain_root((cfg.get("baseDn") or "").strip()) or user_base(cfg)
    flt = "(sAMAccountName=%s)" % escape_filter(sam)
    if upn:
        flt = "(|%s(userPrincipalName=%s))" % (flt, escape_filter(upn))
    conn.search(search_base=base, search_filter="(&(objectClass=user)%s)" % flt,
                search_scope=SUBTREE, attributes=attrs, size_limit=2)
    for e in conn.response or []:
        if e.get("type") == "searchResEntry":
            return e.get("dn") or "", (e.get("attributes") or {})
    return None, None


def _disabled(entry):
    try:
        return bool(int(_one(entry, "userAccountControl") or 0) & ACCOUNT_DISABLED)
    except ValueError:
        return False


def _person(entry, dn=""):
    return {"login": _one(entry, "sAMAccountName"), "name": full_name(entry),
            "email": _one(entry, "mail"), "position": _one(entry, "title"),
            "upn": _one(entry, "userPrincipalName"), "guid": _guid(entry),
            "disabled": _disabled(entry), "dn": dn}


def search_users(cfg, q, limit=20):
    """Подсказки при добавлении пользователя: ищем по логину, ФИО и почте."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    base = user_base(cfg)
    if not base:
        raise ValueError("не указан Base DN")
    v = escape_filter(q)
    flt = ("(&(objectCategory=person)(objectClass=user)(|(sAMAccountName=*%s*)"
           "(displayName=*%s*)(cn=*%s*)(sn=*%s*)(givenName=*%s*)(mail=*%s*)"
           "(userPrincipalName=*%s*)))" % ((v,) * 7))
    conn = connect(cfg)
    try:
        conn.search(search_base=base, search_filter=flt, search_scope=SUBTREE,
                    attributes=ATTRS + ["userPrincipalName"], size_limit=limit)
        r = conn.result or {}
        if r.get("description") == "noSuchObject":
            raise RuntimeError("домен не знает такой базы поиска: %s" % base)
        out = [_person(e.get("attributes") or {}, e.get("dn") or "")
               for e in (conn.response or []) if e.get("type") == "searchResEntry"]
        out = [p for p in out if p["login"]]
        ql = q.lower()
        # сначала те, у кого совпало начало логина — их и ищут чаще всего
        out.sort(key=lambda p: (not p["login"].lower().startswith(ql), p["name"].lower()))
        return out
    finally:
        _close(conn)


def authenticate(cfg, login, password, server=None, strategy=None):
    """Проверяет логин и пароль в домене и возвращает сведения о человеке.

    Служебная учётка находит человека по логину, затем входим **им самим** по его
    DN — пароль проверяет домен (и отключённые учётки, и истёкшие пароли), у нас
    он не хранится. Без служебной учётки входим тем, что набрано (UPN или
    ДОМЕН\логин), и читаем свою же запись.
    Возвращает dict(login, name, guid, email, position) или None.
    server/strategy — для проверки без настоящего домена.
    """
    sam, upn = _names(login)
    if not sam or not password:
        return None
    attrs = ATTRS + ["userPrincipalName"]
    dn = entry = None
    if (cfg.get("user") or "").strip():
        conn = connect(cfg, server, strategy)
        try:
            dn, entry = _find_user(conn, cfg, sam, upn, attrs)
        finally:
            _close(conn)
        if entry is None or _disabled(entry):
            return None
    elif not cfg.get("enabled", True):
        return None
    try:
        uconn = _open(cfg, dn or upn or login.strip(), password, server, strategy)
    except RuntimeError:
        return None
    try:
        if entry is None:
            dn, entry = _find_user(uconn, cfg, sam, upn, attrs)
            if entry is None or _disabled(entry):
                return None
    finally:
        _close(uconn)
    p = _person(entry, dn)
    p["login"] = p["login"] or sam
    return p

# ------------------------------------------------------------------ перенос в учёт

def _new_id(prefix):
    return prefix + secrets.token_hex(6)


def _find_ref(cur, table, name, org_id):
    """Ищет справочник учреждения по названию, без учёта регистра и лишних пробелов."""
    cur.execute("select id from %s where org_id = %%s and lower(btrim(name)) = lower(btrim(%%s))"
                % table, (org_id, name))
    r = cur.fetchone()
    return r["id"] if r else None


def _find_dep(cur, name, div_id, org_id):
    """Отдел ищем внутри подразделения: ООТиЗ бывает и в ГМЗ-6, и в ГМЗ-7.

    Сначала — отдел с этим названием в этом подразделении. Нет — ещё не
    размеченный (без подразделения): его и берём, приписав к подразделению,
    чтобы следующий человек из другого подразделения получил свой отдел.
    Подразделения у человека нет — неразмеченный или единственный одноимённый;
    если их несколько в разных подразделениях, чужой наугад не берём.
    """
    cur.execute("""select id, division_id from department
                    where org_id = %s and lower(btrim(name)) = lower(btrim(%s))
                    order by division_id nulls first, id""", (org_id, name))
    found = cur.fetchall()
    if not div_id:
        free = [r for r in found if not r["division_id"]]
        if free:
            return free[0]["id"]
        return found[0]["id"] if len(found) == 1 else None
    for r in found:
        if r["division_id"] == div_id:
            return r["id"]
    for r in found:
        if not r["division_id"]:
            cur.execute("update department set division_id = %s where id = %s", (div_id, r["id"]))
            return r["id"]
    return None


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
            dep_id = _find_dep(cur, p["department"], div_id, org_id)
            if not dep_id:
                dep_id = _new_id("p")
                cur.execute("insert into department (id, name, org_id, division_id) values (%s,%s,%s,%s)",
                            (dep_id, p["department"].strip(), org_id, div_id))
                stats["departments"] += 1
                log.append("новый отдел: " + p["department"].strip() +
                           (" (" + p["company"].strip() + ")" if div_id else ""))

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
