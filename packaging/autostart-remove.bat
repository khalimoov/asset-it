@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo   Нужны права администратора.
  pause
  exit /b 1
)
schtasks /delete /tn "Asset IT" /f
echo.
echo   Автозапуск убран.
echo.
pause
