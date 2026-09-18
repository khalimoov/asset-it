@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
echo.
echo   ============================================
echo     Учёт ИТ-отдела — установка на сервер
echo   ============================================
echo.

rem --- ищем Python 3.14 ---
set PY=
py -3.14 -c "import sys" >nul 2>&1 && set PY=py -3.14
if not defined PY python -c "import sys" >nul 2>&1 && set PY=python
if not defined PY (
  echo   Python не найден.
  echo   Установите Python 3.14 для Windows 64 бита и поставьте галочку
  echo   "Add python.exe to PATH", затем запустите install.bat заново.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('%PY% -c "import sys;print(sys.version.split()[0])"') do set PYVER=%%v
for /f "delims=" %%b in ('%PY% -c "import sysconfig;print(sysconfig.get_platform())"') do set PYBITS=%%b
echo   Python: %PYVER%   платформа: %PYBITS%
if /i not "%PYBITS%"=="win-amd64" (
  echo.
  echo   ВНИМАНИЕ: нужен 64-битный Python для Windows.
  echo   Библиотеки в папке wheels собраны под win-amd64.
  echo.
  pause
  exit /b 1
)
echo.

rem --- окружение с библиотеками ---
if exist ".venv\Scripts\python.exe" (
  echo   Окружение .venv уже есть — использую его.
) else (
  echo   Создаю окружение .venv ...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo   Не удалось создать окружение.
    pause
    exit /b 1
  )
)

echo   Ставлю библиотеки из папки wheels. Интернет не нужен ...
".venv\Scripts\python.exe" -m pip install --no-index --find-links wheels flask "psycopg[binary]" waitress ldap3 pypdfium2 pytesseract pillow
if errorlevel 1 (
  echo.
  echo   Библиотеки установить не удалось.
  echo   Колёса в папке wheels собраны для Python 3.14, Windows 64 бита.
  echo.
  pause
  exit /b 1
)
echo   Библиотеки установлены.

rem --- база данных ---
".venv\Scripts\python.exe" -u "server\setup_db.py"
if errorlevel 1 (
  echo.
  echo   Установка прервана на настройке базы.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo     Готово. Дальше:
echo       1. start.bat             — запустить сервер
echo       2. open-firewall.bat     — открыть порт для сети
echo       3. autostart-install.bat — запускать вместе с Windows
echo.
echo     Логин и пароль администратора появятся при первом запуске
echo     в окне и в файле server\FIRST_LOGIN_имя-базы.txt
echo   ============================================
echo.
pause
