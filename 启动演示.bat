@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动【健身打卡】服务  http://localhost:3002/
start "fit-3002" cmd /k node server.js
timeout /t 2 >nul
start "" "http://localhost:3002/"
