// Respaldo diario de la base de datos local. Pensado para correr solo,
// disparado por una tarea programada de Windows (ver scripts/instalar-backup.ps1).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { execFile } = require('child_process');

const MYSQLDUMP_PATH = process.env.MYSQLDUMP_PATH || 'C:\\Program Files (x86)\\MariaDB 5.5\\bin\\mysqldump.exe';
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DIAS_A_CONSERVAR = 30;

function marcaDeTiempo() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function respaldar() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  if (!fs.existsSync(MYSQLDUMP_PATH)) {
    console.error(`No se encontró mysqldump en: ${MYSQLDUMP_PATH}`);
    console.error('Define la variable de entorno MYSQLDUMP_PATH si está en otra ubicación.');
    process.exit(1);
  }

  const destino = path.join(BACKUP_DIR, `abarrotes_pos_${marcaDeTiempo()}.sql`);
  const args = [
    '-h', process.env.DB_HOST || '127.0.0.1',
    '-P', process.env.DB_PORT || '3306',
    '-u', process.env.DB_USER,
    '--routines', '--single-transaction',
    process.env.DB_NAME
  ];

  // La contraseña se pasa por variable de entorno (MYSQL_PWD) en vez de por
  // argumento, para que no quede visible en la lista de procesos de Windows.
  const child = execFile(MYSQLDUMP_PATH, args, {
    env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD },
    maxBuffer: 1024 * 1024 * 200
  }, (err) => {
    if (err) {
      console.error('Error al respaldar:', err.message);
      process.exit(1);
    }
    console.log(`Respaldo guardado: ${destino}`);
    limpiarRespaldosViejos();
  });

  const salida = fs.createWriteStream(destino);
  child.stdout.pipe(salida);
}

function limpiarRespaldosViejos() {
  const limite = Date.now() - DIAS_A_CONSERVAR * 24 * 60 * 60 * 1000;
  for (const archivo of fs.readdirSync(BACKUP_DIR)) {
    const ruta = path.join(BACKUP_DIR, archivo);
    if (fs.statSync(ruta).mtimeMs < limite) {
      fs.unlinkSync(ruta);
      console.log(`Respaldo antiguo eliminado: ${archivo}`);
    }
  }
}

respaldar();
