const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');
const { abrirCaja } = require('../services/cajaRegistradora');

const router = express.Router();

router.get('/ventas', requireLogin, async (req, res) => {
  const [clientes] = await pool.query(
    'SELECT id, nombre FROM clientes WHERE activo = 1 ORDER BY nombre'
  );
  const [categorias] = await pool.query('SELECT * FROM categorias ORDER BY nombre');
  const [productos] = await pool.query(
    `SELECT id, codigo_barra, nombre, precio_venta, existencia, categoria_id
     FROM productos WHERE activo = 1 ORDER BY nombre`
  );
  res.render('ventas', { usuario: req.session.usuario, clientes, categorias, productos });
});

// Búsqueda de productos para el POS (por nombre o código de barra, coincidencia parcial)
router.get('/api/productos/buscar', requireLogin, async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const [rows] = await pool.query(
    `SELECT id, codigo_barra, nombre, precio_venta, existencia
     FROM productos
     WHERE activo = 1 AND (nombre LIKE ? OR codigo_barra LIKE ?)
     ORDER BY nombre LIMIT 20`,
    [q, q]
  );
  res.json(rows);
});

// Búsqueda exacta por código de barra (para lectora/escáner: escanear + Enter = agregar)
router.get('/api/productos/codigo/:codigo', requireLogin, async (req, res) => {
  const [[producto]] = await pool.query(
    `SELECT id, codigo_barra, nombre, precio_venta, existencia
     FROM productos WHERE activo = 1 AND codigo_barra = ? LIMIT 1`,
    [req.params.codigo]
  );
  if (!producto) return res.status(404).json({ error: 'No encontrado' });
  res.json(producto);
});

// Registrar una venta
router.post('/api/ventas', requireLogin, async (req, res) => {
  const { items, tipo_pago, cliente_id, pagado_con } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No hay productos en la venta' });
  }
  if (tipo_pago === 'credito' && !cliente_id) {
    return res.status(400).json({ error: 'Selecciona un cliente para venta a crédito' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let total = 0;
    const detalles = [];
    for (const item of items) {
      const [[producto]] = await conn.query(
        'SELECT id, precio_venta, existencia, nombre FROM productos WHERE id = ? FOR UPDATE',
        [item.producto_id]
      );
      if (!producto) throw new Error(`Producto ${item.producto_id} no encontrado`);
      if (producto.existencia < item.cantidad) {
        throw new Error(`Existencia insuficiente de "${producto.nombre}" (disponible: ${producto.existencia})`);
      }
      const subtotal = Number(producto.precio_venta) * item.cantidad;
      total += subtotal;
      detalles.push({
        producto_id: producto.id,
        cantidad: item.cantidad,
        precio_unitario: producto.precio_venta,
        subtotal
      });
    }

    if (tipo_pago === 'credito') {
      const [[cliente]] = await conn.query(
        'SELECT id, saldo_pendiente, limite_credito, nombre FROM clientes WHERE id = ? FOR UPDATE',
        [cliente_id]
      );
      if (!cliente) throw new Error('Cliente no encontrado');
      const nuevoSaldo = Number(cliente.saldo_pendiente) + total;
      if (cliente.limite_credito > 0 && nuevoSaldo > Number(cliente.limite_credito)) {
        throw new Error(`El crédito supera el límite de "${cliente.nombre}"`);
      }
    }

    const cambio = tipo_pago === 'efectivo' && pagado_con != null
      ? Number(pagado_con) - total
      : null;
    if (tipo_pago === 'efectivo' && cambio < 0) {
      throw new Error('El monto pagado es menor al total');
    }

    const [ventaResult] = await conn.query(
      `INSERT INTO ventas (cliente_id, usuario_id, tipo_pago, total, pagado_con, cambio, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'completada')`,
      [cliente_id || null, req.session.usuario.id, tipo_pago, total, pagado_con || null, cambio]
    );
    const ventaId = ventaResult.insertId;

    for (const d of detalles) {
      await conn.query(
        `INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [ventaId, d.producto_id, d.cantidad, d.precio_unitario, d.subtotal]
      );
      await conn.query('UPDATE productos SET existencia = existencia - ? WHERE id = ?', [d.cantidad, d.producto_id]);
      await conn.query(
        `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id)
         VALUES (?, 'venta', ?, ?, ?)`,
        [d.producto_id, d.cantidad, `Venta #${ventaId}`, req.session.usuario.id]
      );
    }

    if (tipo_pago === 'credito') {
      await conn.query('UPDATE clientes SET saldo_pendiente = saldo_pendiente + ? WHERE id = ?', [total, cliente_id]);
    }

    await conn.commit();
    if (tipo_pago === 'efectivo') abrirCaja();
    res.json({ ok: true, venta_id: ventaId, total, cambio });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Ticket de una venta (para reimprimir/ver detalle)
router.get('/ventas/:id/ticket', requireLogin, async (req, res) => {
  const [[venta]] = await pool.query(
    `SELECT v.*, c.nombre AS cliente_nombre, u.nombre AS usuario_nombre
     FROM ventas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.id = ?`,
    [req.params.id]
  );
  if (!venta) return res.status(404).send('Venta no encontrada');
  const [detalle] = await pool.query(
    `SELECT vd.*, p.nombre AS producto_nombre
     FROM venta_detalle vd JOIN productos p ON p.id = vd.producto_id
     WHERE vd.venta_id = ?`,
    [req.params.id]
  );
  res.render('ticket', { venta, detalle });
});

module.exports = router;
