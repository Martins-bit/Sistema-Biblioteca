@echo off
cd /d "%~dp0"
title Sistema da Biblioteca - criar atalho
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\criar-atalho.ps1"
pause
