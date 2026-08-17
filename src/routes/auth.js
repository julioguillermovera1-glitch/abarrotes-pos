const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');

const router = express.Router();

const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos de inicio de sesión. Espera unos minutos e intenta de nuevo.'
});

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

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
