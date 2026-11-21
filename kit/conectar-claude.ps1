# Conecta la herramienta ia_lab_ahorro a la app de escritorio de Claude.
# Hace respaldo de la configuración actual, agrega SOLO la entrada ia_lab_ahorro y no toca nada más.
# Para quitarla: .\conectar-claude.ps1 -Quitar
param([switch] $Quitar)
$ErrorActionPreference = 'Stop'
# Dónde guarda Claude su config: instalador normal = %APPDATA%\Claude; Microsoft Store (MSIX) =
# %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude o %LOCALAPPDATA%\Claude-Data\claude_*.
# Se escribe en todas las que existan (el resto se ignora).
$carpetas = @()
$normal = Join-Path $env:APPDATA 'Claude'
if (Test-Path -LiteralPath $normal) { $carpetas += $normal }
$paquetes = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue)
foreach ($p in $paquetes) {
  $c = Join-Path $p.FullName 'LocalCache\Roaming\Claude'
  if (-not (Test-Path -LiteralPath $c)) { New-Item -ItemType Directory -Path $c -Force | Out-Null }
  $carpetas += $c
}
# Versión actual de la Store (vista el 20/11/2026): %LOCALAPPDATA%\Claude-Data\claude_<id>.
# Es la carpeta que abre Configuración > Desarrollador > Editar configuración.
$datos = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Claude-Data') -Directory -Filter 'claude_*' -ErrorAction SilentlyContinue)
foreach ($d in $datos) { $carpetas += $d.FullName }
if (-not $carpetas) {
  throw "No encuentro la configuracion de Claude ni en $normal ni en $env:LOCALAPPDATA\Packages\Claude_* ni en $env:LOCALAPPDATA\Claude-Data\claude_*. Abre Claude una vez y vuelve a correr esto."
}
$servidor = Join-Path $PSScriptRoot 'ahorro-mcp.mjs'
# Sin fronteras locales el servidor se niega a arrancar (código 4). Mejor avisarlo aquí.
$raizTaller = if ($env:IA_LAB_RAIZ) { $env:IA_LAB_RAIZ } else { Split-Path -Parent $PSScriptRoot }
$prohibidas = Join-Path $raizTaller 'config\carpetas-prohibidas.txt'
if (-not $Quitar -and -not (Test-Path -LiteralPath $prohibidas)) {
  throw "Falta $prohibidas. Copia config\carpetas-prohibidas.ejemplo.txt con ese nombre, escribe tus carpetas privadas y vuelve a correr esto."
}
$node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

# Prueba 1: el servidor arranca y responde con sus 3 herramientas (sin red, sin clave).
if (-not $Quitar) {
  $pedido = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' + "`n" + '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  Push-Location $PSScriptRoot
  # Solo stdout: en PowerShell 5.1 con 'Stop', cualquier aviso de node por stderr cortaria el script.
  try { $respuesta = ($pedido | & $node $servidor | Out-String) } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "PRUEBA 1 FALLO: node termino con codigo $LASTEXITCODE." }
  foreach ($h in 'calcular_con_codigo', 'leer_con_nemotron', 'estado_ahorro') {
    if ($respuesta -notmatch $h) { throw "PRUEBA 1 FALLO: el servidor no respondio bien. Salida:`n$respuesta" }
  }
  Write-Host "OK 1/3: el servidor arranca con node ($node) y ofrece sus 3 herramientas." -ForegroundColor Green
}

# Prueba 2: config-claude.mjs fusiona con JSON de Node (no toca otros ajustes), hace respaldo y relee.
$ayudante = Join-Path $PSScriptRoot 'config-claude.mjs'
foreach ($carpeta in $carpetas) {
  $config = Join-Path $carpeta 'claude_desktop_config.json'
  $argumentos = @($ayudante, $config, $node, $servidor)
  if ($Quitar) { $argumentos += '--quitar' }
  & $node @argumentos
  if ($LASTEXITCODE -ne 0) { throw "PRUEBA 2 FALLO en $config (codigo $LASTEXITCODE). No se cambio nada mas." }
  Write-Host "OK 2/3: $config" -ForegroundColor Green
}
if (-not $Quitar) {
  $abierto = @(Get-Process -Name 'Claude' -ErrorAction SilentlyContinue)
  if ($abierto) {
    Write-Host "AVISO 3/3: Claude sigue abierto ($($abierto.Count) procesos). Cierralo desde la bandeja (clic derecho en el icono > Salir) y vuelve a abrirlo." -ForegroundColor Yellow
  } else {
    Write-Host 'OK 3/3: Claude esta cerrado. Abrelo ahora.' -ForegroundColor Green
  }
}
