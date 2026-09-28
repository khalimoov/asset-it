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

from ldap3 import Server, Connection, ALL, SUBTREE, LEVEL, BASE, SIMPLE
from ldap3.utils.dn import parse_dn

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


def make_server(cfg):
    """Сервер домена из настроек: адрес, порт, LDAPS."""
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
    return Server(host, port=port, use_ssl=use_ssl, get_info=ALL, connect_timeout=10)


def connect(cfg):
    """Подключение и вход под служебной учётной записью."""
    server = make_server(cfg)
    conn = Connection(server,
                      user=(cfg.get("user") or "").strip() or None,
                      password=cfg.get("password") or None,
                      authentication=SIMPLE if cfg.get("user") else None,
                      auto_bind=False, raise_exceptions=False, receive_timeout=30)
    if not conn.bind():
        raise RuntimeError("вход не принят: %s" % (conn.result.get("description") or conn.result))
    return conn


def fetch(cfg, limit=0, info=None):
    """Возвращает список словарей с уже разобранными полями.

    info — необязательный словарь, куда складываем, где именно искали: это
    показывается в «Проверке подключения», иначе администратору не видно,
    во что развернулось название подразделения.
    """
    conn = connect(cfg)
    try:
        base = resolve_base(conn, cfg)
        if info is not None:
            info["base"] = base
        ok = conn.search(search_base=base, search_filter=build_filter(cfg),
                         search_scope=(SUBTREE if cfg.get("subtree", True) else LEVEL),
                         attributes=ATTRS, paged_size=500, size_limit=limit or 0)
        # без raise_exceptions ldap3 о неудаче сообщает только False: раньше
        # несуществующая база поиска выглядела как «никого не нашлось»
        if not ok:
            r = conn.result or {}
            desc = r.get("description") or ""
            if desc == "sizeLimitExceeded":
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

AUTH_DEFAULTS = {
    "enabled": False,
    "orgId": "",          # чьи настройки домена (сервер, база поиска) использовать
    "suffix": "",         # хвост UPN: i.ivanov + @company.local
    "group": "",          # группа AD, членам которой открыт вход (пусто — всем)
    "roleId": "",         # роль, с которой заводится новый пользователь ИТ
    "newOrgId": "",       # учреждение, в которое он попадает
}


def merge_auth(saved):
    cfg = dict(AUTH_DEFAULTS)
    cfg.update(saved or {})
    return cfg


# Правило Active Directory «состоит в группе с учётом вложенных».
# Домен сам обходит цепочку: человек в «ГИТ-инженеры», та группа внутри
# «Asset-IT-Users» — вход открыт, хотя в memberOf у человека второй группы нет.
IN_CHAIN = "1.2.840.113556.1.4.1941"


def domain_root(dn):
    """Корень домена из DN — только части DC=.

    «OU=Завод-1,OU=Площадка Северная,DC=company,DC=local» → «DC=company,DC=local».
    """
    dcs = [x.strip() for x in (dn or "").split(",") if x.strip().lower().startswith("dc=")]
    return ",".join(dcs)


def group_name(want):
    r"""Название группы из того, что написал администратор: COMPANY\Asset-IT -> Asset-IT."""
    want = (want or "").strip()
    if "\\" in want:
        want = want.rsplit("\\", 1)[-1]
    if "@" in want:
        want = want.split("@", 1)[0]
    return want.strip()


def resolve_group(conn, cfg, want):
    r"""DN группы по названию.

    Принимаем как полный DN, так и просто название — в том числе в видах
    «COMPANY\Asset-IT» и «Asset-IT@company.local», их легко скопировать из оснастки.
    Опечатка в названии не должна выглядеть как «никого не пускает»: если
    такой группы в домене нет, говорим об этом прямо.
    """
    want = (want or "").strip()
    if not want:
        return ""
    if "=" in want:
        return want
    name = group_name(want)
    base = (cfg.get("baseDn") or "").strip()
    conn.search(search_base=base,
                search_filter="(&(objectClass=group)(|(cn=%s)(sAMAccountName=%s)))"
                              % (escape_filter(name), escape_filter(name)),
                search_scope=SUBTREE, attributes=["cn"], paged_size=100)
    found = [e.get("dn") for e in (conn.response or [])
             if e.get("type") == "searchResEntry" and e.get("dn")]
    if not found:
        raise RuntimeError("группа «%s» в домене не найдена (искали внутри %s). Проверьте "
                           "написание или впишите её DN целиком"
                           % (want, base or "всего каталога"))
    if len(found) > 1:
        raise RuntimeError("групп с названием «%s» несколько: %s. Впишите DN нужной"
                           % (want, ", ".join(found[:5])))
    return found[0]


