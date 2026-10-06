@echo off
title Agent Board
cd /d "%~dp0"
:: Opens the board in Firefox (falls back to your default browser), then runs the server here. Close this window to stop it.
set "FF=%ProgramFiles%\Mozilla Firefox\firefox.exe"
if exist "%FF%" (start "" "%FF%" http://localhost:4747) else (start "" http://localhost:4747)
node server.js
