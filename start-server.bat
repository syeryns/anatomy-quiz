@echo off
chcp 65001 > nul
title Anatomy Quiz Server
cd /d "%~dp0"
node server.js
pause
