# -*- coding: utf-8 -*-
"""Сборка страницы приложения из частей в web/.

Страница одна (приложение не перезагружается при переходах), но исходники
разложены по файлам: каркас web/index.html, разметка разделов и окон в
web/parts/, стили и скрипты в web/static/. Каркас ссылается на части строкой

    <!-- include: parts/views/ips.html -->

и сервер подставляет их при каждом запросе — правка части видна сразу, без
сборки. Ссылки на /static/ получают ?v=<сборка>: после обновления браузер
возьмёт свежие файлы, а не старые из кеша.

render(inline=True) встраивает стили и скрипты прямо в страницу — так её можно
открыть файлом, без сервера (этим пользуется стенд для проверок).
"""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
INCLUDE = re.compile(r"^[ \t]*<!-- include: ([\w./-]+) -->[ \t]*\r?\n?", re.M)
STATIC = re.compile(r'((?:src|href)=")/static/([\w./-]+)(")')


def _part(rel, depth=0):
    """Текст части с уже подставленными вложенными частями. Выйти из web/ нельзя."""
    path = (WEB / rel).resolve()
    if WEB not in path.parents or not path.is_file():
        raise FileNotFoundError("нет части страницы: " + rel)
    text = path.read_text(encoding="utf-8")
    if depth > 5:
        raise RuntimeError("слишком глубокая вложенность частей: " + rel)
    return INCLUDE.sub(lambda m: _part(m.group(1), depth + 1), text)


def render(build="", inline=False):
    html = _part("index.html")
    if inline:
        html = re.sub(r'<link rel="stylesheet" href="/static/([\w./-]+)">',
                      lambda m: "<style>\n" + _part("static/" + m.group(1)) + "</style>", html)
        html = re.sub(r'<script src="/static/([\w./-]+)"></script>',
                      lambda m: "<script>\n" + _part("static/" + m.group(1)) + "</script>", html)
        return html
    if build:
        html = STATIC.sub(lambda m: m.group(1) + "/static/" + m.group(2) + "?v=" + build + m.group(3), html)
    return html
