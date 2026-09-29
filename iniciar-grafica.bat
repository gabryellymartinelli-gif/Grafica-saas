@echo off
setlocal
cd /d "%~dp0"
echo [1/5] Limpando container antigo, se existir...
docker rm -f grafica_mysql >nul 2>&1

echo [2/5] Subindo MySQL...
docker compose up -d
if errorlevel 1 goto :erro

echo [3/5] Instalando dependencias do projeto...
npm install
if errorlevel 1 goto :erro
npm --prefix apps/server install
if errorlevel 1 goto :erro
npm --prefix apps/web install
if errorlevel 1 goto :erro

echo [4/5] Preparando banco...
npm run db:push
if errorlevel 1 goto :erro
npm run db:seed
if errorlevel 1 goto :erro

echo [5/5] Iniciando sistema...
npm run dev
exit /b 0

:erro
echo.
echo Ocorreu um erro. Copie a mensagem acima e envie para o suporte/ChatGPT.
pause
exit /b 1
