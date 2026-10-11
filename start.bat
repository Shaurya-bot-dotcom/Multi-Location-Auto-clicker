@echo off
title Multi-Target Autoclicker
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org , install it, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules\electron (
  echo First run: installing Electron ^(this can take a minute^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo Starting Multi-Target Autoclicker...
call npm start
if errorlevel 1 pause
