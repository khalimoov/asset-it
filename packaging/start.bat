@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo   Сначала запустите install.bat
  pause
  exit /b 1
)

rem В новой версии могут появиться библиотеки, которых нет в старом окружении.
rem Проверяем и доставляем из папки wheels: интернет для этого не нужен.
rem Без этой проверки сервер молча падал на распознавании накладных.
".venv\Scripts\python.exe" -c "import flask,psycopg,waitress,ldap3,pypdfium2,pytesseract,PIL" >nul 2>&1
if errorlevel 1 (
  echo   После обновления не хватает библиотек - доставляю из папки wheels ...
  ".venv\Scripts\python.exe" -m pip install --no-index --find-links wheels --quiet flask "psycopg[binary]" waitress ldap3 pypdfium2 pytesseract pillow
  if errorlevel 1 (
    echo.
    echo   Не удалось доставить библиотеки. Запустите install.bat.
    echo.
    pause
    exit /b 1
  )
  echo   Готово.
)

".venv\Scripts\python.exe" -u "server\serve.py"
echo.
echo   Сервер остановлен.
pause
