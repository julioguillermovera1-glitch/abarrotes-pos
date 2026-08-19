const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');

const router = express.Router();

const ARCHIVO_CLAVE_RECUPERACION = path.join(__dirname, '..', '..', 'CLAVE-DE-RECUPERACION.txt');

const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos de inicio de sesión. Espera unos minutos e intenta de nuevo.'
});

const limitarRecuperar = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
});

// La clave de recuperación se genera una sola vez (la primera vez que se
// visita /recuperar) y se guarda en texto plano en un archivo local — solo
// alguien con acceso a esta PC puede leerla. En la base de datos solo se
// guarda su hash, igual que las contraseñas.
async function obtenerOCrearClaveRecuperacion() {
  const [rows] = await pool.query('SELECT clave_hash FROM recuperacion WHERE id = 1');
  if (rows[0]) return rows[0].clave_hash;

  const clave = crypto.randomBytes(6).toString('hex').toUpperCase();
  const hash = bcrypt.hashSync(clave, 10);
  await pool.query('INSERT INTO recuperacion (id, clave_hash) VALUES (1, ?)', [hash]);
  fs.writeFileSync(
    ARCHIVO_CLAVE_RECUPERACION,
    `Clave de recuperación de Abarrotes POS\n\n${clave}\n\nUsa esta clave en la pantalla "¿Olvidaste tu contraseña?" del sistema para crear una nueva contraseña de administrador.\nGuárdala en un lugar seguro. No la compartas.\n`
  );
  return hash;
}

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/ventas');
  res.render('login', { error: null });
});

router.post('/login', limitarLogin, async (req, res) => {
  const { usuario, password } = req.body;
  const [rows] = await pool.query(
    'SELECT * FROM usuarios WHERE usuario = ? AND activo = 1',
    [usuario]
  );
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { error: 'Usuario o contraseña incorrectos' });
  }
  req.session.usuario = { id: user.id, nombre: user.nombre, rol: user.rol };
  req.session.passwordPorDefecto = user.usuario === 'admin' && password === 'admin123';
  res.redirect('/ventas');
});

router.get('/recuperar', async (req, res) => {
  await obtenerOCrearClaveRecuperacion();
  res.render('recuperar', { error: null, exito: null });
});

router.post('/recuperar', limitarRecuperar, async (req, res) => {
  const { clave, password, confirmar } = req.body;

  const hash = await obtenerOCrearClaveRecuperacion();
  if (!clave || !bcrypt.compareSync(clave, hash)) {
    return res.render('recuperar', { error: 'Clave de recuperación incorrecta.', exito: null });
  }
  if (!password || password.length < 4) {
    return res.render('recuperar', { error: 'La nueva contraseña debe tener al menos 4 caracteres.', exito: null });
  }
  if (password !== confirmar) {
    return res.render('recuperar', { error: 'Las contraseñas no coinciden.', exito: null });
  }

  const nuevoHash = bcrypt.hashSync(password, 10);
  const [result] = await pool.query(
    `UPDATE usuarios SET password_hash = ?, activo = 1 WHERE usuario = 'admin'`,
    [nuevoHash]
  );
  if (result.affectedRows === 0) {
    return res.render('recuperar', { error: 'No se encontró la cuenta de administrador.', exito: null });
  }
  res.render('recuperar', { error: null, exito: 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
