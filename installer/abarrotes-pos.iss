; Instalador de Abarrotes POS.
; Compilar con: ISCC.exe installer\abarrotes-pos.iss
; (o abriendo este archivo en el Inno Setup Compiler y presionando F9)

#define MyAppName "Abarrotes POS"
#define MyAppVersion "1.0"
#define MyAppPublisher "Abarrotes POS"
#define MyAppURL "http://localhost:4001"

[Setup]
AppId={{6F2B6C6E-6A9D-4C4E-9A8B-2D6E7B7B7A11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName=C:\AbarrotesPOS
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=AbarrotesPOS-Instalador
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=abarrotes-pos-icono.ico
UninstallDisplayIcon={app}\src\public\img\icon.ico

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
; Todo el codigo del programa, menos lo que no debe empaquetarse
; (dependencias que se instalan solas, datos de una instalacion previa, git).
Source: "..\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; \
  Excludes: "node_modules,.git,.claude,backups,uploads,.env,dist,installer,*.log"
; Acceso directo a la pagina del programa (un .lnk con una URL directa como
; destino no es confiable en Windows, por eso se usa un .url de verdad).
Source: "AbarrotesPOS.url"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\AbarrotesPOS.url"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\AbarrotesPOS.url"

[Run]
; Termina de instalar Node.js/MariaDB, crea la base de datos, y deja el
; programa arrancando solo. Se muestra en una consola (no oculta) para
; que se vea el progreso, ya que puede tardar varios minutos.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Instalar.ps1"""; \
  WorkingDir: "{app}"; \
  StatusMsg: "Configurando Abarrotes POS (Node.js, base de datos)... esto puede tardar varios minutos"; \
  Flags: waituntilterminated

[UninstallRun]
; Limpieza al desinstalar: para el programa y quita las tareas programadas.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -Command ""Unregister-ScheduledTask -TaskName 'AbarrotesPOS-Servidor' -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'AbarrotesPOS-BackupDiario' -Confirm:$false -ErrorAction SilentlyContinue; Get-Process node -ErrorAction SilentlyContinue | Where-Object {{$_.Path -like '*AbarrotesPOS*'}} | Stop-Process -Force -ErrorAction SilentlyContinue"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "QuitarTareasProgramadas"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsAdmin() then
  begin
    MsgBox('Este instalador necesita permisos de Administrador. Vuelve a abrirlo con clic derecho -> "Ejecutar como administrador".', mbError, MB_OK);
    Result := False;
  end;
end;
