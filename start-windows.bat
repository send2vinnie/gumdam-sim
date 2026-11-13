@echo off
rem Starts a small local web server for the simulator and opens it in your browser.
rem Needs only Windows PowerShell (built in). Close this window to stop the server.
cd /d "%~dp0"
start "" http://localhost:8080/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8080
