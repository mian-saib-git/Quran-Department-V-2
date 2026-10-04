@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify_backend.cmd.ps1"
if errorlevel 1 (
  echo.
  echo Verification failed. Review the error above.
  pause
  exit /b 1
)
echo.
pause
