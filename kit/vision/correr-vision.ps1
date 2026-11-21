# Banco de visión con Nemotron VL. La clave se pide en esta ventana, vive solo en este proceso
# y se borra al terminar (igual que eficiencia\correr-bucle.ps1). Imágenes 100 % sintéticas.
Set-Location -LiteralPath $PSScriptRoot
Write-Host ''
Write-Host 'Banco de vision (6 imagenes sinteticas x 3 repeticiones = 18 llamadas a NVIDIA).' -ForegroundColor Cyan
$segura = Read-Host -AsSecureString 'Pega tu clave de NVIDIA y presiona Enter (no se mostrara)'
$env:NVIDIA_API_KEY = [System.Net.NetworkCredential]::new('', $segura).Password
try {
  & node .\correr-vision.mjs @args 2>&1 | ForEach-Object { Write-Host ("$_" -replace 'nvapi-[\w-]+', 'nvapi-***') }
} finally {
  Remove-Item Env:NVIDIA_API_KEY -ErrorAction SilentlyContinue
  $segura.Dispose()
}
Write-Host ''
Write-Host 'Listo. La clave ya se borro de esta ventana. Puedes cerrarla.' -ForegroundColor Green
