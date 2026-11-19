@echo off
rem Windows: double-click to open Tokify. The first run installs everything (npm run setup).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.13 or newer is required: https://nodejs.org & pause & exit /b 1)
set ready=0
if exist node_modules\ if exist dist\index.html set ready=1
if %ready%==1 (call npm start) else (call npm run setup)
if errorlevel 1 (echo. & echo Tokify could not start. & pause)
