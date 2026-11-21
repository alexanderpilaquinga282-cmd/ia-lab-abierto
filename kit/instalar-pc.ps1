# Instala el kit de ahorro en este PC y lo conecta a Codex, sin preguntas (Windows puede pedir permiso
# de administrador si falta Node). Requiere Git (lo usaste para clonar). No pide ni guarda la clave NVIDIA.
# Deja un informe con solo números en <raíz>\.local\instalacion.txt.
# Uso: powershell -ExecutionPolicy Bypass -File kit\instalar-pc.ps1 [-SinCodex] [-Informe <ruta extra>] [-TemasPrivados 'Tema 1','Tema 2']
param([switch]$SinCodex, [string]$Informe = '', [string[]]$TemasPrivados = @())
# 'Continue': en PowerShell 5.1, 'Stop' convierte cualquier línea de stderr de node/git en error fatal.
# Los fallos reales se detectan con $LASTEXITCODE y throw explícitos.
$ErrorActionPreference = 'Continue'
$kit = $PSScriptRoot
$raiz = Split-Path $kit -Parent
$local = Join-Path $raiz '.local'
New-Item -ItemType Directory -Force -Path $local | Out-Null
$salida = Join-Path $local 'instalacion.txt'
$lineas = New-Object System.Collections.Generic.List[string]
function Anotar([string]$t, [string]$color = 'Gray') { Write-Host $t -ForegroundColor $color; $lineas.Add($t) }
function Guardar {
  $texto = ($lineas -join "`r`n") -replace 'nvapi-[\w-]+', 'nvapi-***'
  Set-Content -Path $salida -Value $texto -Encoding UTF8
  if ($Informe) { Set-Content -Path $Informe -Value $texto -Encoding UTF8 }
}
function RefrescarPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

Anotar "IA Lab - instalación del kit de ahorro $(Get-Date -Format 'yyyy-MM-dd HH:mm') en $env:COMPUTERNAME" 'Cyan'
Anotar "Raíz del taller: $raiz"

