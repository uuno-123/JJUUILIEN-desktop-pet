@echo off
chcp 65001 >nul
title Juju Dev Build
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo [ERROR] Electron not found. Run "npm install" first.
  pause
  exit /b 1
)
echo Starting Juju dev build... (close this window to stop)
echo.
node_modules\electron\dist\electron.exe .
echo.
echo Juju dev build exited.
pause
