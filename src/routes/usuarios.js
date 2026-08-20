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
  const { nombre, rol, password } = req.body;
  const rolFinal = rol === 'admin' ? 'admin' : 'cajero';

  if (password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE usuarios SET nombre=?, rol=?, password_hash=? WHERE id=?',
      [nombre, rolFinal, passwordHash, req.params.id]);
  } else {
    await pool.query('UPDATE usuarios SET nombre=?, rol=? WHERE id=?',
      [nombre, rolFinal, req.params.id]);
  }
  res.redirect('/usuarios');
});

// Cambia la contraseña de un usuario. Si se escribe una, se usa esa; si se
// deja en blanco, se genera una al azar (para cuando no importa cuál sea,
// solo hace falta destrabar a alguien rápido).
router.post('/usuarios/:id/restablecer', requireAdmin, async (req, res) => {
  const [[u]] = await pool.query('SELECT nombre, usuario FROM usuarios WHERE id = ?', [req.params.id]);
  if (!u) return render(req, res, { error: 'Usuario no encontrado' });

  const password = req.body.password || generarPasswordSimple();
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

// Borra un usuario de verdad, no solo lo desactiva. Solo funciona si nunca
// registró ninguna venta: la tabla ventas exige un usuario_id valido (no se
// puede poner en null), asi que la base de datos misma rechaza el borrado
// si esa vendedora ya vendio algo -- para esos casos existe "Desactivar",
// que si conserva el historial.
router.post('/usuarios/:id/eliminar', requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.session.usuario.id) {
    return render(req, res, { error: 'No puedes eliminar tu propia cuenta' });
  }
  try {
    await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
    res.redirect('/usuarios');
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return render(req, res, { error: 'No se puede eliminar: esta persona ya tiene ventas registradas. Usa "Desactivar" para no perder el historial.' });
    }
    throw err;
  }
});

module.exports = router;
