@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Sistema da Biblioteca

if not defined PORT set PORT=3000

echo ============================================
echo    Sistema da Biblioteca - iniciar
echo ============================================
echo.

REM 1) Node.js esta instalado?
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado neste computador.
  echo        Instale o Node.js 22+ em https://nodejs.org
  echo        e clique duplo novamente em INICIAR-BIBLIOTECA.bat
  echo.
  pause
  exit /b 1
)

REM 2) Dependencias ja instaladas? Se nao, instala (uma unica vez, com internet)
if not exist node_modules (
  echo Primeira vez neste computador: instalando dependencias...
  echo Isso precisa de internet APENAS nesta vez.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falhou ao instalar as dependencias.
    echo        Verifique a internet e clique duplo de novo.
    echo.
    pause
    exit /b 1
  )
  echo.
)

REM 3) O servidor ja esta rodando? Se sim, NAO cria uma segunda instancia
node -e "require('http').get('http://127.0.0.1:%PORT%/login.html',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
if not errorlevel 1 (
  echo O Sistema da Biblioteca ja esta em execucao.
  echo Nao sera criada uma segunda instancia.
  echo Abrindo o navegador...
  goto :abrir
)

REM 3b) Porta ocupada por OUTRO programa que nao responde?
node -e "const n=require('net');const s=n.connect(%PORT%,'127.0.0.1');s.setTimeout(700);s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>{s.destroy();process.exit(1)})"
if not errorlevel 1 (
  echo [ERRO] A porta %PORT% esta ocupada por OUTRO programa
  echo        que nao e o Sistema da Biblioteca.
  echo        Feche esse programa e tente de novo.
  echo.
  pause
  exit /b 1
)

REM 4) Diagnostico rapido - somente leitura, nao altera o banco
echo Verificando a instalacao...
node scripts\verificar-instalacao.js
if errorlevel 1 (
  echo.
  echo [AVISO] A verificacao apontou problemas. O servidor sera
  echo         iniciado mesmo assim; se falhar, veja a mensagem.
  echo.
)

REM 5) Inicia o servidor - janela minimizada, direto com node, sem npm
echo.
echo Iniciando o servidor...
start "Sistema da Biblioteca - servidor" /min cmd /c "node server.js"

REM 6) Aguarda o servidor responder - ate 30 segundos
node -e "const h=require('http');let n=0;const t=setInterval(()=>{const q=h.get('http://127.0.0.1:%PORT%/login.html',r=>{clearInterval(t);process.exit(r.statusCode===200?0:1)});q.on('error',()=>{if(++n>=30){clearInterval(t);process.exit(1)}})},1000)"
if errorlevel 1 (
  echo.
  echo [ERRO] O servidor nao respondeu em 30 segundos.
  echo        Para ver o motivo, abra o Prompt de Comando nesta pasta
  echo        e digite: node server.js
  echo        Depois tente de novo.
  echo.
  pause
  exit /b 1
)
echo Servidor no ar.
echo.

:abrir
REM 7) Melhor endereco: http://biblioteca.localhost na porta 80 (sem ":3000");
REM    senao http://localhost:%PORT%. O navegador resolve "biblioteca.localhost"
REM    para 127.0.0.1 sozinho (RFC 6761): nao precisa de hosts nem de admin
REM    e nunca tenta HTTPS nesse nome. O probe fala com 127.0.0.1:80 porque o
REM    Windows pode nao resolver o nome no DNS; quem responde precisa ser o
REM    nosso sistema - 200 com o titulo do login - senao caimos no fallback.
set "URL=http://localhost:%PORT%"
node -e "const h=require('http');let n=0;const t=setInterval(()=>{const q=h.get({host:'127.0.0.1',port:80,path:'/login.html'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{clearInterval(t);process.exit(r.statusCode===200&&d.indexOf('Sistema da Biblioteca')>=0?0:1)})});q.on('error',()=>{if(++n>=5){clearInterval(t);process.exit(1)}})},400)"
if not errorlevel 1 (
  set "URL=http://biblioteca.localhost"
) else (
  echo [INFO] A porta 80 nao respondeu agora. Abrindo em http://localhost:%PORT%
  echo        Isso e normal se outro programa usa a porta 80. Enquanto isso,
  echo        http://biblioteca.localhost vale quando a porta 80 estiver livre.
  echo.
)

echo Abrindo: %URL%
start "" "%URL%"
echo.
echo Para FECHAR o sistema: duplo clique em ENCERRAR-BIBLIOTECA.bat
echo Fallback tecnico: http://localhost:%PORT%
exit /b 0
