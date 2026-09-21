# -*- coding: utf-8 -*-
"""Смена пароля учётной записи с консоли сервера — на случай, если администратор
забыл свой пароль и сменить его через интерфейс уже некому.

    python server/reset_password.py admin            спросит новый пароль
    python server/reset_password.py admin НовыйПароль

В Docker:  docker compose exec app python server/reset_password.py admin

Настройки базы берутся как у сервера: из server/.env или переменных окружения.
Учётная запись при этом включается (active) и переводится на свой пароль (auth=local).
"""
import getpass
import os
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    login = sys.argv[1].strip()
    password = sys.argv[2] if len(sys.argv) > 2 else ""
    if not password:
        password = getpass.getpass("  Новый пароль для %s: " % login) if sys.stdin.isatty() \
            else input().strip()
    if len(password) < 6:
        print("  Пароль — не короче 6 знаков.")
        return 1

    import app                              # подхватывает .env и настройки базы
    with app.db() as conn, conn.cursor() as cur:
        cur.execute("select id, full_name from staff where lower(login) = lower(%s)", (login,))
        row = cur.fetchone()
        if not row:
            print("  Учётной записи с логином «%s» нет." % login)
            return 1
        cur.execute("""update staff set pass_hash = %s, auth = 'local', active = true
                        where id = %s""", (app.hash_password(password), row["id"]))
        cur.execute("delete from session where staff_id = %s", (row["id"],))
    print("  Пароль для %s (%s) заменён, старые сессии закрыты." % (login, row["full_name"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
