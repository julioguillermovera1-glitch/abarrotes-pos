' Corre un script de PowerShell sin abrir NINGUNA ventana, ni siquiera un
' parpadeo. "powershell.exe -WindowStyle Hidden" igual deja pasar un
' destello de consola en Windows -- casi no se nota si corre una vez al
' dia, pero se hace notorio en tareas que corren seguido (como el
' Vigilante, cada 5 minutos). WScript.Shell.Run con el modo 0 (oculto) no
' tiene ese problema: el proceso nace ya escondido.
'
' Uso: wscript.exe //B ejecutar-oculto.vbs "C:\ruta\al\script.ps1"

Set objArgs = WScript.Arguments
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & objArgs(0) & """", 0, True
