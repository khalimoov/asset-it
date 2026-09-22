# -*- coding: utf-8 -*-
"""Опрос адресов: кто сейчас в сети и когда был в последний раз.

Сначала обычный ping. Тем, кто не ответил, стучимся в 445 и 3389 — у машин
с включённым брандмауэром Windows ICMP часто закрыт, а файловый доступ и
удалённый рабочий стол отвечают. Без этого половина живых компьютеров
показывалась бы выключенной.

Порядок важен и по скорости: обход /24 пингом занимает пару секунд, а перебор
портов по мёртвым адресам — больше десяти, поэтому TCP только для молчунов.
"""
import datetime
import ipaddress
import re
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import netinfo

# чтобы на сервере не мигали чёрные окна консоли
NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

TCP_PORTS = (445, 3389)
DEFAULTS = {"enabled": False, "everyMin": 15, "wholePools": False,
            "timeoutMs": 800, "workers": 64}


def merge_config(saved):
    cfg = dict(DEFAULTS)
    cfg.update(saved or {})
    cfg["everyMin"] = max(1, min(1440, int(cfg.get("everyMin") or 15)))
    cfg["timeoutMs"] = max(200, min(5000, int(cfg.get("timeoutMs") or 800)))
    cfg["workers"] = max(4, min(256, int(cfg.get("workers") or 64)))
    return cfg


