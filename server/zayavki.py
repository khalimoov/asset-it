"""Связь с программой «Заявки ИТ»: какие заявки сделаны на сотрудника и исполнены ли они.

Только чтение, через её API (GET /api/v1/...). Где программа и каким ключом к ней ходить —
в server/.env:

    ZAYAVKI_URL=http://127.0.0.1:8090     # адрес, по которому до неё достучится этот сервер
    ZAYAVKI_KEY=zk_...                    # ключ: «Заявки ИТ» → Пользователи → Ключи API
    ZAYAVKI_PUBLIC_URL=http://srv:8090    # адрес для ссылок в браузере, если отличается

Ключ можно не писать в .env, а положить файлом api.txt в корень проекта.

Сотрудника ищем сначала по objectGUID из AD (он есть и у нас, и там), затем по ФИО,
затем по логину из почты.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT = 6
LIST_TTL = 300          # список сотрудников «Заявок» перечитываем раз в 5 минут
LOOPBACK = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}
# Пока у сотрудника есть такие полномочия, удалить его у нас нельзя: сначала их снимают
# заявкой в «Заявках». «На снятии» (revoking) не держит — заявка на снятие уже сделана.
KEEPS_PERSON = ("active", "requested")

_cache = {"at": 0.0, "key": None, "persons": []}
_lock = threading.Lock()


class Error(Exception):
    pass


def settings():
    url = (os.environ.get("ZAYAVKI_URL") or "http://127.0.0.1:8090").strip().rstrip("/")
    key = (os.environ.get("ZAYAVKI_KEY") or "").strip()
    if not key:
        f = Path(os.environ.get("ZAYAVKI_KEY_FILE") or ROOT / "api.txt")
        try:
            m = re.search(r"zk_[\w-]+", f.read_text(encoding="utf-8-sig"))
            key = m.group(0) if m else ""
        except OSError:
            key = ""
    return url, key


def _get(path):
    url, key = settings()
    if not key:
        raise Error("не задан ключ API: ZAYAVKI_KEY в server/.env или файл api.txt")
    req = urllib.request.Request(url + path, headers={"Authorization": "Bearer " + key,
                                                     "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise Error("программа заявок не приняла ключ API — он отозван или неверный")
        if e.code == 404:
            return None
        raise Error("программа заявок ответила ошибкой %s" % e.code)
    except (urllib.error.URLError, OSError) as e:
        raise Error("нет связи с программой заявок (%s): %s" % (url, getattr(e, "reason", e)))
    except ValueError:
        raise Error("программа заявок прислала непонятный ответ")


def _persons():
    """Все сотрудники «Заявок» кратко — чтобы найти нужного по GUID или ФИО."""
    key = settings()
    with _lock:
        if _cache["key"] == key and time.time() - _cache["at"] < LIST_TTL:
            return _cache["persons"]
        out, page = [], 1
        while True:
            d = _get("/api/v1/persons?per_page=500&page=%d" % page) or {}
            out += d.get("items") or []
            if not d.get("items") or len(out) >= (d.get("total") or 0):
                break
            page += 1
        _cache.update(at=time.time(), key=key, persons=out)
        return out


def _norm(s):
    return re.sub(r"\s+", " ", str(s or "").lower().replace("ё", "е").replace(".", ". ")).strip()


def _find(person):
    """Сотрудник «Заявок» для нашего: по GUID, по ФИО, по логину из почты. Действующий — вперёд."""
    people = sorted(_persons(), key=lambda p: (p.get("ad_state") == "removed", -(p.get("id") or 0)))
    guid = (person.get("ad_guid") or "").strip().strip("{}").lower()
    if guid:
        for p in people:
            if (p.get("ad_guid") or "").lower() == guid:
                return p
    name = _norm(person.get("name"))
    if name:
        for p in people:
            if name in (_norm(p.get("fio")), _norm(p.get("short_fio"))):
                return p
    login = (person.get("email") or "").split("@")[0].strip().lower()
    if login:
        for p in people:
            if (p.get("login") or "").lower() == login:
                return p
    return None


def _public(link, browser_host):
    """Ссылки «Заявки» строит от адреса, по которому к ней пришёл наш сервер. Если это
    127.0.0.1 — в браузере на другом компьютере она не откроется: подставляем адрес,
    по которому браузер пришёл к нам (программы стоят на одном сервере)."""
    if not link:
        return ""
    u = urllib.parse.urlsplit(link)
    pub = (os.environ.get("ZAYAVKI_PUBLIC_URL") or "").strip().rstrip("/")
    if pub:
        p = urllib.parse.urlsplit(pub)
        return urllib.parse.urlunsplit((p.scheme, p.netloc, u.path, u.query, ""))
    if u.hostname in LOOPBACK and browser_host and browser_host not in LOOPBACK:
        netloc = browser_host + (":%d" % u.port if u.port else "")
        return urllib.parse.urlunsplit((u.scheme, netloc, u.path, u.query, ""))
    return link


def _resources(nodes):
    """Ресурсы заявки одной строкой на каждый: «Система: подпункт» или просто ресурс."""
    out = []
    for n in nodes or []:
        kids = n.get("children") or []
        if kids:
            out += [{"system": n.get("name") or "", "name": c.get("name") or "",
                     "permission": c.get("permission") or ""} for c in kids]
        else:
            out.append({"system": "", "name": n.get("name") or "", "permission": n.get("permission") or ""})
    return out


def person_info(person, browser_host=""):
    """Заявки и полномочия нашего сотрудника (dict с полями name, email, ad_guid)."""
    url, key = settings()
    if not key:
        return {"configured": False}
    brief = _find(person)
    if not brief:
        return {"configured": True, "found": False}
    full = _get("/api/v1/persons/%d" % brief["id"])
    if not full:
        return {"configured": True, "found": False}

    def link(x):
        return _public(x, browser_host)

    def right(r):
        req = r.get("request") or {}
        return {"system": r.get("system") or "", "resource": r.get("resource") or "",
                "permission": r.get("permission") or "", "info": r.get("info") or "",
                "state": r.get("state") or "", "stateName": r.get("state_name") or "",
                "requestDate": req.get("date") or "", "url": link(req.get("url")),
                "keep": (r.get("state") or "") in KEEPS_PERSON}

    return {
        "configured": True, "found": True,
        "fio": full.get("fio") or "", "login": full.get("login") or "",
        "adState": full.get("ad_state") or "", "adStateName": full.get("ad_state_name") or "",
        "url": link(full.get("url")),
        "requests": [{
            "id": r.get("id"), "date": r.get("date") or "", "number": r.get("number") or "",
            "kind": r.get("kind") or "", "kindName": r.get("kind_name") or "",
            "action": r.get("action") or "", "actionName": r.get("action_name") or "",
            "status": r.get("status") or "", "statusName": r.get("status_name") or "",
            "label": r.get("label") or "", "resources": _resources(r.get("resources")),
            "note": r.get("note") or "", "url": link(r.get("url")),
        } for r in full.get("requests") or []],
        "rights": [right(r) for r in full.get("rights") or []],
        "removed": [right(r) for r in full.get("removed_rights") or []],
    }


def delete_block(person):
    """Почему сотрудника нельзя удалить: текст отказа или "" — можно.
    Не настроена связь или в «Заявках» его нет — удалять не мешаем; нет связи — Error."""
    d = person_info(person)
    keep = [r for r in d.get("rights") or [] if r["keep"]]
    if not keep:
        return ""
    # названия систем бывают в абзац длиной — в отказе хватит ресурсов
    names = [r["resource"] for r in keep]
    return ("Нельзя удалить «%s»: в «Заявках ИТ» у него действуют полномочия — %d (%s). "
            "Сначала сделайте в «Заявках» заявку на снятие полномочий, потом удалите сотрудника."
            % (person.get("name") or "", len(keep), "; ".join(names[:3]) + ("…" if len(names) > 3 else "")))
