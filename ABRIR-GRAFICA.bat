@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Grafica SaaS - Inicializador
cd /d "%~dp0"

echo ==========================================
echo       GRAFICA SAAS - INICIALIZADOR
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado.
  pause
  exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
  echo ERRO: Docker nao encontrado.
  echo Abra o Docker Desktop.
  pause
  exit /b 1
)

echo [1/6] Verificando Docker...
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop ainda nao esta pronto.
  echo Abra o Docker Desktop, espere iniciar e tente novamente.
  pause
  exit /b 1
)

echo [2/6] Iniciando MySQL...
docker compose up -d
if errorlevel 1 goto erro

echo [3/6] Verificando dependencias...
if not exist "node_modules" (
  call npm install
  if errorlevel 1 goto erro
)
if not exist "apps\server\node_modules" (
  call npm --prefix apps/server install
  if errorlevel 1 goto erro
)
if not exist "apps\web\node_modules" (
  call npm --prefix apps/web install
  if errorlevel 1 goto erro
)

echo [4/6] Preparando banco...
call npm run db:push
if errorlevel 1 goto erro
if not exist ".grafica-seed-ok" (
  call npm run db:seed
  if errorlevel 1 goto erro
  type nul > ".grafica-seed-ok"
)

echo [5/6] Recuperando arquivos enviados de versoes anteriores...
if not exist "%USERPROFILE%\.grafica-saas\uploads" mkdir "%USERPROFILE%\.grafica-saas\uploads"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dest=Join-Path $env:USERPROFILE '.grafica-saas\uploads'; $base=Split-Path -Parent (Get-Location); Get-ChildItem -Path $base -Directory -Recurse -Filter uploads -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'apps\\server\\uploads$' } | ForEach-Object { Copy-Item -Path (Join-Path $_.FullName '*') -Destination $dest -Force -ErrorAction SilentlyContinue }"

echo [6/6] Limpando instancias antigas...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ports=3333,5173,5174; foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {} } }"
timeout /t 2 /nobreak >nul

echo.
echo Iniciando API e frontend...
start "Grafica SaaS - API e Frontend" /min cmd /c "cd /d ""%~dp0"" && npm run dev"

echo Aguardando API...
set /a API_TRIES=0
:wait_api
set /a API_TRIES+=1
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:3333/api/health; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto api_ok
if !API_TRIES! GEQ 30 (
  echo ERRO: API nao respondeu na porta 3333.
  goto erro
)
timeout /t 1 /nobreak >nul
goto wait_api

:api_ok
echo API OK.

echo Aguardando frontend...
set /a WEB_TRIES=0
:wait_web
set /a WEB_TRIES+=1
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5173; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto web_ok
if !WEB_TRIES! GEQ 30 (
  echo ERRO: Frontend nao respondeu na porta 5173.
  goto erro
)
timeout /t 1 /nobreak >nul
goto wait_web

:web_ok
echo Frontend OK.
echo.
echo ==========================================
echo           SISTEMA PRONTO
echo ==========================================
echo Site: http://localhost:5173
echo API:  http://localhost:3333
echo.
start "" http://localhost:5173
exit /b 0

:erro
echo.
echo ==========================================
echo ERRO DURANTE A INICIALIZACAO
echo ==========================================
echo Veja a mensagem acima.
pause
exit /b 1
