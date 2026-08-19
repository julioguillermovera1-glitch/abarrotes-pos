const pool = require('../src/db/pool');

(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS turno_lock (id INT PRIMARY KEY DEFAULT 1)`);
  await pool.query(`INSERT IGNORE INTO turno_lock (id) VALUES (1)`);
  console.log('Tabla turno_lock: ok');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
