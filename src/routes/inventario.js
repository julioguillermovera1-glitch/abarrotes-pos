const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/inventario', requireLogin, async (req, res) => {
  const [productos] = await pool.query(
    `SELECT p.*, c.nombre AS categoria_nombre
     FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id
     ORDER BY p.nombre`
  );
  const [categorias] = await pool.query('SELECT * FROM categorias ORDER BY nombre');
  res.render('inventario', { usuario: req.session.usuario, productos, categorias });
});

// Búsqueda exacta por código de barra, para la recepción rápida de mercadería (escanear + Enter).
router.get('/api/inventario/codigo/:codigo', requireLogin, async (req, res) => {
  const [[producto]] = await pool.query(
    `SELECT id, codigo_barra, nombre, tipo_venta, existencia, stock_minimo, precio_compra
     FROM productos WHERE codigo_barra = ? LIMIT 1`,
    [req.params.codigo]
  );
  if (!producto) return res.status(404).json({ error: 'No encontrado' });
  res.json(producto);
});

router.post('/inventario/productos', requireLogin, async (req, res) => {
  const { codigo_barra, nombre, categoria_id, tipo_venta, precio_compra, precio_venta, existencia, stock_minimo } = req.body;
  await pool.query(
    `INSERT INTO productos (codigo_barra, nombre, categoria_id, tipo_venta, precio_compra, precio_venta, existencia, stock_minimo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [codigo_barra || null, nombre, categoria_id || null, tipo_venta === 'peso' ? 'peso' : 'unidad',
     precio_compra || 0, precio_venta || 0, existencia || 0, stock_minimo || 0]
  );
  res.redirect('/inventario');
});

router.post('/inventario/productos/:id/editar', requireLogin, async (req, res) => {
  const { codigo_barra, nombre, categoria_id, tipo_venta, precio_compra, precio_venta, stock_minimo } = req.body;
  await pool.query(
    `UPDATE productos SET codigo_barra=?, nombre=?, categoria_id=?, tipo_venta=?, precio_compra=?, precio_venta=?, stock_minimo=?
     WHERE id=?`,
    [codigo_barra || null, nombre, categoria_id || null, tipo_venta === 'peso' ? 'peso' : 'unidad',
     precio_compra || 0, precio_venta || 0, stock_minimo || 0, req.params.id]
  );
  res.redirect('/inventario');
});

router.post('/inventario/productos/:id/desactivar', requireLogin, async (req, res) => {
  await pool.query('UPDATE productos SET activo = NOT activo WHERE id = ?', [req.params.id]);
  res.redirect('/inventario');
});

// Ajuste manual de existencias (entrada/salida/ajuste)
router.post('/inventario/productos/:id/movimiento', requireLogin, async (req, res) => {
  const { tipo, cantidad, motivo, precio_compra } = req.body;
  const cant = Number(cantidad);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const delta = tipo === 'salida' ? -cant : cant; // 'entrada' y 'ajuste' positivo suman
    await conn.query('UPDATE productos SET existencia = existencia + ? WHERE id = ?', [delta, req.params.id]);
    if (precio_compra) {
      await conn.query('UPDATE productos SET precio_compra = ? WHERE id = ?', [precio_compra, req.params.id]);
    }
    await conn.query(
      `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, tipo, cant, motivo || null, req.session.usuario.id]
    );
    await conn.commit();
    res.redirect('/inventario');
  } catch (err) {
    await conn.rollback();
    res.status(400).send(err.message);
  } finally {
    conn.release();
  }
});

router.post('/inventario/categorias', requireLogin, async (req, res) => {
  const { nombre } = req.body;
  await pool.query('INSERT IGNORE INTO categorias (nombre) VALUES (?)', [nombre]);
  res.redirect('/inventario');
});

module.exports = router;
