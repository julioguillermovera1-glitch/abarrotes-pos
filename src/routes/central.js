const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

function requireCentralLogin(req, res, next) {
  if (!req.session.centralUser) return res.redirect('/login');
  next();
}

// --- Login del panel central ---
router.get('/login', (req, res) => {
  if (req.session.centralUser) return res.redirect('/dashboard');
  res.render('central_login', { error: null });
});

router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM central_admins WHERE usuario = ?', [usuario]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('central_login', { error: 'Usuario o contraseña incorrectos' });
  }
  req.session.centralUser = { id: user.id, usuario: user.usuario };
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Panel central: resumen de todos los locales ---
router.get('/dashboard', requireCentralLogin, async (req, res) => {
  const [locales] = await pool.query('SELECT * FROM local_status ORDER BY local_nombre');

  const parsed = locales.map(l => ({
    ...l,
    top_productos: safeParse(l.top_productos, []),
    bajo_stock: safeParse(l.bajo_stock, []),
    cuentas_por_pagar: safeParse(l.cuentas_por_pagar, [])
  }));

  const totales = parsed.reduce((acc, l) => {
    acc.ventas_hoy_total += Number(l.ventas_hoy_total);
    acc.ventas_hoy_count += Number(l.ventas_hoy_count);
    acc.cuentas_por_pagar_total += Number(l.cuentas_por_pagar_total);
    return acc;
  }, { ventas_hoy_total: 0, ventas_hoy_count: 0, cuentas_por_pagar_total: 0 });

  res.render('dashboard', { locales: parsed, totales, usuario: req.session.centralUser });
});

function safeParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// --- API de sincronización: cada local empuja aquí su resumen periódico ---
router.post('/api/sync', async (req, res) => {
  const key = req.headers['x-sync-key'];
  if (!key || key !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Clave de sincronización inválida' });
  }

  const {
    local_id, local_nombre,
    ventas_hoy_total, ventas_hoy_count,
    top_productos, bajo_stock,
    cuentas_por_pagar_total, cuentas_por_pagar
  } = req.body;

  if (!local_id || !local_nombre) {
    return res.status(400).json({ error: 'Falta local_id o local_nombre' });
  }

  await pool.query(
    `INSERT INTO local_status
       (local_id, local_nombre, ventas_hoy_total, ventas_hoy_count, top_productos, bajo_stock, cuentas_por_pagar_total, cuentas_por_pagar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       local_nombre = VALUES(local_nombre),
       ventas_hoy_total = VALUES(ventas_hoy_total),
       ventas_hoy_count = VALUES(ventas_hoy_count),
       top_productos = VALUES(top_productos),
       bajo_stock = VALUES(bajo_stock),
       cuentas_por_pagar_total = VALUES(cuentas_por_pagar_total),
       cuentas_por_pagar = VALUES(cuentas_por_pagar)`,
    [
      local_id, local_nombre,
      ventas_hoy_total || 0, ventas_hoy_count || 0,
      JSON.stringify(top_productos || []), JSON.stringify(bajo_stock || []),
      cuentas_por_pagar_total || 0, JSON.stringify(cuentas_por_pagar || [])
    ]
  );

  res.json({ ok: true });
});

module.exports = { router, requireCentralLogin };
