# Instalador de IA Lab Abierto (Windows). No guarda claves y pregunta antes de instalar algo.
$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Falta Node.js 24 o posterior: https://nodejs.org' }
$mayor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($mayor -lt 24) { throw "Node $mayor es muy antiguo. Instala Node 24 o posterior." }
Write-Host "Node $(node --version) OK"

# 1. Archivos locales que nunca van a Git
$envFile = Join-Path $raiz '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $raiz '.env.example') $envFile; Write-Host '.env creado (vacío).' }
$temas = Join-Path $raiz 'config\temas-privados.txt'
if (-not (Test-Path $temas)) {
  Copy-Item (Join-Path $raiz 'config\temas-privados.ejemplo.txt') $temas
  Write-Host 'Escribe en config\temas-privados.txt los temas que nunca deben ir al modelo gratuito.' -ForegroundColor Yellow
}
$prohibidas = Join-Path $raiz 'config\carpetas-prohibidas.txt'
if (-not (Test-Path $prohibidas)) {
  Copy-Item (Join-Path $raiz 'config\carpetas-prohibidas.ejemplo.txt') $prohibidas
  Write-Host 'Escribe en config\carpetas-prohibidas.txt las carpetas que la herramienta de Claude nunca debe leer.' -ForegroundColor Yellow
}

# 2. Headroom (opcional)
$headroom = Read-Host '¿Instalar Headroom para comprimir entradas largas? Requiere Python 3.12 (s/N)'
if ($headroom -eq 's') {
  if (-not (Get-Command py -ErrorAction SilentlyContinue)) { Write-Warning 'No hay Python. Se omite Headroom; el panel funciona sin él.' }
  else {
    py -3.12 -m venv (Join-Path $raiz '.venv')
    $env:HEADROOM_OFFLINE = '1'
    & (Join-Path $raiz '.venv\Scripts\pip.exe') install 'headroom-ai==0.44.0'
  }
}

# 3. Codex (opcional): la herramienta NVIDIA solo existe cuando Codex abre esta carpeta
$codex = Read-Host '¿Conectar Codex con el panel en esta carpeta? (s/N)'
if ($codex -eq 's') {
  $dir = Join-Path $raiz '.codex'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  (Get-Content (Join-Path $raiz 'codex\config.toml.ejemplo') -Raw).Replace('<RUTA_DEL_REPO>', $raiz) |
    Set-Content (Join-Path $dir 'config.toml') -Encoding UTF8
  Write-Host 'Listo: abre Codex en esta carpeta y habilítalo en el panel (Código → Conectar con Codex).'
}

# 4. Pruebas locales (sin red ni claves)
node --test "panel/*.test.mjs" "eficiencia/prueba/*.test.mjs" "kit/*.test.mjs" "kit/vision/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Alguna prueba falló. No sigas hasta verla en verde.' }

# 4b. Ahorro en la app de escritorio de Claude (opcional): kit\LEEME.md
$claude = Read-Host '¿Conectar la herramienta de ahorro a la app de escritorio de Claude? Ciérrala antes (s/N)'
if ($claude -eq 's') {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $raiz 'kit\conectar-claude.ps1')
  $regla = (Get-Content (Join-Path $raiz 'kit\INSTRUCCION-CLAUDE.md') -Raw -Encoding UTF8)
  $bloque = [regex]::Match($regla, '(?s)```text\r?\n(.*?)```').Groups[1].Value.Replace('<RAIZ>', $raiz)
  Write-Host "`nPega esto en Claude > Configuración > General > Preferencias personales (refuerza la regla):`n" -ForegroundColor Cyan
  Write-Host $bloque
}

# 5. Acceso directo en el escritorio
$acceso = Join-Path ([Environment]::GetFolderPath('Desktop')) 'IA Lab Abierto.lnk'
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($acceso)
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = '"' + (Join-Path $raiz 'panel\Abrir-Panel.vbs') + '"'
$lnk.WorkingDirectory = $raiz
$lnk.Save()
Write-Host 'Listo. Abre el panel con el acceso directo "IA Lab Abierto" del escritorio.' -ForegroundColor Green
