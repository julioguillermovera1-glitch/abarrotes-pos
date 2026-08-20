// Migración para el panel CENTRAL (no el POS local): agrega a local_status
// las columnas de estado de licencia, para poder avisar en el dashboard
// cuándo un local está por vencer y ofrecerle renovar a tiempo.
// Correr una sola vez contra la base de datos del panel central (MySQL en
// Clever Cloud), con las variables de entorno de esa base cargadas.
const pool = require('../src/db/pool');

async function agregarColumna(nombre, definicion) {
  const [cols] = await pool.query(`SHOW COLUMNS FROM local_status LIKE '${nombre}'`);
  if (cols.length === 0) {
    await pool.query(`ALTER TABLE local_status ADD COLUMN ${nombre} ${definicion}`);
    console.log(`Columna local_status.${nombre}: agregada`);
  } else {
    console.log(`Columna local_status.${nombre}: ya existía`);
  }
}

(async () => {
  await agregarColumna('licencia_estado', "VARCHAR(20) NOT NULL DEFAULT 'prueba'");
  await agregarColumna('licencia_expira_en', 'TIMESTAMP NULL');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
