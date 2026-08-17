@echo off
REM Si este archivo esta solo (sin el resto de la carpeta al lado), descarga
REM todo el programa desde GitHub. Si esta dentro de la carpeta AbarrotesPOS
REM completa (copiada por USB), usa esos archivos directamente sin descargar
REM el programa de nuevo (Node.js y MariaDB si siguen necesitando internet).
REM Pedira confirmacion de Windows para correr como Administrador (necesario).

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    goto :fin
)

if exist "%~dp0src\server.js" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm 'https://raw.githubusercontent.com/julioguillermovera1-glitch/abarrotes-pos/master/bootstrap.ps1')"
)

:fin
pause
