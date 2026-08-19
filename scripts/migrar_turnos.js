const pool = require('../src/db/pool');

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS turnos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      monto_apertura DECIMAL(10,2) NOT NULL DEFAULT 0,
      abierto_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      cerrado_en TIMESTAMP NULL,
      usuario_cierre_id INT,
      monto_esperado DECIMAL(10,2),
      monto_cierre DECIMAL(10,2),
      diferencia DECIMAL(10,2),
      estado ENUM('abierto','cerrado') NOT NULL DEFAULT 'abierto',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
      FOREIGN KEY (usuario_cierre_id) REFERENCES usuarios(id) ON DELETE SET NULL
    )
  `);
  console.log('Tabla turnos: ok');

  const [cols] = await pool.query(`SHOW COLUMNS FROM ventas LIKE 'turno_id'`);
  if (cols.length === 0) {
    await pool.query(`ALTER TABLE ventas ADD COLUMN turno_id INT NULL AFTER usuario_id`);
    await pool.query(`ALTER TABLE ventas ADD FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL`);
    console.log('Columna ventas.turno_id: agregada');
  } else {
    console.log('Columna ventas.turno_id: ya existia');
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
