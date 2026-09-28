# -*- coding: utf-8 -*-
"""Кто стоит на адресе: MAC и производитель по нему.

В сети не только компьютеры: IP-телефоны, камеры, видеорегистраторы,
коммутаторы, радиомосты, принтеры. По каждому ответившему адресу обход
собирает то, что можно узнать снаружи и без агентов:

    MAC             из таблицы ARP своей же машины (адрес должен быть в одной
                    сети — через маршрутизатор ARP не виден)
    производитель   по первым трём байтам MAC, справочник IEEE в oui.txt

Имя хоста добирает netscan — по DNS, а если PTR-записи нет, по NetBIOS.
Тип устройства раньше угадывался по открытым портам и баннеру веб-интерфейса;
догадка врала слишком часто, поэтому убрана вместе с опросом портов.
"""
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

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


def collect(ip, mac):
    """Что удалось узнать об адресе: MAC и производитель по нему.

    Тип устройства раньше угадывался по открытым портам, баннеру веб-интерфейса
    и производителю. Догадка выходила ненадёжной, её убрали — а вместе с ней и
    опрос портов: показывать его было негде, а каждый обход сети он затягивал и
    со стороны выглядел сканированием. Имя хоста берёт netscan, оно точное.
    """
    return {"mac": mac or "", "vendor": vendor_of(mac)}
