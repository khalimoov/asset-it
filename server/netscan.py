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
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

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


def host_name(ip, timeout_s=1.0):
    """Имя хоста обратным разрешением.

    Спрашиваем только у тех, кто ответил: у молчащего адреса запрос всё равно
    упрётся в таймаут резолвера и растянет обход.
    """
    old = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(timeout_s)
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return ""
    finally:
        socket.setdefaulttimeout(old)


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

    cur.execute("delete from ip_day where org_id = %s and d < %s",
                (org_id, today - datetime.timedelta(days=HISTORY_DAYS)))
    return {"at": started.isoformat(timespec="seconds"),
            "checked": len(ips), "alive": alive,
            "seconds": round((datetime.datetime.now() - started).total_seconds(), 1)}
