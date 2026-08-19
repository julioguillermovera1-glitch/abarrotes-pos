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

// Evita que alguien intente adivinar códigos de activación probando muchos
// a la fuerza (el endpoint es público a propósito, para que el POS local
// pueda llamarlo sin haber iniciado sesión en el panel central).
const limitarActivacion = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
});

function requireCentralLogin(req, res, next) {
  if (!req.session.centralUser) return res.redirect('/login');
  next();
}

// Solo tú (super_admin) administras la venta del producto en sí: generar
// códigos de activación y crear cuentas de cliente nuevas. Un cliente solo
// administra sus propios locales.
function requireSuperAdmin(req, res, next) {
  if (!req.session.centralUser) return res.redirect('/login');
  if (req.session.centralUser.rol !== 'super_admin') {
    return res.status(403).send('Acceso solo para el administrador del sistema');
  }
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
  req.session.centralUser = { id: user.id, usuario: user.usuario, rol: user.rol };
  req.session.passwordPorDefecto = user.usuario === 'admin' && password === 'admin123';
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

function generarPasswordSimple() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789'; // sin 0/o ni 1/l/i para evitar confusión
  return Array.from({ length: 8 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
}

// --- Crea una cuenta de cliente nueva (solo tú, super_admin): el cliente
// entra con esto y solo ve/administra sus propios locales, nunca los de
// otros clientes ni los tuyos. ---
router.post('/api/crear-cliente', requireSuperAdmin, async (req, res) => {
  const usuario = (req.body.usuario || '').trim();
  if (!usuario) return res.status(400).json({ error: 'Falta el nombre de usuario' });

  const [existe] = await pool.query('SELECT 1 FROM central_admins WHERE usuario = ?', [usuario]);
  if (existe.length > 0) return res.status(400).json({ error: 'Ese usuario ya existe' });

  const nombreContacto = (req.body.nombre_contacto || '').trim() || null;
  const telefono = (req.body.telefono || '').trim() || null;
  const password = req.body.password || generarPasswordSimple();
  const hash = bcrypt.hashSync(password, 10);
  await pool.query(
    "INSERT INTO central_admins (usuario, password_hash, rol, nombre_contacto, telefono) VALUES (?, ?, 'cliente', ?, ?)",
    [usuario, hash, nombreContacto, telefono]
  );
  res.json({ ok: true, usuario, password });
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

// --- Desconecta locales del panel (para dejarlos en blanco antes de
// entregar un local/instalador nuevo, sin datos de prueba pegados).
// super_admin desconecta TODO el panel; un cliente solo desconecta los
// locales que son suyos. ---
router.post('/api/limpiar-locales', requireCentralLogin, async (req, res) => {
  if (req.session.centralUser.rol === 'super_admin') {
    await pool.query('DELETE FROM local_status');
    await pool.query('DELETE FROM local_credentials');
    await pool.query('DELETE FROM pairing_codes');
  } else {
    const clienteId = req.session.centralUser.id;
    await pool.query('DELETE FROM local_status WHERE cliente_id = ?', [clienteId]);
    await pool.query('DELETE FROM local_credentials WHERE cliente_id = ?', [clienteId]);
    await pool.query('DELETE FROM pairing_codes WHERE cliente_id = ?', [clienteId]);
  }
  res.redirect('/dashboard');
});

// Si un local no sincroniza en más de esto, se marca "sin conexión" — el
// intervalo normal de sincronización es cada 20 min, así que se da margen
// para no marcar en falso ante una falla pasajera.
const MINUTOS_SIN_CONEXION = 45;

// --- Panel central: resumen de los locales. super_admin ve los de todos
// los clientes (con su nombre y teléfono, para poder darles soporte); un
// cliente solo ve los suyos propios. ---
router.get('/dashboard', requireCentralLogin, async (req, res) => {
  const esSuperAdmin = req.session.centralUser.rol === 'super_admin';
  const [locales] = esSuperAdmin
    ? await pool.query(
        `SELECT ls.*, ca.usuario AS cliente_usuario, ca.nombre_contacto AS cliente_nombre_contacto, ca.telefono AS cliente_telefono
         FROM local_status ls
         LEFT JOIN central_admins ca ON ca.id = ls.cliente_id
         ORDER BY ls.local_nombre`
      )
    : await pool.query('SELECT * FROM local_status WHERE cliente_id = ? ORDER BY local_nombre', [req.session.centralUser.id]);

  const parsed = locales.map(l => ({
    ...l,
    top_productos: safeParse(l.top_productos, []),
    bajo_stock: safeParse(l.bajo_stock, []),
    cuentas_por_pagar: safeParse(l.cuentas_por_pagar, []),
    conectado: (Date.now() - new Date(l.actualizado_en).getTime()) < MINUTOS_SIN_CONEXION * 60 * 1000
  }));

  const totales = parsed.reduce((acc, l) => {
    acc.ventas_hoy_total += Number(l.ventas_hoy_total);
    acc.ventas_hoy_count += Number(l.ventas_hoy_count);
    acc.cuentas_por_pagar_total += Number(l.cuentas_por_pagar_total);
    return acc;
  }, { ventas_hoy_total: 0, ventas_hoy_count: 0, cuentas_por_pagar_total: 0 });

  let clientes = [];
  if (esSuperAdmin) {
    [clientes] = await pool.query("SELECT id, usuario, nombre_contacto, telefono FROM central_admins WHERE rol = 'cliente' ORDER BY usuario");
  }

  res.render('dashboard', { locales: parsed, totales, usuario: req.session.centralUser, esSuperAdmin, clientes });
});

// --- Elimina la cuenta de un cliente (no borra sus locales ni sus ventas,
// solo el acceso al panel — sus locales siguen funcionando igual). ---
router.post('/api/eliminar-cliente', requireSuperAdmin, async (req, res) => {
  const clienteId = Number(req.body.cliente_id);
  if (!clienteId) return res.status(400).json({ error: 'Falta el cliente' });
  await pool.query("DELETE FROM central_admins WHERE id = ? AND rol = 'cliente'", [clienteId]);
  res.json({ ok: true });
});

function safeParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// --- Generar código de emparejamiento para un local nuevo (como agregar una
// cámara Dahua). Queda asociado a quien lo generó, así el local nuevo
// aparece automáticamente en el panel del cliente correcto (o el tuyo). ---
router.post('/api/generar-codigo', requireCentralLogin, async (req, res) => {
  const nombre = (req.body.local_nombre || '').trim() || 'Nuevo local';
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusión
  let code;
  do {
    code = Array.from({ length: 6 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
    var [existe] = await pool.query('SELECT 1 FROM pairing_codes WHERE code = ?', [code]);
  } while (existe.length > 0);

  await pool.query(
    `INSERT INTO pairing_codes (code, local_nombre_sugerido, cliente_id, expira_en)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
    [code, nombre, req.session.centralUser.id]
  );

  const qrDataUrl = await QRCode.toDataURL(code, { width: 260, margin: 1 });
  res.json({ code, qr: qrDataUrl, nombre });
});

// --- Genera un código de activación de un solo uso, para vender el
// programa una vez que termina la prueba gratis de 7 días. El local lo
// valida aquí (necesita internet en ese momento), así no se puede generar
// un código falso sin conocer uno real. Solo tú vendes el producto. ---
// duracion: '1' (1 año), '5' (5 años), o 'indefinido'.
const MESES_POR_DURACION = { '1': 12, '5': 60, indefinido: null };

router.post('/api/generar-codigo-licencia', requireSuperAdmin, async (req, res) => {
  const nota = (req.body.nota || '').trim() || null;
  const duracion = req.body.duracion || 'indefinido';
  if (!(duracion in MESES_POR_DURACION)) {
    return res.status(400).json({ error: 'Duración inválida' });
  }
  const meses = MESES_POR_DURACION[duracion];

  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusión
  let code;
  do {
    code = Array.from({ length: 6 }, () => alfabeto[crypto.randomInt(alfabeto.length)]).join('');
    var [existe] = await pool.query('SELECT 1 FROM codigos_activacion WHERE code = ?', [code]);
  } while (existe.length > 0);

  await pool.query('INSERT INTO codigos_activacion (code, nota, meses) VALUES (?, ?, ?)', [code, nota, meses]);
  res.json({ codigo: code });
});

// --- El local canjea el código para activarse (llamado desde /licencia/activar). ---
router.post('/api/activar-licencia', limitarActivacion, async (req, res) => {
  const codigo = (req.body.code || '').trim().toUpperCase();
  const instalacionId = (req.body.instalacion_id || '').trim();
  if (!codigo || !instalacionId) {
    return res.status(400).json({ error: 'Falta el código o el ID de instalación' });
  }

  const [[existente]] = await pool.query('SELECT * FROM codigos_activacion WHERE code = ?', [codigo]);
  if (!existente) {
    return res.status(400).json({ error: 'Ese código no existe.' });
  }
  if (existente.usado) {
    return res.status(400).json({ error: 'Ese código ya fue usado.' });
  }

  await pool.query(
    'UPDATE codigos_activacion SET usado = 1, instalacion_id = ?, usado_en = NOW() WHERE code = ?',
    [instalacionId, codigo]
  );

  let expiraEn = null;
  if (existente.meses) {
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() + existente.meses);
    expiraEn = fecha.toISOString();
  }
  res.json({ ok: true, expira_en: expiraEn });
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
    'INSERT INTO local_credentials (local_id, secret, local_nombre, cliente_id) VALUES (?, ?, ?, ?)',
    [localId, secret, pairing.local_nombre_sugerido, pairing.cliente_id]
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

  const [[cred]] = await pool.query('SELECT secret, cliente_id FROM local_credentials WHERE local_id = ?', [local_id]);
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
       (local_id, local_nombre, cliente_id, ventas_hoy_total, ventas_hoy_count, top_productos, bajo_stock, cuentas_por_pagar_total, cuentas_por_pagar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       local_nombre = VALUES(local_nombre),
       cliente_id = VALUES(cliente_id),
       ventas_hoy_total = VALUES(ventas_hoy_total),
       ventas_hoy_count = VALUES(ventas_hoy_count),
       top_productos = VALUES(top_productos),
       bajo_stock = VALUES(bajo_stock),
       cuentas_por_pagar_total = VALUES(cuentas_por_pagar_total),
       cuentas_por_pagar = VALUES(cuentas_por_pagar)`,
    [
      local_id, local_nombre, (cred && cred.cliente_id) || null,
      ventas_hoy_total || 0, ventas_hoy_count || 0,
      JSON.stringify(top_productos || []), JSON.stringify(bajo_stock || []),
      cuentas_por_pagar_total || 0, JSON.stringify(cuentas_por_pagar || [])
    ]
  );

  res.json({ ok: true });
});

module.exports = { router, requireCentralLogin };
