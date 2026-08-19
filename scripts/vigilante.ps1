# "Vigilante": corre cada pocos minutos en segundo plano (tarea programada) y
# si el servidor de Abarrotes POS no responde, lo reinicia solo — sin abrir
# ninguna ventana ni avisar, para que una caída del programa se repare sola
# aunque no haya nadie mirando la pantalla.

$AppDir = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = "$env:ProgramFiles\nodejs\node.exe" }

try {
  Invoke-WebRequest -Uri "http://localhost:4001/login" -UseBasicParsing -TimeoutSec 3 | Out-Null
  exit 0
} catch {
  # El servidor no respondió: puede que se haya cerrado el proceso, o que
  # esté colgado. Se mata cualquier proceso node.exe de esta carpeta y se
  # arranca de nuevo.
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$AppDir*server.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  Start-Sleep -Seconds 1
  Start-Process $nodeExe -ArgumentList "`"$AppDir\src\server.js`"" -WorkingDirectory $AppDir -WindowStyle Hidden
}
