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

".venv\Scripts\python.exe" -u "server\serve.py"
echo.
echo   Сервер остановлен.
pause
