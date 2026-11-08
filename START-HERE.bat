@echo off
rem Double-click this file to run HomeDesigner 3D on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run this app.
  echo Opening the download page. Install the LTS version, then double-click this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\electron (
  echo First run: installing components. This takes a minute or two...
  call npm install
  if errorlevel 1 ( echo Installation failed. Check your internet connection. & pause & exit /b 1 )
)
call npm start
