@echo off
title Grafica SaaS - Parar
cd /d "%~dp0"
echo Encerrando API e frontend...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=3333,5173,5174; foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {} } }"
echo Aplicacao encerrada. O MySQL e os dados foram mantidos.
pause
