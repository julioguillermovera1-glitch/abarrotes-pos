// Restablece la contraseña de la cuenta "admin", por si queda bloqueada y no
// se puede entrar para usar el botón "Restablecer contraseña" desde la
// propia pantalla de Usuarios.
//
// Uso:  node scripts/restablecer-admin.js TuNuevaContraseña
//       node scripts/restablecer-admin.js          (usa admin123 por defecto)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');

const nuevaPassword = process.argv[2] || 'admin123';

(async () => {
  const hash = bcrypt.hashSync(nuevaPassword, 10);
  const [result] = await pool.query(
    `UPDATE usuarios SET password_hash = ?, activo = 1 WHERE usuario = 'admin'`,
    [hash]
  );
  if (result.affectedRows === 0) {
    console.log('No se encontró ningún usuario "admin" — no se cambió nada.');
  } else {
    console.log(`Listo. La cuenta "admin" ahora tiene la contraseña: ${nuevaPassword}`);
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