def ping(ip, timeout_ms=800):
    if sys.platform == "win32":
        cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip]
    else:
        cmd = ["ping", "-c", "1", "-W", str(max(1, timeout_ms // 1000)), ip]
    try:
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=NO_WINDOW, timeout=timeout_ms / 1000.0 + 3)
        return r.returncode == 0
    except Exception:
        return False


def tcp_probe(ip, timeout_ms=800):
    """Возвращает номер откликнувшегося порта или 0."""
    for p in TCP_PORTS:
        try:
            with socket.create_connection((ip, p), timeout=timeout_ms / 1000.0):
                return p
        except OSError:
            continue
    return 0


def sweep(ips, cfg=None):
    """{ip: {"alive": bool, "method": "icmp" | "tcp:445" | ""}} для списка адресов."""
    cfg = merge_config(cfg)
    ips = [str(i) for i in dict.fromkeys(ips) if i]
    if not ips:
        return {}
    tmo, workers = cfg["timeoutMs"], cfg["workers"]

    with ThreadPoolExecutor(max_workers=workers) as ex:
        by_icmp = list(ex.map(lambda ip: ping(ip, tmo), ips))
    out = {ip: {"alive": ok, "method": "icmp" if ok else ""}
           for ip, ok in zip(ips, by_icmp)}

    silent = [ip for ip in ips if not out[ip]["alive"]]
    if silent:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for ip, port in zip(silent, ex.map(lambda ip: tcp_probe(ip, tmo), silent)):
                if port:
                    out[ip] = {"alive": True, "method": "tcp:%d" % port}
    return out


def expand_pool(prefix, host_from, host_to):
    """Адреса диапазона: 192.168.203. + 1..254."""
    out = []
    prefix = (prefix or "").strip()
    if not prefix.endswith("."):
        prefix += "."
    for n in range(max(1, int(host_from or 1)), min(254, int(host_to or 254)) + 1):
        ip = prefix + str(n)
        try:
            ipaddress.IPv4Address(ip)
        except ValueError:
            continue
        out.append(ip)
    return out


# ------------------------------------------------------------------ работа с базой

def targets(cur, cfg, org_id):
    """Что опрашивать: занятые адреса или диапазоны пулов целиком.

    Только адреса своего учреждения: один и тот же 192.168.1.10 может быть занят
    и там, и там, поэтому состояние хранится парой (учреждение, адрес).
    """
    cfg = merge_config(cfg)
    ips = []
    if cfg.get("wholePools"):
        cur.execute("""select prefix, host_from, host_to from ip_pool
                        where org_id = %s order by name""", (org_id,))
        for r in cur.fetchall():
            ips += expand_pool(r["prefix"], r["host_from"], r["host_to"])
    # занятые адреса берём всегда: они могут лежать и вне описанных пулов
    cur.execute("""select distinct kv.value as ip
                     from item
                     join registry r on r.id = item.registry_id,
                          jsonb_each_text(item.specs) as kv(key, value)
                    where r.org_id = %s
                      and kv.value ~ '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$'""", (org_id,))
    for r in cur.fetchall():
        try:
            ipaddress.IPv4Address(r["ip"])
        except ValueError:
            continue
        ips.append(r["ip"])
    return list(dict.fromkeys(ips))


HISTORY_DAYS = 183          # полгода: столько держим историю по дням
DEEP_EVERY_H = 24           # как часто перебирать подробности об устройстве
DEEP_PER_RUN = 60           # сколько адресов разбираем подробно за один обход


def dns_name(ip, timeout_s=1.0):
    """Имя по обратной записи DNS. Пусто, если PTR нет."""
    was = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(timeout_s)
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return ""
    finally:
        socket.setdefaulttimeout(was)


# Строка таблицы NetBIOS. У nbtstat это «PC-IVANOV <00> UNIQUE Registered»,
# у nmblookup — «PLANT1-PC01 <00> - B <ACTIVE>»: слова UNIQUE там нет, зато
# групповые записи помечены GROUP. Поэтому ловим имя и тип, а групповые
# отсеиваем по остатку строки.
RE_NB = re.compile(r"^[ \t]*([^\s<][^<\r\n]*?)[ \t]*<(\w\w)>(.*)$", re.MULTILINE)


def parse_netbios(out):
    """Имя узла из вывода nbtstat или nmblookup, или пусто."""
    for m in RE_NB.finditer(out or ""):
        name, kind, rest = m.group(1).strip(), m.group(2).upper(), m.group(3).upper()
        if "GROUP" in rest:            # рабочая группа или домен, не имя машины
            continue
        # <00> — сам узел, <20> — служба файлов; оба годятся как имя машины
        if kind not in ("00", "20"):
            continue
        if not name or name.startswith("__") or name.startswith("MSBROWSE"):
            continue
        return name
    return ""


def netbios_name(ip, timeout_s=2.0):
    """Имя по NetBIOS — запасной путь, когда обратной записи в DNS нет.

    В доменной сети PTR заводят не для всех рабочих станций, а имя по NetBIOS
    машина отдаёт сама. На Windows это nbtstat, на Linux — nmblookup из
    samba-common-bin; нет его — просто возвращаем пусто.
    """
    cmd = ["nbtstat", "-A", ip] if sys.platform.startswith("win") else ["nmblookup", "-A", ip]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout_s)
    except Exception:
        return ""
    out = (r.stdout or b"").decode("cp866" if sys.platform.startswith("win") else "utf-8",
                                   "replace")
    return parse_netbios(out)


def host_name(ip, timeout_s=1.0):
    """Имя хоста: сначала DNS, потом NetBIOS.

    Спрашиваем только у тех, кто ответил: у молчащего адреса запрос всё равно
    упрётся в таймаут и растянет обход.
    """
    return dns_name(ip, timeout_s) or netbios_name(ip)


def run(cur, cfg, org_id):
    """Один обход. Возвращает сводку."""
    cfg = merge_config(cfg)
    ips = targets(cur, cfg, org_id)
    started = datetime.datetime.now()
    res = sweep(ips, cfg)
    today = datetime.date.today()
    alive = 0

    # имена узнаём разом и только у ответивших — их немного
    up = [ip for ip, r in res.items() if r["alive"]]
    names = {}
    if up:
        with ThreadPoolExecutor(max_workers=min(len(up), cfg["workers"])) as ex:
            for ip, nm in zip(up, ex.map(host_name, up)):
                if nm:
                    names[ip] = nm

    for ip, r in res.items():
        if r["alive"]:
            alive += 1
            cur.execute("""
                insert into ip_status (org_id, ip, alive, method, last_check, last_seen, host_name)
                values (%s, %s, true, %s, now(), now(), %s)
                on conflict (org_id, ip) do update set
                  alive = true, method = excluded.method,
                  last_check = now(), last_seen = now(),
                  host_name = case when excluded.host_name <> '' then excluded.host_name
                                   else ip_status.host_name end
            """, (org_id, ip, r["method"], names.get(ip, "")))
        else:
            cur.execute("""
                insert into ip_status (org_id, ip, alive, method, last_check)
                values (%s, %s, false, '', now())
                on conflict (org_id, ip) do update set alive = false, last_check = now()
            """, (org_id, ip))
        # день «зелёный», если адрес ответил хотя бы раз за сутки
        cur.execute("""
            insert into ip_day (org_id, ip, d, alive, seen, checks)
            values (%s, %s, %s, %s, %s, 1)
            on conflict (org_id, ip, d) do update set
              alive = ip_day.alive or excluded.alive,
              seen = ip_day.seen + excluded.seen,
              checks = ip_day.checks + 1
        """, (org_id, ip, today, bool(r["alive"]), 1 if r["alive"] else 0))

    deep = deep_pass(cur, org_id, up, names)

    cur.execute("delete from ip_day where org_id = %s and d < %s",
                (org_id, today - datetime.timedelta(days=HISTORY_DAYS)))
    return {"at": started.isoformat(timespec="seconds"),
            "checked": len(ips), "alive": alive, "detailed": deep,
            "seconds": round((datetime.datetime.now() - started).total_seconds(), 1)}


def deep_pass(cur, org_id, up, names):
    """Подробности об устройствах: MAC, производитель, порты, баннер, тип.

    Тяжелее обычного пинга — полтора десятка соединений на адрес плюс запрос
    к веб-интерфейсу, — поэтому не на каждый обход: берём тех, о ком ещё
    ничего не знаем или знаем сутками старше, и не больше DEEP_PER_RUN за раз.
    Расписание обхода от этого не разъезжается.
    """
    if not up:
        return 0
    cur.execute("""select ip from ip_status
                    where org_id = %s and ip = any(%s)
                      and probed_at is not null
                      and probed_at > now() - (%s || ' hours')::interval""",
                (org_id, list(up), str(DEEP_EVERY_H)))
    fresh = set(r["ip"] for r in cur.fetchall())
    todo = [ip for ip in up if ip not in fresh][:DEEP_PER_RUN]
    if not todo:
        return 0

    arp = netinfo.arp_table()
    def one(ip):
        try:
            return ip, netinfo.collect(ip, arp.get(ip, ""), names.get(ip, ""))
        except Exception:
            return ip, None

    with ThreadPoolExecutor(max_workers=min(10, len(todo))) as ex:
        got = list(ex.map(one, todo))

    done = 0
    for ip, info in got:
        if not info:
            continue
        done += 1
        # пустым не затираем: MAC виден только пока адрес в одной сети с нами,
        # а веб-интерфейс мог просто не ответить в этот раз
        cur.execute("""
            update ip_status set
              mac    = case when %s <> '' then %s else mac end,
              vendor = case when %s <> '' then %s else vendor end,
              ports  = case when %s <> '' then %s else ports end,
              banner = case when %s <> '' then %s else banner end,
              kind   = case when %s <> '' then %s else kind end,
              probed_at = now()
             where org_id = %s and ip = %s
        """, (info["mac"], info["mac"], info["vendor"], info["vendor"],
              info["ports"], info["ports"], info["banner"], info["banner"],
              info["kind"], info["kind"], org_id, ip))
    return done
