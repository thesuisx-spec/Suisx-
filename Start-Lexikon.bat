@echo off
rem Lexikon: double-click to open the dictionary (Windows 7/8/10/11, no installation needed).
cd /d "%~dp0"
if not exist "%~dp0dictionary\tools\serve-windows.ps1" (
  echo.
  echo   Сначала распакуйте архив: правой кнопкой по файлу .zip - "Извлечь все",
  echo   затем откройте распакованную папку и запустите Start-Lexikon.bat ещё раз.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dictionary\tools\serve-windows.ps1"
if errorlevel 1 pause
