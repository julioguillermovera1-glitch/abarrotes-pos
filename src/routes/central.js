const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const pool = require('../db/pool');

const router = express.Router();

const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos de inicio de sesión. Espera unos minutos e intenta de nuevo.'
});

function requireCentralLogin(req, res, next) {
  if (!req.session.centralUser) return res.redirect('/login');
  next();
}

// --- Login del panel central ---
router.get('/login', (req, res) => {
  if (req.session.centralUser) return res.redirect('/dashboard');
  res.render('central_login', { error: null });
});

router.post('/login', limitarLogin, async (req, res) => {
  const { usuario, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM central_admins WHERE usuario = ?', [usuario]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('central_login', { error: 'Usuario o contraseña incorrectos' });
  }
  req.session.centralUser = { id: user.id, usuario: user.usuario };
  req.session.passwordPorDefecto = user.usuario === 'admin' && password === 'admin123';
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Cambiar la contraseña del propio admin del panel central ---
router.post('/api/cambiar-password', requireCentralLogin, async (req, res) => {
  const { password_actual, password_nueva } = req.body;
  const [[user]] = await pool.query('SELECT * FROM central_admins WHERE id = ?', [req.session.centralUser.id]);
  if (!user || !bcrypt.compareSync(password_actual || '', user.password_hash)) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  }
  if (!password_nueva || password_nueva.length < 6) {
    return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' });
  }
  const nuevoHash = bcrypt.hashSync(password_nueva, 10);
  await pool.query('UPDATE central_admins SET password_hash = ? WHERE id = ?', [nuevoHash, user.id]);
  req.session.passwordPorDefecto = false;
  res.json({ ok: true });
});

// --- Desconecta todos los locales del panel (para dejarlo en blanco antes de
// entregar un local/instalador nuevo, sin datos de prueba pegados). ---
router.post('/api/limpiar-locales', requireCentralLogin, async (req, res) => {
  await pool.query('DELETE FROM local_status');
  await pool.query('DELETE FROM local_credentials');
  await pool.query('DELETE FROM pairing_codes');
  res.redirect('/dashboard');
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

// --- Generar código de emparejamiento para un local nuevo (como agregar una cámara Dahua) ---
router.post('/api/generar-codigo', requireCentralLogin, async (req, res) => {
  const nombre = (req.body.local_nombre || '').trim() || 'Nuevo local';
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusión
  let code;
  do {
    code = Array.from({ length: 6 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
    var [existe] = await pool.query('SELECT 1 FROM pairing_codes WHERE code = ?', [code]);
  } while (existe.length > 0);

  await pool.query(
    `INSERT INTO pairing_codes (code, local_nombre_sugerido, expira_en)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
    [code, nombre]
  );

  const qrDataUrl = await QRCode.toDataURL(code, { width: 260, margin: 1 });
  res.json({ code, qr: qrDataUrl, nombre });
});

// --- El local nuevo canjea el código y recibe sus credenciales ---
router.post('/api/pair', async (req, res) => {
  const codigo = (req.body.code || '').trim().toUpperCase();
  if (!codigo) return res.status(400).json({ error: 'Falta el código' });

  const [[pairing]] = await pool.query(
    `SELECT * FROM pairing_codes WHERE code = ? AND usado = 0 AND expira_en > NOW()`,
    [codigo]
  );
  if (!pairing) {
    return res.status(400).json({ error: 'Código inválido, ya usado o vencido' });
  }

  const localId = 'local-' + crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(24).toString('hex');

  await pool.query(
    'INSERT INTO local_credentials (local_id, secret, local_nombre) VALUES (?, ?, ?)',
    [localId, secret, pairing.local_nombre_sugerido]
  );
  await pool.query(
    'UPDATE pairing_codes SET usado = 1, local_id = ?, sync_secret = ? WHERE code = ?',
    [localId, secret, codigo]
  );

  res.json({
    local_id: localId,
    local_nombre: pairing.local_nombre_sugerido,
    sync_secret: secret
  });
});

// --- API de sincronización: cada local empuja aquí su resumen periódico ---
router.post('/api/sync', async (req, res) => {
  const key = req.headers['x-sync-key'];
  const { local_id, local_nombre } = req.body;

  if (!local_id || !local_nombre) {
    return res.status(400).json({ error: 'Falta local_id o local_nombre' });
  }
  if (!key) {
    return res.status(401).json({ error: 'Falta clave de sincronización' });
  }

  const [[cred]] = await pool.query('SELECT secret FROM local_credentials WHERE local_id = ?', [local_id]);
  const autorizado = cred ? key === cred.secret : key === process.env.SYNC_SECRET; // respaldo para configuración manual
  if (!autorizado) {
    return res.status(401).json({ error: 'Clave de sincronización inválida' });
  }

  const {
    ventas_hoy_total, ventas_hoy_count,
    top_productos, bajo_stock,
    cuentas_por_pagar_total, cuentas_por_pagar
  } = req.body;

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
