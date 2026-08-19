# Instalador de Abarrotes POS para un local nuevo.
#
# USO: copia toda esta carpeta (AbarrotesPOS) al computador del local nuevo,
# luego abre PowerShell como Administrador dentro de esa carpeta y ejecuta:
#
#   powershell -ExecutionPolicy Bypass -File .\Instalar.ps1
#
# Deja instalado: Node.js, MariaDB, la base de datos vacía con un usuario
# administrador (admin / admin123), el programa arrancando solo al prender
# el computador, un respaldo automático diario, y un acceso directo en el
# escritorio.

$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot

function Requiere-Admin {
  $esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $esAdmin) {
    Write-Host "Este instalador debe correrse como Administrador." -ForegroundColor Red
    Write-Host "Cierra esta ventana, busca PowerShell, clic derecho -> 'Ejecutar como administrador', y vuelve a intentar." -ForegroundColor Red
    exit 1
  }
}
Requiere-Admin

function Generar-Clave($largo = 24) {
  -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $largo | ForEach-Object {[char]$_})
}

# Todo el trabajo real va dentro de este try/catch: si algo falla, la ventana
# se queda abierta mostrando el error en vez de cerrarse sola (eso fue lo que
# pasó la vez que este instalador falló sin dejar rastro de por qué).
try {

Write-Host "=== Instalando Abarrotes POS ===" -ForegroundColor Cyan
Write-Host "Carpeta del programa: $AppDir`n"

# --- 1. Node.js ---
Write-Host "=== 1. Node.js ===" -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "No está instalado. Instalando Node.js LTS..."
  winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  # refrescar PATH de esta sesión sin tener que reabrir la ventana
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
  Write-Host "Ya está instalado ($(node --version))."
}
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $nodeExe)) {
  throw "No se pudo confirmar la instalación de Node.js. Cierra esta ventana, abre una nueva PowerShell como Administrador, y vuelve a correr el instalador."
}

# --- 2. MariaDB ---
Write-Host "`n=== 2. MariaDB ===" -ForegroundColor Cyan
# La clave de root se guarda apenas se genera (ANTES de instalar nada), para
# que nunca se pierda si algo falla a mitad de camino en un paso posterior.
# Así el instalador nunca necesita preguntarle nada a nadie (es desatendido).
$MariaRootKeyDir = Join-Path $env:ProgramData "AbarrotesPOS"
$MariaRootKeyPath = Join-Path $MariaRootKeyDir "mariadb-root.key"

function Instalar-MariaDBLimpio {
  $clave = Generar-Clave 20
  New-Item -ItemType Directory -Force -Path $MariaRootKeyDir | Out-Null
  Set-Content -Path $MariaRootKeyPath -Value $clave -NoNewline -Encoding ascii
  Write-Host "Instalando MariaDB 11.4 LTS..."
  winget install --id MariaDB.Server --version 11.4.3.0 --silent --accept-package-agreements --accept-source-agreements `
    --override "PASSWORD=$clave SERVICENAME=MariaDB PORT=3306 /qn"
  Start-Sleep -Seconds 10
  $svc = Get-Service -Name MariaDB -ErrorAction SilentlyContinue
  if (-not $svc) {
    throw "No se detectó el servicio MariaDB después de instalar. Revisa manualmente."
  }
  return $clave
}

$servicioDB = Get-Service -Name MariaDB -ErrorAction SilentlyContinue
$rootPassword = $null

if (-not $servicioDB) {
  $rootPassword = Instalar-MariaDBLimpio
} elseif (Test-Path $MariaRootKeyPath) {
  Write-Host "Ya está instalado (de una instalación anterior con este mismo instalador)."
  if ($servicioDB.Status -ne 'Running') { Start-Service -Name MariaDB }
  $rootPassword = Get-Content $MariaRootKeyPath -Raw
} else {
  # Hay un servicio MariaDB pero no sabemos su contraseña (instalación previa
  # que falló a mitad de camino, o instalada manualmente). Reinstalar limpio
  # es más seguro y simple que quedar pidiendo una contraseña que nadie tiene.
  Write-Host "Hay MariaDB instalado pero sin contraseña conocida — se reinstala limpio para no quedar bloqueados."
  Stop-Service -Name MariaDB -Force -ErrorAction SilentlyContinue
  $paquete = Get-ItemProperty `
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*", `
    "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "MariaDB*" }
  foreach ($p in $paquete) {
    Start-Process msiexec.exe -ArgumentList "/X $($p.PSChildName) /quiet /norestart" -Wait
  }
  $rootPassword = Instalar-MariaDBLimpio
}

