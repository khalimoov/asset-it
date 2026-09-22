# -*- coding: utf-8 -*-
"""Что за устройство стоит на адресе.

В сети не только компьютеры: IP-телефоны, камеры, видеорегистраторы,
коммутаторы, радиомосты, принтеры. Опрос собирает по каждому ответившему
адресу всё, что можно узнать снаружи и без агентов:

    MAC             из таблицы ARP своей же машины (адрес должен быть в одной
                    сети — через маршрутизатор ARP не виден)
    производитель   по первым трём байтам MAC, справочник IEEE в oui.txt
    порты           короткий список характерных портов
    баннер          заголовок и Server веб-интерфейса, если он открыт
    тип             догадка по совокупности: вендор + порты + баннер

Ничего из этого не требует SNMP-строки, пароля или установки на устройство.
"""
import os
import re
import socket
import ssl
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.abspath(__file__))
NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# Порты выбраны так, чтобы различать классы техники, а не переписать всё
# открытое: каждый лишний порт — это ещё одно соединение на каждый адрес.
PORTS = [
    21,     # FTP — регистраторы и камеры
    22,     # SSH — сетевое оборудование, Linux
    23,     # Telnet — коммутаторы
    80,     # веб-интерфейс
    135,    # RPC — Windows
    139,    # NetBIOS — Windows
    443,    # веб-интерфейс по TLS
    445,    # SMB — Windows
    515,    # LPD — принтеры
    554,    # RTSP — камеры и регистраторы
    2000,   # SCCP — телефоны Cisco
    3389,   # RDP — Windows
    5060,   # SIP — IP-телефоны
    8000,   # веб регистраторов Hikvision
    8080,   # веб-интерфейс
    9100,   # печать напрямую — принтеры
    34567,  # регистраторы на XMeye
    37777,  # регистраторы Dahua
]
WEB_PORTS = [(80, False), (8080, False), (8000, False), (443, True), (8443, True)]

_OUI = None


def oui_table():
    """Справочник «первые три байта MAC -> производитель». Читается один раз."""
    global _OUI
    if _OUI is None:
        t = {}
        path = os.path.join(BASE, "oui.txt")
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    p, _, name = line.partition("\t")
                    if len(p) == 6 and name.strip():
                        t[p] = name.strip()
        except OSError:
            pass
        _OUI = t
    return _OUI


def vendor_of(mac):
    """Производитель по MAC. Пусто, если адрес случайный или незнакомый."""
    hexed = re.sub(r"[^0-9A-Fa-f]", "", mac or "").upper()
    if len(hexed) < 6:
        return ""
    # второй бит первого байта — признак локально назначенного адреса:
    # такие раздают себе сами, производителя по ним не узнать
    try:
        if int(hexed[0:2], 16) & 0x02:
            return ""
    except ValueError:
        return ""
    return oui_table().get(hexed[0:6], "")


RE_ARP = re.compile(r"(\d{1,3}(?:\.\d{1,3}){3})\D+([0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5})")


def arp_table():
    """{ip: mac} из таблицы ARP этой машины.

    Своей таблицей обходимся сознательно: она уже заполнена только что
    прошедшим пингом, а лезть за MAC по SNMP или на коммутатор — это пароли
    и доступы, которых у нас нет.
    """
    cmds = ([["arp", "-a"]] if sys.platform.startswith("win")
            else [["ip", "neigh"], ["arp", "-an"]])
    for cmd in cmds:
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=10, creationflags=NO_WINDOW)
        except Exception:
            continue
        out = (r.stdout or b"").decode("cp866" if sys.platform.startswith("win") else "utf-8",
                                       "replace")
        got = {}
        for m in RE_ARP.finditer(out):
            got[m.group(1)] = m.group(2).replace("-", ":").lower()
        if got:
            return got
    return {}


def port_open(ip, port, timeout_ms=600):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout_ms / 1000.0)
    try:
        return s.connect_ex((ip, port)) == 0
    except OSError:
        return False
    finally:
        try:
            s.close()
        except OSError:
            pass


def scan_ports(ip, ports=None, timeout_ms=600, workers=18):
    """Открытые порты из списка PORTS."""
    ports = ports or PORTS
    with ThreadPoolExecutor(max_workers=min(workers, len(ports))) as ex:
        ok = list(ex.map(lambda p: port_open(ip, p, timeout_ms), ports))
    return [p for p, good in zip(ports, ok) if good]


