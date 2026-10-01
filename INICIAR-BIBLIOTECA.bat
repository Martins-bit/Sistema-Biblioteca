@echo off
REM ============================================================
REM  Sistema da Biblioteca - INICIAR (Etapa 12)
REM  Uso: duplo clique em INICIAR-BIBLIOTECA.bat
REM  - confere Node.js e dependencias; inicia o servidor;
REM  - abre o navegador em http://localhost:3000
REM  NAO apaga, NAO restaura, NAO altera o banco de dados.
REM ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js LTS 22+ em https://nodejs.org e rode de novo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias (primeira vez, precisa de internet)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar dependencias.
    echo.
    pause
    exit /b 1
  )
)

if not exist biblioteca.db (
  echo Primeira execucao: o banco sera criado automaticamente.
  echo Depois crie a conta com: node scripts\create-user.js
)

echo.
echo Verificando instalacao...
call node scripts\verificar-instalacao.js

echo.
echo Iniciando o Sistema da Biblioteca...
echo Depois abra: http://localhost:3000
echo Para PARAR: feche esta janela ou pressione Ctrl+C.
echo.
start "" "http://localhost:3000"
call npm start
pause
