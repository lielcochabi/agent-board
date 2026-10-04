@echo off
title JARVIS Agent Board
cd /d "%~dp0"
:: Opens the board in your browser, then runs the server in this window (close it to stop).
start "" http://localhost:4747
node server.js