RE_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def http_banner(ip, open_ports, timeout_s=2.0):
    """Заголовок веб-интерфейса: «Server» и <title>.

    У камер и регистраторов в титуле прямо написан производитель, у
    коммутаторов — модель. Это самая говорящая строчка из всех, что можно
    получить без пароля.
    """
    import http.client
    for port, tls in WEB_PORTS:
        if port not in open_ports:
            continue
        try:
            if tls:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                conn = http.client.HTTPSConnection(ip, port, timeout=timeout_s, context=ctx)
            else:
                conn = http.client.HTTPConnection(ip, port, timeout=timeout_s)
            conn.request("GET", "/", headers={"User-Agent": "asset-it"})
            r = conn.getresponse()
            srv = (r.getheader("Server") or "").strip()
            body = r.read(4096).decode("utf-8", "replace")
            conn.close()
        except Exception:
            continue
        title = ""
        m = RE_TITLE.search(body)
        if m:
            title = " ".join(m.group(1).split())[:80]
        parts = [x for x in (title, srv) if x]
        if parts:
            return " · ".join(parts)[:120]
    return ""


# Производители, по которым тип понятен почти всегда.
CAM_VENDORS = ("hikvision", "dahua", "uniview", "tiandy", "axis", "hanwha", "bosch",
               "vivotek", "rvi", "novicam", "trassir", "beward", "milesight")
PHONE_VENDORS = ("yealink", "grandstream", "fanvil", "snom", "alcatel", "escene",
                 "htek", "akuvox", "cisco spa")
NET_VENDORS = ("cisco", "hewlett packard", "aruba", "d-link", "tp-link", "mikrotik",
               "ubiquiti", "zyxel", "huawei", "juniper", "eltex", "qtech", "extreme",
               "allied telesis", "moxa", "netgear")
RADIO_VENDORS = ("ubiquiti", "mikrotik", "cambium", "deliberant", "infinet", "radwin")
PRINT_VENDORS = ("kyocera", "ricoh", "xerox", "canon", "brother", "epson", "pantum",
                 "lexmark", "konica")


def guess_kind(vendor, ports, banner, host):
    """Тип устройства по совокупности признаков.

    Догадка, а не истина: имя, порты и производитель складываются в картину,
    но спорить с человеком она не должна — в карточке это подсказка, которую
    видно рядом с портами и баннером.
    """
    v = (vendor or "").lower()
    b = (banner or "").lower()
    h = (host or "").lower()
    ps = set(ports or [])
    text = v + " " + b + " " + h

    def any_in(words):
        return any(w in text for w in words)

    if 9100 in ps or 515 in ps or any_in(PRINT_VENDORS):
        return "Принтер"
    if 554 in ps or 37777 in ps or 34567 in ps or any_in(CAM_VENDORS):
        # у регистратора портов веб-интерфейса больше, а RTSP-потоков много
        return "Видеорегистратор" if (8000 in ps or 34567 in ps or 37777 in ps) else "Камера"
    if 5060 in ps or 2000 in ps or any_in(PHONE_VENDORS):
        return "IP-телефон"
    if 3389 in ps or 445 in ps or 135 in ps:
        return "Компьютер"
    if any_in(RADIO_VENDORS) and (80 in ps or 443 in ps or 22 in ps):
        return "Радиомост / точка доступа"
    if any_in(NET_VENDORS) and (23 in ps or 22 in ps or 80 in ps):
        return "Коммутатор / маршрутизатор"
    # веб-интерфейс сам по себе ни о чём не говорит: он есть и у камеры,
    # и у коммутатора, и у ИБП. Не уверены — не называем
    return ""


def collect(ip, mac, host, timeout_ms=600):
    """Всё, что удалось узнать об одном адресе."""
    vendor = vendor_of(mac)
    ports = scan_ports(ip, timeout_ms=timeout_ms)
    banner = http_banner(ip, ports)
    return {"mac": mac or "", "vendor": vendor,
            "ports": ",".join(str(p) for p in ports),
            "banner": banner,
            "kind": guess_kind(vendor, ports, banner, host)}
