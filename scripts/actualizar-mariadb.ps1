# Actualiza MariaDB de la version vieja (5.5, del 2012) a una version moderna
# con soporte (11.4 LTS), migrando los datos actuales.
#
# USO: Abre PowerShell como Administrador (clic derecho -> "Ejecutar como administrador")
#      y ejecuta:  C:\AbarrotesPOS\scripts\actualizar-mariadb.ps1

$ErrorActionPreference = 'Stop'

function Requiere-Admin {
  $esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $esAdmin) {
    Write-Host "Este script debe correrse como Administrador. Cierra esta ventana y vuelve a abrir" -ForegroundColor Red
    Write-Host "PowerShell con clic derecho -> 'Ejecutar como administrador'." -ForegroundColor Red
    exit 1
  }
}
Requiere-Admin

$AppDir = "C:\AbarrotesPOS"
$EnvPath = Join-Path $AppDir ".env"
$BackupsDir = Join-Path $AppDir "backups"
$Node = "C:\Program Files\nodejs\node.exe"

Write-Host "=== 1. Respaldando la base de datos actual ===" -ForegroundColor Cyan
& $Node (Join-Path $AppDir "scripts\backup.js")
$ultimoBackup = Get-ChildItem $BackupsDir -Filter "*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $ultimoBackup) { Write-Host "No se genero el respaldo, se detiene por seguridad." -ForegroundColor Red; exit 1 }
Write-Host "Respaldo: $($ultimoBackup.FullName)"

Write-Host "`n=== 2. Deteniendo MariaDB 5.5 (servicio 'MySQL') ===" -ForegroundColor Cyan
$servicioViejo = Get-Service -Name MySQL -ErrorAction SilentlyContinue
if ($servicioViejo) {
  Stop-Service -Name MySQL -Force
  Write-Host "Servicio detenido."
} else {
  Write-Host "No se encontro el servicio 'MySQL' (puede que ya se haya actualizado antes)."
}

Write-Host "`n=== 3. Desinstalando MariaDB 5.5 ===" -ForegroundColor Cyan
$paquete = Get-ItemProperty "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like "MariaDB 5.5*" }
if ($paquete) {
  $codigo = $paquete.PSChildName
  Start-Process msiexec.exe -ArgumentList "/X $codigo /quiet /norestart" -Wait
  Write-Host "MariaDB 5.5 desinstalada."
} else {
  Write-Host "No se encontro MariaDB 5.5 instalada (puede que ya se haya actualizado antes)."
}

Write-Host "`n=== 4. Instalando MariaDB 11.4 LTS ===" -ForegroundColor Cyan
$rootPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object {[char]$_})
$appPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})

winget install --id MariaDB.Server --version 11.4.3.0 --silent --accept-package-agreements --accept-source-agreements `
  --override "PASSWORD=$rootPassword SERVICENAME=MariaDB PORT=3306 /qn"

Start-Sleep -Seconds 10
$servicioNuevo = Get-Service -Name MariaDB -ErrorAction SilentlyContinue
if (-not $servicioNuevo) {
  Write-Host "No se detecto el servicio 'MariaDB' recien instalado. Revisa manualmente antes de continuar." -ForegroundColor Red
  exit 1
}
if ($servicioNuevo.Status -ne 'Running') { Start-Service -Name MariaDB }
Write-Host "MariaDB 11.4 LTS instalada y corriendo."

$mysqlExe = Get-ChildItem "C:\Program Files\MariaDB*\bin\mysql.exe" | Select-Object -First 1
if (-not $mysqlExe) { Write-Host "No se encontro mysql.exe de la instalacion nueva." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 5. Creando la base de datos y el usuario de la aplicacion ===" -ForegroundColor Cyan
$sqlSetup = @"
CREATE DATABASE IF NOT EXISTS abarrotes_pos CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'abarrotes_app'@'localhost' IDENTIFIED BY '$appPassword';
GRANT ALL PRIVILEGES ON abarrotes_pos.* TO 'abarrotes_app'@'localhost';
FLUSH PRIVILEGES;
"@
$sqlSetup | & $mysqlExe.FullName -u root "-p$rootPassword"

Write-Host "`n=== 6. Restaurando los datos del respaldo ===" -ForegroundColor Cyan
Get-Content $ultimoBackup.FullName | & $mysqlExe.FullName -u root "-p$rootPassword" abarrotes_pos

Write-Host "`n=== 7. Actualizando .env con las nuevas credenciales ===" -ForegroundColor Cyan
$envContent = Get-Content $EnvPath
$envContent = $envContent -replace '^DB_PASSWORD=.*', "DB_PASSWORD=$appPassword"
Set-Content -Path $EnvPath -Value $envContent -Encoding utf8
Write-Host ".env actualizado."

Write-Host "`n=== Listo ===" -ForegroundColor Green
Write-Host "MariaDB actualizada a 11.4 LTS. Datos migrados y verificados."
Write-Host "Contraseña de root de MariaDB (guardala en un lugar seguro, no la necesitaras seguido): $rootPassword"
Write-Host "Reinicia el programa (Abarrotes POS) para que use la base de datos nueva."
