const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/clientes', requireLogin, async (req, res) => {
  const [clientes] = await pool.query('SELECT * FROM clientes ORDER BY nombre');
  res.render('clientes', { usuario: req.session.usuario, clientes });
});

router.post('/clientes', requireLogin, async (req, res) => {
  const { nombre, telefono, direccion, limite_credito } = req.body;
  await pool.query(
    'INSERT INTO clientes (nombre, telefono, direccion, limite_credito) VALUES (?, ?, ?, ?)',
    [nombre, telefono || null, direccion || null, limite_credito || 0]
  );
  res.redirect('/clientes');
});

router.post('/clientes/:id/editar', requireLogin, async (req, res) => {
  const { nombre, telefono, direccion, limite_credito } = req.body;
  await pool.query(
    'UPDATE clientes SET nombre=?, telefono=?, direccion=?, limite_credito=? WHERE id=?',
    [nombre, telefono || null, direccion || null, limite_credito || 0, req.params.id]
  );
  res.redirect('/clientes');
});

router.post('/clientes/:id/desactivar', requireLogin, async (req, res) => {
  await pool.query('UPDATE clientes SET activo = NOT activo WHERE id = ?', [req.params.id]);
  res.redirect('/clientes');
});

router.get('/clientes/:id', requireLogin, async (req, res) => {
  const [[cliente]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).send('Cliente no encontrado');
  const [ventas] = await pool.query(
    `SELECT id, total, creado_en FROM ventas WHERE cliente_id = ? AND tipo_pago = 'credito' ORDER BY creado_en DESC`,
    [req.params.id]
  );
  const [abonos] = await pool.query(
    'SELECT * FROM abonos_credito WHERE cliente_id = ? ORDER BY creado_en DESC',
    [req.params.id]
  );
  res.render('cliente_detalle', { usuario: req.session.usuario, cliente, ventas, abonos });
});

router.post('/clientes/:id/abono', requireLogin, async (req, res) => {
  const monto = Number(req.body.monto);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[cliente]] = await conn.query('SELECT saldo_pendiente FROM clientes WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!cliente) throw new Error('Cliente no encontrado');
    if (monto <= 0 || monto > Number(cliente.saldo_pendiente)) {
      throw new Error('Monto de abono inválido');
    }
    await conn.query('UPDATE clientes SET saldo_pendiente = saldo_pendiente - ? WHERE id = ?', [monto, req.params.id]);
    await conn.query(
      'INSERT INTO abonos_credito (cliente_id, monto, usuario_id) VALUES (?, ?, ?)',
      [req.params.id, monto, req.session.usuario.id]
    );
    await conn.commit();
    res.redirect(`/clientes/${req.params.id}`);
  } catch (err) {
    await conn.rollback();
    res.status(400).send(err.message);
  } finally {
    conn.release();
  }
});

module.exports = router;
