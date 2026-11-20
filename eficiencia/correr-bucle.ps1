# Corre el bucle de mejora (mejorar.mjs) pidiendo la clave de NVIDIA en esta ventana.
# La clave vive solo en este proceso: no se guarda en disco, no se imprime y se
# borra al terminar. La salida queda en bucle\ultima-corrida.log (sin la clave).
Set-Location -LiteralPath $PSScriptRoot
$carpeta = Join-Path $PSScriptRoot 'bucle'
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
$log = Join-Path $carpeta 'ultima-corrida.log'
Set-Content -Path $log -Value ("inicio: " + (Get-Date -Format s)) -Encoding UTF8

Write-Host ''
Write-Host 'Bucle de mejora de skills (solo datos sinteticos).' -ForegroundColor Cyan
$segura = Read-Host -AsSecureString 'Pega tu clave de NVIDIA y presiona Enter (no se mostrara)'
$env:NVIDIA_API_KEY = [System.Net.NetworkCredential]::new('', $segura).Password
try {
  & node .\mejorar.mjs @args 2>&1 | ForEach-Object {
    $linea = "$_" -replace 'nvapi-[\w-]+', 'nvapi-***'
    Write-Host $linea
    Add-Content -Path $log -Value $linea -Encoding UTF8
  }
  Add-Content -Path $log -Value ("codigo de salida: $LASTEXITCODE") -Encoding UTF8
} finally {
  Remove-Item Env:NVIDIA_API_KEY -ErrorAction SilentlyContinue
  $segura.Dispose()
}
Add-Content -Path $log -Value ("fin: " + (Get-Date -Format s)) -Encoding UTF8

Write-Host ''
Write-Host 'Listo. La clave ya se borro de esta ventana. Puedes cerrarla.' -ForegroundColor Green
