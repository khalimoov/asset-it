@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
rem Выгружает всю базу в один файл. Класть его лучше не на этот же диск.
set PGBIN=
for /d %%d in ("C:\Program Files\PostgreSQL\*") do if exist "%%d\bin\pg_dump.exe" set PGBIN=%%d\bin
if not defined PGBIN (
  echo   pg_dump не найден. Укажите путь к папке bin PostgreSQL в этом файле.
  pause
  exit /b 1
)

for /f "tokens=2 delims==" %%p in ('findstr /b "PGDATABASE=" "server\.env"') do set DB=%%p
for /f "tokens=2 delims==" %%p in ('findstr /b "PGUSER=" "server\.env"')     do set DBUSER=%%p
for /f "tokens=2 delims==" %%p in ('findstr /b "PGPASSWORD=" "server\.env"') do set PGPASSWORD=%%p

if not exist "backup" mkdir "backup"
set STAMP=%date:~6,4%-%date:~3,2%-%date:~0,2%
"%PGBIN%\pg_dump.exe" -h localhost -U %DBUSER% -d %DB% -F c -f "backup\asset-it-%STAMP%.dump"
if errorlevel 1 (
  echo   Резервная копия не создана.
  pause
  exit /b 1
)
echo.
echo   Копия готова: backup\asset-it-%STAMP%.dump
echo   Восстановление: pg_restore -h localhost -U %DBUSER% -d %DB% -c "файл.dump"
echo.
pause
