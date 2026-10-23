@echo off
title AskAI CLI
cd /d "%~dp0"
powershell.exe -NoExit -ExecutionPolicy Bypass -Command "& 'node.exe' '%~dp0askai.js' cli"
