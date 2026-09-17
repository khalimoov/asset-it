@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo   Нужны права администратора: правой кнопкой по файлу —
  echo   "Запуск от имени администратора".
  pause
  exit /b 1
)

set PORT=8000
for /f "tokens=2 delims==" %%p in ('findstr /b "PORT=" "server\.env"') do set PORT=%%p

netsh advfirewall firewall delete rule name="Asset IT" >nul 2>&1
netsh advfirewall firewall add rule name="Asset IT" dir=in action=allow protocol=TCP localport=%PORT%
echo.
echo   Порт %PORT% открыт для входящих подключений.
echo   Сотрудники заходят по адресу http://имя-сервера:%PORT%
echo   Узнать адрес сервера: ipconfig
echo.
pause
