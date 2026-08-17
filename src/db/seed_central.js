require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const passwordHash = bcrypt.hashSync('admin123', 10);
  await pool.query(
    `INSERT INTO central_admins (usuario, password_hash)
     VALUES ('admin', ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [passwordHash]
  );
  console.log('Usuario del panel central creado: admin / admin123');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
