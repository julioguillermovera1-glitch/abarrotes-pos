# Restaura la base de datos desde uno de los respaldos guardados en la
# carpeta "backups" (se genera uno automáticamente todas las noches y al
# prender el computador). Uso pensado para cuando el programa quedó dañado
# de verdad y hay que volver a un punto anterior.
#
# Es una herramienta manual a propósito: restaurar un respaldo reemplaza
# TODOS los datos actuales (ventas, inventario, clientes) por los del
# respaldo elegido. Si esto se hiciera solo, automáticamente, ante
# cualquier falla pasajera, se podría borrar ventas reales sin que nadie
# se diera cuenta — por eso pide confirmación explícita.
#
# USO: powershell -ExecutionPolicy Bypass -File .\scripts\restaurar-respaldo.ps1

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $AppDir "backups"

if (-not (Test-Path $BackupDir)) {
  Write-Host "No existe la carpeta de respaldos ($BackupDir)." -ForegroundColor Red
  exit 1
}

$respaldos = Get-ChildItem $BackupDir -Filter "*.sql" | Sort-Object LastWriteTime -Descending
if ($respaldos.Count -eq 0) {
  Write-Host "No hay ningún respaldo guardado todavía." -ForegroundColor Red
  exit 1
}

Write-Host "=== Respaldos disponibles (el más nuevo primero) ===" -ForegroundColor Cyan
for ($i = 0; $i -lt $respaldos.Count; $i++) {
  $r = $respaldos[$i]
  Write-Host ("  [{0}] {1}   ({2} KB, {3})" -f $i, $r.Name, [math]::Round($r.Length / 1KB), $r.LastWriteTime)
}

$sel = Read-Host "`nEscribe el número del respaldo a restaurar (Enter para cancelar)"
if ([string]::IsNullOrWhiteSpace($sel)) { Write-Host "Cancelado."; exit 0 }
$idx = 0
if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 0 -or $idx -ge $respaldos.Count) {
  Write-Host "Número inválido." -ForegroundColor Red
  exit 1
}
$elegido = $respaldos[$idx]

Write-Host "`nADVERTENCIA: esto va a REEMPLAZAR todos los datos actuales (ventas, inventario, clientes, etc.)" -ForegroundColor Yellow
Write-Host "por los del respaldo '$($elegido.Name)' (de $($elegido.LastWriteTime)). Todo lo vendido después de esa fecha se perderá." -ForegroundColor Yellow
$confirmar = Read-Host "`nEscribe SI (en mayúsculas) para continuar"
if ($confirmar -ne "SI") { Write-Host "Cancelado."; exit 0 }

# Cargar credenciales desde .env
$envPath = Join-Path $AppDir ".env"
$envVars = @{}
Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') { $envVars[$matches[1]] = $matches[2] }
}

function Ubicar-ClienteMysql {
  $raices = @("C:\Program Files", "C:\Program Files (x86)")
  $candidatos = foreach ($raiz in $raices) {
    if (Test-Path $raiz) {
      Get-ChildItem $raiz -Directory -Filter "MariaDB*" -ErrorAction SilentlyContinue | ForEach-Object {
        Join-Path $_.FullName "bin\mysql.exe"
      }
    }
  }
  $candidatos | Where-Object { Test-Path $_ } | Sort-Object -Descending | Select-Object -First 1
}

$mysqlExe = Ubicar-ClienteMysql
if (-not $mysqlExe) {
  Write-Host "No se encontró mysql.exe en ninguna instalación de MariaDB." -ForegroundColor Red
  exit 1
}

Write-Host "`nDeteniendo el programa mientras se restaura..." -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$AppDir*server.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host "Restaurando '$($elegido.Name)'..." -ForegroundColor Cyan
$env:MYSQL_PWD = $envVars['DB_PASSWORD']
Get-Content $elegido.FullName -Raw | & $mysqlExe -h $envVars['DB_HOST'] -P $envVars['DB_PORT'] -u $envVars['DB_USER'] $envVars['DB_NAME']
Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue

if ($LASTEXITCODE -ne 0) {
  Write-Host "`nLa restauración terminó con errores (código $LASTEXITCODE). Revisa el mensaje de arriba." -ForegroundColor Red
  exit 1
}

Write-Host "`n=== Restauración completa ===" -ForegroundColor Green
Write-Host "Vuelve a abrir el programa con el acceso directo del escritorio."
