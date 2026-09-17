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

rem pythonw.exe запускаем напрямую. Через посредника .vbs задача завершалась
rem сразу после старта, процесс оставался жить сам по себе, и schtasks /end
rem уже нечего было останавливать - сервер продолжал отвечать.
schtasks /create /tn "Asset IT" /tr "\"%~dp0.venv\Scripts\pythonw.exe\" \"%~dp0server\serve.py\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 (
  echo   Не удалось создать задание.
  pause
  exit /b 1
)
echo.
echo   Сервер будет запускаться вместе с Windows.
echo   Запустить прямо сейчас:  schtasks /run /tn "Asset IT"
echo   Остановить:              stop.bat  или  schtasks /end /tn "Asset IT"
echo   Убрать автозапуск:       autostart-remove.bat
echo.
pause
