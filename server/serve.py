# -*- coding: utf-8 -*-
"""Запуск «Учёта ИТ-отдела» на рабочем сервере.

Отличие от `python app.py`: страницу отдаёт waitress, а не отладочный сервер Flask.
Отладочный однопоточен по-настоящему только на словах, не умеет держать нагрузку и
сам пишет в консоль предупреждение — на сервере отдела ему не место.

Если waitress почему-то не установлен, запуск не падает: работаем через Flask,
о чём честно сообщаем в консоль.
"""
import os
import sys


# Консоль Windows живёт в cp866: типографских тире и рамок там нет.
# Не даём установке падать на выводе — непечатаемое заменится вопросом.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as application


def main():
    application.seed()
    # фоновый обход адресов: под waitress его тоже надо поднять,
    # иначе расписание работало бы только при запуске через app.py
    application.start_netscan()

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    shown = "localhost" if host in ("0.0.0.0", "") else host

    print()
    print("  Учёт ИТ-отдела")
    print("  адрес в сети:  http://{}:{}".format(shown, port))
    if host in ("0.0.0.0", ""):
        print("  сотрудникам:   http://<имя-или-адрес-сервера>:{}".format(port))
    print("  остановить:    Ctrl+C")
    print()

    try:
        from waitress import serve
    except ImportError:
        print("  ВНИМАНИЕ: waitress не установлен, работаем на отладочном сервере Flask.")
        print()
        application.app.run(host=host, port=port, threaded=True)
        return

    serve(application.app, host=host, port=port, threads=8, ident="Asset IT")


if __name__ == "__main__":
    main()
