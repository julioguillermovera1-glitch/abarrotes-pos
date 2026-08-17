const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

async function render(req, res, extra) {
  const [usuarios] = await pool.query('SELECT id, nombre, usuario, rol, activo FROM usuarios ORDER BY nombre');
  res.render('usuarios', { usuario: req.session.usuario, usuarios, error: null, nuevaClave: null, ...extra });
}

// Genera una contraseña simple y fácil de dictar/escribir a mano.
function generarPasswordSimple() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789'; // sin 0/o ni 1/l/i para evitar confusión
  return Array.from({ length: 8 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
}

router.get('/usuarios', requireAdmin, async (req, res) => {
  await render(req, res, {});
});

router.post('/usuarios', requireAdmin, async (req, res) => {
  const { nombre, usuario, rol } = req.body;
  const password = req.body.password || generarPasswordSimple();

  if (!nombre || !usuario) {
    return render(req, res, { error: 'Faltan datos' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    await pool.query(
      'INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)',
      [nombre, usuario, passwordHash, rol === 'admin' ? 'admin' : 'cajero']
    );
    await render(req, res, { nuevaClave: { nombre, usuario, password } });
  } catch (err) {
    const mensaje = err.code === 'ER_DUP_ENTRY' ? 'Ese nombre de usuario ya existe' : err.message;
    await render(req, res, { error: mensaje });
  }
});

router.post('/usuarios/:id/editar', requireAdmin, async (req, res) => {
  const { nombre, rol } = req.body;
  await pool.query('UPDATE usuarios SET nombre=?, rol=? WHERE id=?',
    [nombre, rol === 'admin' ? 'admin' : 'cajero', req.params.id]);
  res.redirect('/usuarios');
});

// Genera una contraseña nueva y la muestra en pantalla una sola vez, para
// entregársela a la vendedora (no queda guardada en texto plano en ningún lado).
router.post('/usuarios/:id/restablecer', requireAdmin, async (req, res) => {
  const [[u]] = await pool.query('SELECT nombre, usuario FROM usuarios WHERE id = ?', [req.params.id]);
  if (!u) return render(req, res, { error: 'Usuario no encontrado' });

  const password = generarPasswordSimple();
  const passwordHash = bcrypt.hashSync(password, 10);
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, req.params.id]);

  await render(req, res, { nuevaClave: { nombre: u.nombre, usuario: u.usuario, password } });
});

router.post('/usuarios/:id/desactivar', requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.session.usuario.id) {
    return render(req, res, { error: 'No puedes desactivar tu propia cuenta' });
  }
  await pool.query('UPDATE usuarios SET activo = NOT activo WHERE id = ?', [req.params.id]);
  res.redirect('/usuarios');
});

module.exports = router;
