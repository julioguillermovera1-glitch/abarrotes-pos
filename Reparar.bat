@echo off
REM Repara la instalacion (Node.js, MariaDB, dependencias, estructura de la
REM base de datos) sin borrar tus datos: ventas, inventario, clientes,
REM usuarios y contrasenas quedan igual. Usalo si el programa dejo de
REM abrir o algo se corrompio.
REM Pedira confirmacion de Windows para correr como Administrador (necesario).

echo === Reparando Abarrotes POS ===
echo Tus datos (ventas, inventario, clientes, usuarios) NO se van a perder.
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    goto :fin
)

if not exist "%~dp0src\server.js" (
    echo No se encontro el programa en esta carpeta. Reparar.bat debe estar
    echo dentro de la carpeta AbarrotesPOS.
    pause
    goto :fin
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"

:fin
pause
