# Descarga la ultima version de Abarrotes POS desde GitHub y corre el
# instalador. Pensado para ejecutarse ya con permisos de Administrador
# (Instalar.bat se encarga de eso antes de llegar aqui).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoZip = "https://github.com/julioguillermovera1-glitch/abarrotes-pos/archive/refs/heads/master.zip"
$Destino = "C:\AbarrotesPOS"

Write-Host "=== Descargando Abarrotes POS ===" -ForegroundColor Cyan
$zipTemp = Join-Path $env:TEMP "abarrotes-pos-$(Get-Random).zip"
$extraerTemp = Join-Path $env:TEMP "abarrotes-pos-extraido-$(Get-Random)"

Invoke-WebRequest -Uri $RepoZip -OutFile $zipTemp
Expand-Archive -Path $zipTemp -DestinationPath $extraerTemp -Force
$carpetaFuente = (Get-ChildItem $extraerTemp -Directory | Select-Object -First 1).FullName

# Copia todo lo descargado sobre el destino. No borra nada que ya exista ahí
# (como un .env, backups o node_modules de una instalación anterior), solo
# agrega/actualiza los archivos del programa.
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
Copy-Item "$carpetaFuente\*" $Destino -Recurse -Force

Remove-Item $zipTemp -Force -ErrorAction SilentlyContinue
Remove-Item $extraerTemp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Descarga lista.`n" -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Destino "Instalar.ps1")
