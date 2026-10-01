@echo off
cd /d "%~dp0"
title Sistema da Biblioteca - encerrar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\encerrar-servidor.ps1"
pause
