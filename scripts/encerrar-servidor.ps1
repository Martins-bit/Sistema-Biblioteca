# scripts/encerrar-servidor.ps1 — Etapa 13
# Encerra APENAS o servidor do Sistema da Biblioteca, identificado pelo
# arquivo .servidor.pid gravado pelo server.js. Nunca mata "todo node.exe".
$raiz = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $raiz '.servidor.pid'

if (-not (Test-Path $pidFile)) {
  Write-Host '[OK] Nenhum servidor do Sistema da Biblioteca estava ativo.'
  exit 0
}

$alvo = 0
try { $alvo = [int](Get-Content -Raw $pidFile).Trim() } catch { $alvo = 0 }
if ($alvo -le 0) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host '[OK] Arquivo de controle invalido removido. Nada a encerrar.'
  exit 0
}

$proc = Get-CimInstance Win32_Process -Filter "ProcessId = $alvo" -ErrorAction SilentlyContinue
if (-not $proc) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "[OK] O servidor nao estava mais rodando (PID $alvo ja encerrado)."
  exit 0
}

# Seguranca dupla: so encerra se for node.exe, com "server.js" na linha de
# comando E escutando numa porta conhecida do sistema (80/3000/3001).
$eNosso = ($proc.Name -eq 'node.exe') -and ($proc.CommandLine -match 'server\.js')
$portaConhecida = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -eq $alvo -and ($_.LocalPort -in 80,3000,3001) }

if (-not $eNosso -or -not $portaConhecida) {
  Write-Host "[AVISO] O PID $alvo nao parece ser o servidor do Sistema da Biblioteca."
  Write-Host '        Nada foi encerrado. Se a janela do servidor estiver aberta,'
  Write-Host '        feche-a com Ctrl+C dentro dela ou pelo X da janela.'
  exit 1
}

Stop-Process -Id $alvo -Force -ErrorAction Stop
Start-Sleep -Milliseconds 600
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "[OK] Sistema da Biblioteca encerrado (PID $alvo). Todos os dados ja estavam salvos no banco."
exit 0
