# Arranca el servidor de Abarrotes POS (si no está corriendo) y abre el
# programa en su propia ventana, sin barra de direcciones ni pestañas de
# navegador — para que se sienta como un programa normal, no como una
# página web abierta en Chrome.
#
# Lo usan tanto el acceso directo del escritorio como el arranque
# automático al iniciar sesión en Windows.

$AppDir = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = "$env:ProgramFiles\nodejs\node.exe" }
$url = "http://localhost:4001"

function Servidor-Respondiendo {
  try {
    Invoke-WebRequest -Uri "$url/login" -UseBasicParsing -TimeoutSec 1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Servidor-Respondiendo)) {
  Start-Process $nodeExe -ArgumentList "`"$AppDir\src\server.js`"" -WorkingDirectory $AppDir -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Servidor-Respondiendo) { break }
  }
}

function Obtener-Navegador {
  $candidatos = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $candidatos) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

$navegador = Obtener-Navegador
if ($navegador) {
  Start-Process $navegador -ArgumentList "--app=$url", "--window-size=1280,800"
} else {
  Start-Process $url
}
