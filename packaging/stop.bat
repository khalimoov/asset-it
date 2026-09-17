@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
rem Останавливает сервер, как бы он ни был запущен: из start.bat или задачей.
set PORT=8000
for /f "tokens=2 delims==" %%p in ('findstr /b "PORT=" "server\.env"') do set PORT=%%p

rem Сначала гасим задачу автозапуска, иначе она поднимет сервер снова
schtasks /query /tn "Asset IT" >nul 2>&1
if not errorlevel 1 schtasks /end /tn "Asset IT" >nul 2>&1

set FOUND=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr LISTENING ^| findstr ":%PORT% "') do (
  set FOUND=1
  echo   Останавливаю процесс %%a ...
  taskkill /F /PID %%a >nul 2>&1
)

if defined FOUND (
  echo.
  echo   Сервер остановлен. Порт %PORT% свободен.
) else (
  echo.
  echo   Сервер не запущен: порт %PORT% никто не слушает.
)
echo.
pause
