@echo off
rem Builds a normal Windows installer (Setup .exe) that you can share with anyone.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( echo Please install Node.js first from https://nodejs.org & pause & exit /b 1 )
call npm install
if errorlevel 1 ( pause & exit /b 1 )
call npm run dist
if errorlevel 1 ( pause & exit /b 1 )
echo.
echo Done. Your installer is in the "dist" folder.
start "" "%~dp0dist"
pause