def _in_group(groups, want):
    """Прямое членство по memberOf: сравниваем с полным DN или с названием.

    Запасной путь на случай каталога, который не понимает правила IN_CHAIN
    (например, не Active Directory). Вложенные группы так не видны.
    """
    want = (want or "").strip().lower()
    if not want:
        return True
    names = {want, group_name(want).lower()}
    for g in groups or []:
        g = str(g).lower()
        if g in names:
            return True
        cn = g.split(",", 1)[0]
        if cn.startswith("cn=") and cn[3:] in names:
            return True
    return False


def in_group_deep(conn, user_dn, group_dn, groups, want):
    """Членство с учётом вложенных групп — спрашиваем у самого домена."""
    if user_dn and group_dn:
        ok = conn.search(search_base=user_dn,
                         search_filter="(memberOf:%s:=%s)" % (IN_CHAIN, escape_filter(group_dn)),
                         search_scope=BASE, attributes=["cn"], size_limit=1)
        if ok:
            for e in conn.response or []:
                if e.get("type") == "searchResEntry":
                    return True
            return False
        # каталог правила не знает — сверяем прямое членство
    return _in_group(groups, group_dn or want)


def check_group(cfg, want):
    """Для настроек: существует ли группа и сколько в ней человек (с вложенными).

    Администратор заводит группу и добавляет в неё людей — пусть сразу видит,
    что приложение нашло именно её и кого в ней видит.
    """
    conn = connect(cfg)
    try:
        dn = resolve_group(conn, cfg, want)
        if not dn:
            return {"dn": "", "members": 0}
        # считаем по всему домену: раньше счёт шёл от baseDn, и администратор видел
        # «в группе 7 чел.», когда на деле их больше — просто часть лежит в других
        # подразделениях. Входить они при этом вправе: доступ раздаёт группа.
        base = (cfg.get("baseDn") or "").strip()
        conn.search(search_base=domain_root(base) or base,
                    search_filter="(&(objectCategory=person)(objectClass=user)(memberOf:%s:=%s))"
                                  % (IN_CHAIN, escape_filter(dn)),
                    search_scope=SUBTREE, attributes=["sAMAccountName"], paged_size=500)
        names = [_one(e.get("attributes") or {}, "sAMAccountName")
                 for e in (conn.response or []) if e.get("type") == "searchResEntry"]
        return {"dn": dn, "members": len(names), "sample": [n for n in names if n][:10]}
    finally:
        try:
            conn.unbind()
        except Exception:
            pass


def _members(conn, base, group_dn):
    """Сколько человек в группе видно из указанного корня (с вложенными группами)."""
    if not base or not group_dn:
        return 0
    conn.search(search_base=base,
                search_filter="(&(objectCategory=person)(objectClass=user)(memberOf:%s:=%s))"
                              % (IN_CHAIN, escape_filter(group_dn)),
                search_scope=SUBTREE, attributes=["sAMAccountName"], paged_size=500)
    return len([e for e in (conn.response or []) if e.get("type") == "searchResEntry"])


def probe_login(cfg, auth, login):
    """Почему человек не может войти — проверка одной учётной записи.

    Пароль не нужен: смотрим служебной учёткой, есть ли такой в домене, где он
    лежит, включён ли и состоит ли в группе доступа. Ищем **от корня домена**, а
    не от корня поиска из настроек загрузки: иначе человека, который лежит в
    другом подразделении, просто не видно — а это и есть частая причина отказа.
    """
    login = (login or "").strip()
    if not login:
        return {"found": False, "login": ""}
    sam = login.split("@")[0].split("\\")[-1]
    upn = login if "@" in login else (login + "@" + (auth.get("suffix") or "").strip().lstrip("@")
                                      if (auth.get("suffix") or "").strip() else login)
    base = (cfg.get("baseDn") or "").strip()
    root = domain_root(base) or base
    conn = connect(cfg)
    try:
        conn.search(search_base=root,
                    search_filter="(&(objectClass=user)(|(sAMAccountName=%s)(userPrincipalName=%s)))"
                                  % (escape_filter(sam), escape_filter(upn)),
                    search_scope=SUBTREE, size_limit=2,
                    attributes=ATTRS + ["memberOf", "userAccountControl", "userPrincipalName"])
        entry = entry_dn = None
        for e in conn.response or []:
            if e.get("type") == "searchResEntry":
                entry, entry_dn = (e.get("attributes") or {}), (e.get("dn") or "")
                break
        out = {"found": entry is not None, "login": login, "sam": sam,
               "base": base, "root": root, "group": "", "groupWant": (auth.get("group") or "").strip()}
        if entry is None:
            return out
        try:
            uac = int(_one(entry, "userAccountControl") or 0)
        except ValueError:
            uac = 0
        groups = entry.get("memberOf") or []
        if isinstance(groups, (str, bytes)):
            groups = [groups]
        low = (entry_dn or "").lower()
        out.update({"dn": entry_dn, "name": full_name(entry),
                    "upn": _one(entry, "userPrincipalName") or "",
                    "enabled": not (uac & ACCOUNT_DISABLED),
                    "inBase": (not base) or low.endswith(base.lower()),
                    "groups": len(groups)})
        want = out["groupWant"]
        if want:
            group_dn = resolve_group(conn, cfg, want)
            out["group"] = group_dn or ""
            out["inGroup"] = bool(group_dn) and in_group_deep(conn, entry_dn, group_dn, groups, want)
            out["membersInBase"] = _members(conn, base, group_dn)
            out["membersInRoot"] = _members(conn, root, group_dn)
        return out
    finally:
        try:
            conn.unbind()
        except Exception:
            pass


