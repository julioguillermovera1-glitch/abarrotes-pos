@echo off
REM Doble clic en este archivo para instalar Abarrotes POS.
REM Pedira confirmacion de Windows para correr como Administrador (es necesario).

net session >nul 2>&1
if %errorLevel% == 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"
) else (
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
)
pause