try {
  # 1. Node 24+
  $node = Get-Command node -ErrorAction SilentlyContinue
  $mayor = if ($node) { [int]((& node --version).TrimStart('v').Split('.')[0]) } else { 0 }
  if ($mayor -lt 24) {
    Anotar "Node $(if ($node) { & node --version } else { 'no instalado' }): instalo Node LTS con winget (Windows puede pedir permiso)." 'Yellow'
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent | Out-Null
    RefrescarPath
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'winget no dejó Node en el PATH. Instálalo desde https://nodejs.org y vuelve a correr esto.' }
    $mayor = [int]((& node --version).TrimStart('v').Split('.')[0])
    if ($mayor -lt 24) { throw "Quedó Node $mayor; hace falta 24 o más." }
  }
  $nodeExe = (Get-Command node).Source
  Anotar "1. Node $(& node --version) OK ($nodeExe)" 'Green'

  # 2. Config privada (fuera de Git)
  $conf = Join-Path $raiz 'config'
  foreach ($par in @(@('carpetas-prohibidas', @('~\.ssh', '~\.codex', '~\.aws', '%APPDATA%\Microsoft\Credentials', '~\AppData', '~\Documents', '~\Desktop', '~\Downloads', '~\OneDrive')),
                     @('temas-privados', $TemasPrivados))) {
    $archivo = Join-Path $conf "$($par[0]).txt"
    if (-not (Test-Path $archivo)) {
      $ejemplo = Get-Content (Join-Path $conf "$($par[0]).ejemplo.txt") -Encoding UTF8 -ErrorAction Stop | Where-Object { $_ -match '^\s*#' }
      Set-Content -Path $archivo -Value (@($ejemplo) + @($par[1])) -Encoding UTF8 -ErrorAction Stop
      Anotar "2. Creado config\$($par[0]).txt con $($par[1].Count) entradas (edítalo a tu gusto)."
    } else { Anotar "2. config\$($par[0]).txt ya existía: no lo toco." }
  }
  Push-Location $raiz
  $ignorados = (git check-ignore config/carpetas-prohibidas.txt config/temas-privados.txt .local 2>$null | Measure-Object).Count
  Pop-Location
  if ($ignorados -lt 3) { throw "La config privada no está ignorada por Git ($ignorados de 3)." }
  Anotar '2. Config privada fuera de Git (3 de 3 ignorados) OK' 'Green'

  # 3. Pruebas del kit (solo dentro de kit\)
  Push-Location $kit
  $t = & node --test 2>&1 | Out-String
  Pop-Location
  $pass = [regex]::Match($t, '# pass (\d+)').Groups[1].Value
  $fail = [regex]::Match($t, '# fail (\d+)').Groups[1].Value
  $skip = [regex]::Match($t, '# skipped (\d+)').Groups[1].Value
  Anotar "3. Pruebas del kit: $pass pasan, $fail fallan, $skip omitidas" $(if ($fail -eq '0') { 'Green' } else { 'Red' })
  if ($fail -ne '0') { ([regex]::Matches($t, '(?m)^not ok .*$') | ForEach-Object { Anotar "   $($_.Value)" 'Red' }); throw 'Hay pruebas en rojo.' }

  # 4. Medición: banco sin red y prueba en vivo del servidor
  Push-Location $kit
  $banco = & node codigo-primero.mjs 2>&1 | Out-String
  Pop-Location
  ($banco -split "`r?`n" | Where-Object { $_ -match 'TOTAL|ahorro pagado' }) | ForEach-Object { Anotar "4. Banco: $_" }
  $vivo = & node (Join-Path $kit 'probar-en-vivo.mjs') | Out-String
  if ($LASTEXITCODE -ne 0) { Anotar $vivo 'Red'; throw 'La prueba en vivo del servidor falló.' }
  $v = $vivo | ConvertFrom-Json
  foreach ($c in $v.casos) { Anotar "4. En vivo $($c.archivo): $(($c.respuesta | ConvertTo-Json -Compress)) ok=$($c.ok) | archivo entero $($c.tokensArchivo) tokens vs pagados $($c.tokensPagados) = -$($c.ahorro)" 'Green' }
  Anotar "4. Bloquea config privada: $($v.bloqueaConfigPrivada) | rechaza contar en Nemotron: $($v.rechazaContarEnNemotron)" 'Green'

  # 5. Codex: tabla MCP + regla en AGENTS.md, con respaldo
  if (-not $SinCodex) {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $rTexto = & node (Join-Path $kit 'config-codex.mjs') $codexHome $raiz | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'No pude escribir la config de Codex.' }
    $r = $rTexto | ConvertFrom-Json
    Anotar "5. Codex conectado: [mcp_servers.ia_lab_ahorro] en $($r.toml) y regla en $($r.agents)" 'Green'
    foreach ($b in $r.respaldos) { Anotar "   respaldo: $b" }
    $codex = Get-Command codex -ErrorAction SilentlyContinue
    if ($codex) {
      $lista = & codex mcp list 2>&1 | Out-String
      Anotar "5. codex mcp list ve ia_lab_ahorro: $($lista -match 'ia_lab_ahorro')"
    } else { Anotar '5. No hay CLI "codex" en PATH; la app de Codex lee la misma config al reiniciarla.' 'Yellow' }
    # Panel NVIDIA para Codex, solo dentro de esta carpeta (lo que hace instalar.ps1)
    $dir = Join-Path $raiz '.codex'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    (Get-Content (Join-Path $raiz 'codex\config.toml.ejemplo') -Raw).Replace('<RUTA_DEL_REPO>', $raiz) | Set-Content (Join-Path $dir 'config.toml') -Encoding UTF8
    Anotar '5. Panel NVIDIA enlazado a Codex en esta carpeta (.codex\config.toml local)'
  }

  # 6. Acceso directo al panel
  $acceso = Join-Path ([Environment]::GetFolderPath('Desktop')) 'IA Lab Abierto.lnk'
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($acceso)
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = '"' + (Join-Path $raiz 'panel\Abrir-Panel.vbs') + '"'
  $lnk.WorkingDirectory = $raiz
  $lnk.Save()
  Anotar "6. Acceso directo del panel: $acceso" 'Green'

  # 7. Escaneo de secretos y estado de Git
  Push-Location $raiz
  $scan = & node scripts\escanear-secretos.mjs 2>&1 | Out-String
  $sucios = (git status --porcelain | Measure-Object).Count
  Pop-Location
  # config\ y .codex\ son tuyos y Git los ignora: ahí SÍ deben estar tus temas y rutas.
  $hallazgos = @($scan -split "`r?`n" | Where-Object { $_ -match ':\d+\s' -and $_ -notmatch '^(config|\.codex)[\\/]' })
  Anotar "7. Escaneo de secretos en lo que viaja a Git: $($hallazgos.Count) hallazgos" $(if ($hallazgos.Count) { 'Red' } else { 'Green' })
  $hallazgos | ForEach-Object { Anotar "   $_" 'Red' }
  Anotar "7. Archivos con cambios sin ignorar en Git: $sucios"
  Anotar 'LISTO. Falta solo lo de tus manos: ver kit\LEEME.md, sección "PC nuevo con Codex".' 'Cyan'
} catch {
  Anotar "FALLÓ: $($_.Exception.Message)" 'Red'
  Guardar
  exit 1
}
Guardar
