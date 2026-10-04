@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_backend.ps1"
if errorlevel 1 (
  echo.
  echo Backend setup failed. Review the error above.
  pause
  exit /b 1
)
echo.
pause