def authenticate(cfg, auth, login, password, server=None, strategy=None):
    """Проверяет логин и пароль в домене и возвращает сведения о человеке.

    Вход — самим пользователем (simple bind под его UPN), а не служебной учёткой:
    так домен сам проверяет пароль, отключённые учётки и истёкшие пароли, а у нас
    пароль не хранится вовсе. После входа читаем свою же запись — имя и группы.
    Возвращает dict(login, name, guid, groups, email, position) или None.
    server/strategy — для проверки без настоящего домена.
    """
    login = (login or "").strip()
    if not login or not password:
        return None
    if "@" in login or "\\" in login:
        upn, sam = login, login.split("@")[0].split("\\")[-1]
    else:
        suffix = (auth.get("suffix") or "").strip().lstrip("@")
        upn = login + "@" + suffix if suffix else login
        sam = login
    srv = server or make_server(cfg)
    kw = {"client_strategy": strategy} if strategy else {}
    conn = Connection(srv, user=upn, password=password, authentication=SIMPLE,
                      auto_bind=False, raise_exceptions=False, receive_timeout=15, **kw)
    try:
        if not conn.bind():
            return None
        # обычно логин — sAMAccountName; если ввели полный DN, читаем саму запись
        if "=" in login:
            conn.search(search_base=login, search_filter="(objectClass=*)", search_scope=BASE,
                        attributes=ATTRS + ["memberOf"], size_limit=1)
        else:
            # Ищем по всему домену. Раньше здесь стоял baseDn из настроек загрузки
            # сотрудников, и человек, лежащий в другом подразделении, просто не
            # находился: вход ему закрывался, хотя в группе доступа он состоял, а
            # выглядело это как «домен не принял пароль». Кого переносить в
            # справочник — дело baseDn и OU, кому входить — дело группы AD ниже.
            # Заодно пробуем и UPN: он не всегда совпадает с sAMAccountName.
            base = domain_root((cfg.get("baseDn") or "").strip()) or \
                (cfg.get("baseDn") or "").strip() or search_base(cfg)
            conn.search(search_base=base,
                        search_filter="(&(objectClass=user)(|(sAMAccountName=%s)(userPrincipalName=%s)))"
                                      % (escape_filter(sam), escape_filter(upn)),
                        search_scope=SUBTREE, attributes=ATTRS + ["memberOf"], size_limit=1)
        entry = entry_dn = None
        for e in conn.response or []:
            if e.get("type") == "searchResEntry":
                entry = e.get("attributes") or {}
                entry_dn = e.get("dn") or ""
                break
        if entry is None:
            return None
        if auth.get("skipDisabled", True):
            try:
                if int(_one(entry, "userAccountControl") or 0) & ACCOUNT_DISABLED:
                    return None
            except ValueError:
                pass
        groups = entry.get("memberOf") or []
        if isinstance(groups, (str, bytes)):
            groups = [groups]
        want = (auth.get("group") or "").strip()
        if want:
            # доступом заведует группа: кого в неё добавили — тот и заходит.
            # Членство спрашиваем у домена, чтобы работали и вложенные группы.
            group_dn = resolve_group(conn, cfg, want)
            if not in_group_deep(conn, entry_dn, group_dn, groups, want):
                return None
        return {"login": _one(entry, "sAMAccountName") or sam, "name": full_name(entry), "guid": _guid(entry),
                "email": _one(entry, "mail"), "position": _one(entry, "title"),
                "groups": [str(g) for g in groups]}
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
