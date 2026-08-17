const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { procesarFactura } = require('../services/facturaExtractor');
const ValidationError = require('../utils/ValidationError');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'facturas');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const sufijo = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, sufijo + path.extname(file.originalname).toLowerCase());
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

router.get('/proveedores', requireAdmin, async (req, res) => {
  const [proveedores] = await pool.query(`
    SELECT p.*, COALESCE(SUM(f.saldo_pendiente), 0) AS saldo_total
    FROM proveedores p
    LEFT JOIN facturas_proveedor f ON f.proveedor_id = p.id AND f.estado = 'pendiente'
    GROUP BY p.id
    ORDER BY p.nombre
  `);
  res.render('proveedores', { usuario: req.session.usuario, proveedores });
});

router.post('/proveedores', requireAdmin, async (req, res) => {
  const { nombre, contacto, telefono, direccion } = req.body;
  await pool.query(
    'INSERT INTO proveedores (nombre, contacto, telefono, direccion) VALUES (?, ?, ?, ?)',
    [nombre, contacto || null, telefono || null, direccion || null]
  );
  res.redirect('/proveedores');
});

router.post('/proveedores/:id/desactivar', requireAdmin, async (req, res) => {
  await pool.query('UPDATE proveedores SET activo = NOT activo WHERE id = ?', [req.params.id]);
  res.redirect('/proveedores');
});

router.get('/proveedores/:id', requireAdmin, async (req, res) => {
  const [[proveedor]] = await pool.query('SELECT * FROM proveedores WHERE id = ?', [req.params.id]);
  if (!proveedor) return res.status(404).send('Proveedor no encontrado');
  const [facturas] = await pool.query(
    'SELECT * FROM facturas_proveedor WHERE proveedor_id = ? ORDER BY fecha_factura DESC',
    [req.params.id]
  );
  const [pagos] = await pool.query(
    'SELECT * FROM pagos_proveedor WHERE proveedor_id = ? ORDER BY creado_en DESC',
    [req.params.id]
  );
  res.render('proveedor_detalle', { usuario: req.session.usuario, proveedor, facturas, pagos });
});

// --- Registrar factura manualmente ---
router.post('/proveedores/:id/facturas', requireAdmin, async (req, res) => {
  const { numero_factura, concepto, monto, fecha_factura, fecha_vencimiento } = req.body;
  const montoNum = Number(monto);
  await pool.query(
    `INSERT INTO facturas_proveedor
       (proveedor_id, numero_factura, concepto, monto, saldo_pendiente, fecha_factura, fecha_vencimiento, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.id, numero_factura || null, concepto || null, montoNum, montoNum,
     fecha_factura, fecha_vencimiento || null, req.session.usuario.id]
  );
  res.redirect(`/proveedores/${req.params.id}`);
});

// --- Registrar pago de una factura ---
router.post('/proveedores/:id/pagos', requireAdmin, async (req, res) => {
  const { factura_id, monto } = req.body;
  const montoNum = Number(monto);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (factura_id) {
      const [[factura]] = await conn.query(
        'SELECT saldo_pendiente FROM facturas_proveedor WHERE id = ? AND proveedor_id = ? FOR UPDATE',
        [factura_id, req.params.id]
      );
      if (!factura) throw new ValidationError('Factura no encontrada');
      if (montoNum <= 0 || montoNum > Number(factura.saldo_pendiente)) {
        throw new ValidationError('Monto de pago inválido');
      }
      const nuevoSaldo = Number(factura.saldo_pendiente) - montoNum;
      await conn.query(
        'UPDATE facturas_proveedor SET saldo_pendiente = ?, estado = ? WHERE id = ?',
        [nuevoSaldo, nuevoSaldo <= 0 ? 'pagada' : 'pendiente', factura_id]
      );
    }

    await conn.query(
      'INSERT INTO pagos_proveedor (proveedor_id, factura_id, monto, usuario_id) VALUES (?, ?, ?, ?)',
      [req.params.id, factura_id || null, montoNum, req.session.usuario.id]
    );

    await conn.commit();
    res.redirect(`/proveedores/${req.params.id}`);
  } catch (err) {
    await conn.rollback();
    if (err instanceof ValidationError) return res.status(400).send(err.message);
    throw err;
  } finally {
    conn.release();
  }
});

// --- Escanear factura (PDF o foto) ---
router.get('/proveedores/facturas/escanear', requireAdmin, async (req, res) => {
  const [proveedores] = await pool.query('SELECT id, nombre FROM proveedores WHERE activo = 1 ORDER BY nombre');
  res.render('factura_escanear', { usuario: req.session.usuario, proveedores, extraido: null, error: null });
});

router.post('/proveedores/facturas/escanear', requireAdmin, upload.single('archivo'), async (req, res) => {
  const [proveedores] = await pool.query('SELECT id, nombre FROM proveedores WHERE activo = 1 ORDER BY nombre');
  if (!req.file) {
    return res.render('factura_escanear', { usuario: req.session.usuario, proveedores, extraido: null, error: 'Selecciona un archivo (PDF o foto).' });
  }
  try {
    const datos = await procesarFactura(req.file.path);
    res.render('factura_escanear', { usuario: req.session.usuario, proveedores, extraido: datos, error: null });
  } catch (err) {
    if (!(err instanceof ValidationError)) console.error('Error al leer factura:', err);
    const mensaje = err instanceof ValidationError ? err.message : 'No se pudo leer el archivo. Intenta con otra foto o revisa el PDF.';
    res.render('factura_escanear', { usuario: req.session.usuario, proveedores, extraido: null, error: mensaje });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// --- Confirmar y guardar la factura escaneada (crea proveedor si no existe) ---
router.post('/proveedores/facturas/confirmar', requireAdmin, async (req, res) => {
  const { proveedor_id, proveedor_nombre_nuevo, numero_factura, concepto, monto, fecha_factura, fecha_vencimiento } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let provId = proveedor_id;
    if (!provId && proveedor_nombre_nuevo) {
      const [result] = await conn.query('INSERT INTO proveedores (nombre) VALUES (?)', [proveedor_nombre_nuevo.trim()]);
      provId = result.insertId;
    }
    if (!provId) throw new ValidationError('Selecciona o escribe un proveedor');

    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) throw new ValidationError('El monto no es válido');
    if (!fecha_factura) throw new ValidationError('La fecha de factura es requerida');

    await conn.query(
      `INSERT INTO facturas_proveedor
         (proveedor_id, numero_factura, concepto, monto, saldo_pendiente, fecha_factura, fecha_vencimiento, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [provId, numero_factura || null, concepto || null, montoNum, montoNum,
       fecha_factura, fecha_vencimiento || null, req.session.usuario.id]
    );

    await conn.commit();
    res.redirect(`/proveedores/${provId}`);
  } catch (err) {
    await conn.rollback();
    if (err instanceof ValidationError) return res.status(400).send(err.message);
    throw err;
  } finally {
    conn.release();
  }
});

module.exports = router;