$mysqlExe = (Get-ChildItem "C:\Program Files\MariaDB*\bin\mysql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $mysqlExe) {
  $mysqlExe = (Get-ChildItem "C:\Program Files (x86)\MariaDB*\bin\mysql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $mysqlExe) { throw "No se encontró mysql.exe." }

# --- 3. Base de datos y usuario de la aplicación ---
Write-Host "`n=== 3. Creando la base de datos ===" -ForegroundColor Cyan
$envPath = Join-Path $AppDir ".env"
$appPassword = Generar-Clave 24

if (Test-Path $envPath) {
  Write-Host "Ya existe un archivo .env — se reutiliza la contraseña de la app que ya tenía."
  $appPassword = (Get-Content $envPath | Select-String '^DB_PASSWORD=(.*)$').Matches.Groups[1].Value
  if (-not $appPassword) { $appPassword = Generar-Clave 24 }
}

$sqlSetup = @"
CREATE DATABASE IF NOT EXISTS abarrotes_pos CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'abarrotes_app'@'localhost' IDENTIFIED BY '$appPassword';
ALTER USER 'abarrotes_app'@'localhost' IDENTIFIED BY '$appPassword';
GRANT ALL PRIVILEGES ON abarrotes_pos.* TO 'abarrotes_app'@'localhost';
FLUSH PRIVILEGES;
"@
$sqlSetup | & $mysqlExe -u root "-p$rootPassword"
Write-Host "Base de datos y usuario listos."

Write-Host "Aplicando estructura de tablas..."
Get-Content (Join-Path $AppDir "src\db\schema.sql") | & $mysqlExe -u root "-p$rootPassword"
Write-Host "Estructura aplicada."

# --- 4. Archivo .env ---
Write-Host "`n=== 4. Configurando .env ===" -ForegroundColor Cyan
$sessionSecret = Generar-Clave 40
@"
APP_MODE=local

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=abarrotes_app
DB_PASSWORD=$appPassword
DB_NAME=abarrotes_pos

SESSION_SECRET=$sessionSecret

PORT=4001
"@ | Set-Content -Path $envPath -Encoding utf8
Write-Host ".env creado."

# --- 5. Dependencias de Node ---
Write-Host "`n=== 5. Instalando dependencias (puede tardar unos minutos) ===" -ForegroundColor Cyan
Push-Location $AppDir
& "$($nodeExe | Split-Path)\npm.cmd" install --omit=dev
Pop-Location

# --- 6. Usuario administrador ---
Write-Host "`n=== 6. Creando usuario administrador ===" -ForegroundColor Cyan
$seedScript = @'
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./src/db/pool");
(async () => {
  const hash = bcrypt.hashSync("admin123", 10);
  // ON DUPLICATE KEY solo toca "nombre" a proposito: si la cuenta admin ya
  // existe (se esta reinstalando o actualizando), NO se pisa la contraseña
  // que ya le hayan puesto — solo se crea con admin123 la primerisima vez.
  await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Administrador', 'admin', ?, 'admin')
     ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)`,
    [hash]
  );
  console.log("Usuario admin listo.");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
'@
$seedPath = Join-Path $AppDir "_seed_temp.js"
Set-Content -Path $seedPath -Value $seedScript -Encoding utf8
Push-Location $AppDir
& $nodeExe $seedPath
Pop-Location
Remove-Item $seedPath -Force

# --- 7. Arranque automático al iniciar sesión ---
# Arranca el servidor y abre el programa en su propia ventana (sin barra de
# direcciones ni pestañas), para que se sienta como un programa normal.
Write-Host "`n=== 7. Configurando arranque automático ===" -ForegroundColor Cyan
$tareaArranque = "AbarrotesPOS-Servidor"
Unregister-ScheduledTask -TaskName $tareaArranque -Confirm:$false -ErrorAction SilentlyContinue
$accionArranque = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AppDir\scripts\iniciar-app.ps1`"" -WorkingDirectory $AppDir
$disparadorArranque = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$configArranque = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName $tareaArranque -Action $accionArranque -Trigger $disparadorArranque -Principal $principal -Settings $configArranque -Description "Inicia Abarrotes POS al iniciar sesión" -Force | Out-Null
Write-Host "Programado para iniciar solo la próxima vez que se inicie sesión en Windows."

# --- 8. Respaldo automático diario ---
Write-Host "`n=== 8. Configurando respaldo diario ===" -ForegroundColor Cyan
$tareaBackup = "AbarrotesPOS-BackupDiario"
Unregister-ScheduledTask -TaskName $tareaBackup -Confirm:$false -ErrorAction SilentlyContinue
$accionBackup = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$AppDir\scripts\backup.js`"" -WorkingDirectory $AppDir
$disparadorBackup = New-ScheduledTaskTrigger -Daily -At 23:30
$configBackup = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskName $tareaBackup -Action $accionBackup -Trigger $disparadorBackup -Settings $configBackup -Description "Respaldo diario de la base de datos de Abarrotes POS" -Force | Out-Null
Write-Host "Respaldo programado todas las noches a las 23:30."

# --- 8b. Permitir conexiones desde otros puestos en la misma red local ---
Write-Host "`n=== 8b. Habilitando acceso desde otros puestos en la red ===" -ForegroundColor Cyan
$reglaFirewall = "AbarrotesPOS-Puerto4001"
if (-not (Get-NetFirewallRule -DisplayName $reglaFirewall -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $reglaFirewall -Direction Inbound -Protocol TCP -LocalPort 4001 -Action Allow | Out-Null
}
Write-Host "Puerto 4001 habilitado en el firewall. Otros computadores de la misma red ya pueden conectarse."

# --- 9. Acceso directo en el escritorio ---
# Apunta al lanzador (scripts\iniciar-app.ps1), que arranca el servidor si
# hace falta y abre el programa en su propia ventana — no directo a la URL,
# para que no se abra como una pestaña más de Chrome.
Write-Host "`n=== 9. Creando acceso directo ===" -ForegroundColor Cyan
$escritorio = [Environment]::GetFolderPath("Desktop")
$rutaAcceso = Join-Path $escritorio "Abarrotes POS.lnk"
$shell = New-Object -ComObject WScript.Shell
$acceso = $shell.CreateShortcut($rutaAcceso)
$acceso.TargetPath = "powershell.exe"
$acceso.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AppDir\scripts\iniciar-app.ps1`""
$acceso.WorkingDirectory = $AppDir
$acceso.IconLocation = "$AppDir\src\public\img\icon.ico"
$acceso.Save()
Write-Host "Acceso directo creado en el escritorio."

# --- 10. Arrancar ahora ---
Write-Host "`n=== 10. Iniciando el programa ===" -ForegroundColor Cyan
powershell.exe -ExecutionPolicy Bypass -File "$AppDir\scripts\iniciar-app.ps1"

Write-Host "`n=== Instalación terminada ===" -ForegroundColor Green
Write-Host "Usuario: admin"
Write-Host "Contraseña: admin123  (cámbiala apenas entres, en Usuarios -> Restablecer contraseña)"
if ($rootPassword) {
  Write-Host "Contraseña de root de MariaDB (guárdala aparte, casi nunca se necesita): $rootPassword"
}
Write-Host "El programa va a abrirse solo la próxima vez que se prenda este computador."
Write-Host "Los respaldos quedan en: $AppDir\backups"

$ipLocal = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1 -ExpandProperty IPAddress)
if ($ipLocal) {
  Write-Host "`nPara usar otros puestos/cajas conectados a este mismo computador, en cada uno abre un navegador y entra a:" -ForegroundColor Cyan
  Write-Host "  http://${ipLocal}:4001" -ForegroundColor Green
  Write-Host "(Los dos computadores deben estar en la misma red WiFi o cable. Si esta IP cambia con el tiempo, conviene fijarla en el router.)"
}

} catch {
  Write-Host "`n`n=== LA INSTALACIÓN FALLÓ ===" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "`nDetalle técnico:" -ForegroundColor DarkGray
  Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkGray
  Write-Host "`nManda una captura de todo este mensaje para que se pueda corregir." -ForegroundColor Yellow
  Write-Host "Esta ventana se va a cerrar sola en 60 segundos (o cierra cuando quieras, ya se leyó el error)." -ForegroundColor Yellow
  Start-Sleep -Seconds 60
  exit 1
}

Start-Sleep -Seconds 5
