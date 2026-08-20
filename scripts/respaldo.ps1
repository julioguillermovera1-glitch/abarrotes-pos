# Corre el respaldo diario (tarea programada) sin abrir ninguna ventana.
# node.exe abre una consola visible si Task Scheduler lo ejecuta directo;
# lanzandolo con Start-Process -WindowStyle Hidden desde aqui, no se ve nada.

$AppDir = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = "$env:ProgramFiles\nodejs\node.exe" }

Start-Process $nodeExe -ArgumentList "`"$AppDir\scripts\backup.js`"" -WorkingDirectory $AppDir -WindowStyle Hidden -Wait
