@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
echo.
echo   Установка распознавания накладных
echo.

rem Движок Tesseract ставится один раз. Интернет не нужен: установщик лежит
rem рядом, в папке tesseract.
if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
  echo   Движок уже установлен.
  echo   Словари русского языка лежат в server\tessdata и подключаются сами.
  echo.
  pause
  exit /b 0
)

if not exist "tesseract\tesseract-ocr-setup.exe" (
  echo   Не найден файл tesseract\tesseract-ocr-setup.exe
  echo   Распакуйте архив целиком, вместе с папкой tesseract.
  echo.
  pause
  exit /b 1
)

net session >nul 2>&1
if errorlevel 1 (
  echo   Нужны права администратора: правой кнопкой по файлу —
  echo   "Запуск от имени администратора".
  echo.
  pause
  exit /b 1
)

echo   Ставлю движок, это займёт около минуты ...
"tesseract\tesseract-ocr-setup.exe" /S
if not exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
  echo.
  echo   Установка не завершилась. Запустите tesseract\tesseract-ocr-setup.exe вручную.
  echo.
  pause
  exit /b 1
)

rem Установщик больше не нужен - освобождаем 48 МБ. Если понадобится
rem снова, его всегда можно взять из архива.
del /q "tesseract\tesseract-ocr-setup.exe" >nul 2>&1
rmdir "tesseract" >nul 2>&1

echo.
echo   Готово. Русский язык уже в комплекте: server\tessdata
echo   Установщик удалён, освободилось около 48 МБ.
echo   Перезапустите сервер - stop.bat, затем start.bat
echo.
pause
