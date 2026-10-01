# scripts/criar-atalho.ps1 — Etapa 13
# Cria o atalho "📚 Sistema da Biblioteca" na Area de Trabalho do usuario.
# Nao precisa de administrador (grava apenas na pasta do proprio usuario).
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$alvo = Join-Path $raiz 'INICIAR-BIBLIOTECA.bat'

if (-not (Test-Path $alvo)) {
  Write-Host "[ERRO] INICIAR-BIBLIOTECA.bat nao encontrado em: $raiz"
  exit 1
}

$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
# Nota: o emoji e um codepoint de 4 bytes (U+1F4DA); [char] nao o segura.
# ConvertFromUtf32 e metodo ESTATICO de System.Char (nao de String) e devolve
# uma String com par de substitutos — funciona no PowerShell 5.1 e no 7.
$emoji = [System.Char]::ConvertFromUtf32(0x1F4DA)
$nome = $emoji + ' Sistema da Biblioteca.lnk'
$caminho = Join-Path $desktop $nome

try {
  $lnk = $ws.CreateShortcut($caminho)
  $lnk.TargetPath = $alvo
  $lnk.WorkingDirectory = $raiz
  $lnk.WindowStyle = 1
  $lnk.Description = 'Sistema da Biblioteca - inicia o servidor e abre o navegador'
  $lnk.Save()
} catch {
  # Fallback: alguns Windows recusam emoji no nome do .lnk — grava sem emoji.
  $nome = 'Sistema da Biblioteca.lnk'
  $caminho = Join-Path $desktop $nome
  try {
    $lnk = $ws.CreateShortcut($caminho)
    $lnk.TargetPath = $alvo
    $lnk.WorkingDirectory = $raiz
    $lnk.WindowStyle = 1
    $lnk.Description = 'Sistema da Biblioteca - inicia o servidor e abre o navegador'
    $lnk.Save()
  } catch {
    Write-Host "[ERRO] Nao foi possivel criar o atalho: $($_.Exception.Message)"
    exit 1
  }
}

if (-not (Test-Path $caminho)) {
  Write-Host '[ERRO] O arquivo do atalho nao foi gravado.'
  exit 1
}

Write-Host "[OK] Atalho criado na Area de Trabalho: $nome"
Write-Host '     Duplo clique = servidor + navegador (http://biblioteca.localhost).'
exit 0
