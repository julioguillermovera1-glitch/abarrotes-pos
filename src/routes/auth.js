const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/ventas');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
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
  res.redirect('/ventas');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
