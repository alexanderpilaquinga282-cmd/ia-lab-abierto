# Diagnóstico de por qué Claude no carga ia_lab_ahorro. Solo LEE; no cambia nada.
# Muestra solo la sección mcpServers de cada config y las líneas de los logs que hablan de MCP,
# con cualquier cosa parecida a una clave tapada.
$ErrorActionPreference = 'Continue'
$tapar = { param($t) $t -replace 'nvapi-[\w-]+', 'nvapi-***' -replace 'sk-[\w-]{10,}', 'sk-***' -replace '(?i)(token|key|secret)(["'':= ]+)[^"''\s,]+', '$1$2***' }
$lugares = @(Join-Path $env:APPDATA 'Claude')
$lugares += @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'LocalCache\Roaming\Claude' })
$lugares += @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Claude-Data') -Directory -Filter 'claude_*' -ErrorAction SilentlyContinue | ForEach-Object FullName)
Write-Host "== Procesos de Claude abiertos: $(@(Get-Process -Name Claude -ErrorAction SilentlyContinue).Count)"
foreach ($l in $lugares) {
  Write-Host "`n== Carpeta: $l  (existe: $(Test-Path -LiteralPath $l))"
  if (-not (Test-Path -LiteralPath $l)) { continue }
  $cfg = Join-Path $l 'claude_desktop_config.json'
  if (Test-Path -LiteralPath $cfg) {
    $info = Get-Item -LiteralPath $cfg
    Write-Host "config: $($info.Length) bytes, modificada $($info.LastWriteTime)"
    try {
      $j = Get-Content -LiteralPath $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
      Write-Host ('claves de primer nivel: ' + (($j.PSObject.Properties | ForEach-Object Name) -join ', '))
      Write-Host ('mcpServers: ' + (& $tapar ($j.mcpServers | ConvertTo-Json -Depth 6 -Compress)))
    } catch { Write-Host "JSON INVALIDO: $($_.Exception.Message)" -ForegroundColor Red }
  } else { Write-Host 'config: no existe' }
  $logs = Join-Path $l 'logs'
  if (Test-Path -LiteralPath $logs) {
    Write-Host '-- logs mas recientes:'
    Get-ChildItem -LiteralPath $logs -File | Sort-Object LastWriteTime -Descending | Select-Object -First 6 | ForEach-Object { Write-Host "   $($_.Name)  $($_.LastWriteTime)" }
    $lineas = Get-ChildItem -LiteralPath $logs -File -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 4 |
      ForEach-Object { Get-Content -LiteralPath $_.FullName -Tail 400 -ErrorAction SilentlyContinue | Select-String -Pattern 'ia_lab_ahorro|mcpServers|claude_desktop_config|MCP|mcp' | ForEach-Object { "[$($_.Filename)] $($_.Line)" } }
    Write-Host '-- lineas de MCP en los logs (ultimas 40):'
    $lineas | Select-Object -Last 40 | ForEach-Object { Write-Host ('   ' + (& $tapar $_)) }
  } else { Write-Host '-- sin carpeta logs' }
}
