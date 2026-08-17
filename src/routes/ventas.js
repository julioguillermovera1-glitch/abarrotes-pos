const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');
const { abrirCaja } = require('../services/cajaRegistradora');
const { turnoAbierto } = require('./caja');
const ValidationError = require('../utils/ValidationError');

const router = express.Router();

router.get('/ventas', requireLogin, async (req, res) => {
  const [clientes] = await pool.query(
    'SELECT id, nombre FROM clientes WHERE activo = 1 ORDER BY nombre'
  );

  const [ventasHoy] = await pool.query(
    `SELECT v.id, v.total, v.tipo_pago, v.creado_en, c.nombre AS cliente_nombre, u.nombre AS usuario_nombre
     FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.estado='completada' AND DATE(v.creado_en) = CURDATE()
     ORDER BY v.creado_en DESC`
  );
  const [[resumenHoy]] = await pool.query(
    `SELECT COUNT(*) AS num_ventas, COALESCE(SUM(total),0) AS total_hoy
     FROM ventas WHERE estado='completada' AND DATE(creado_en) = CURDATE()`
  );
  const [masVendidosHoy] = await pool.query(
    `SELECT p.nombre, p.tipo_venta, SUM(vd.cantidad) AS cantidad, SUM(vd.subtotal) AS total
     FROM venta_detalle vd
     JOIN ventas v ON v.id = vd.venta_id
     JOIN productos p ON p.id = vd.producto_id
     WHERE v.estado='completada' AND DATE(v.creado_en) = CURDATE()
     GROUP BY p.id ORDER BY total DESC LIMIT 10`
  );

  const turno = await turnoAbierto();

  res.render('ventas', {
    usuario: req.session.usuario, clientes,
    ventasHoy, resumenHoy, masVendidosHoy, turno
  });
});

// Búsqueda de productos para el POS (por nombre o código de barra, coincidencia parcial)
router.get('/api/productos/buscar', requireLogin, async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const [rows] = await pool.query(
    `SELECT id, codigo_barra, nombre, precio_venta, tipo_venta, existencia
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
    `SELECT id, codigo_barra, nombre, precio_venta, tipo_venta, existencia
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

  const turno = await turnoAbierto();
  if (!turno) {
    return res.status(400).json({ error: 'No hay una caja abierta. Ve a "Caja" para abrir el turno antes de vender.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let total = 0;
    const detalles = [];
    // Se bloquean los productos siempre en el mismo orden (por id) para que
    // dos ventas simultáneas con los mismos productos nunca se bloqueen
    // mutuamente en orden distinto (interbloqueo/deadlock).
    const itemsOrdenados = [...items].sort((a, b) => a.producto_id - b.producto_id);
    for (const item of itemsOrdenados) {
      const [[producto]] = await conn.query(
        'SELECT id, precio_venta, tipo_venta, existencia, nombre FROM productos WHERE id = ? FOR UPDATE',
        [item.producto_id]
      );
      if (!producto) throw new ValidationError(`Producto ${item.producto_id} no encontrado`);
      if (producto.existencia < item.cantidad) {
        const disponible = producto.tipo_venta === 'peso'
          ? `${(producto.existencia / 1000).toLocaleString('es-CL')} kg` : producto.existencia;
        throw new ValidationError(`Existencia insuficiente de "${producto.nombre}" (disponible: ${disponible})`);
      }
      // Para productos "por peso", precio_venta es por kilo y cantidad viene en gramos.
      const subtotal = producto.tipo_venta === 'peso'
        ? (Number(producto.precio_venta) / 1000) * item.cantidad
        : Number(producto.precio_venta) * item.cantidad;
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
      if (!cliente) throw new ValidationError('Cliente no encontrado');
      const nuevoSaldo = Number(cliente.saldo_pendiente) + total;
      if (cliente.limite_credito > 0 && nuevoSaldo > Number(cliente.limite_credito)) {
        throw new ValidationError(`El crédito supera el límite de "${cliente.nombre}"`);
      }
    }

    const cambio = tipo_pago === 'efectivo' && pagado_con != null
      ? Number(pagado_con) - total
      : null;
    if (tipo_pago === 'efectivo' && cambio < 0) {
      throw new ValidationError('El monto pagado es menor al total');
    }

    const [ventaResult] = await conn.query(
      `INSERT INTO ventas (cliente_id, usuario_id, turno_id, tipo_pago, total, pagado_con, cambio, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completada')`,
      [cliente_id || null, req.session.usuario.id, turno.id, tipo_pago, total, pagado_con || null, cambio]
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
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
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
    `SELECT vd.*, p.nombre AS producto_nombre, p.tipo_venta
     FROM venta_detalle vd JOIN productos p ON p.id = vd.producto_id
     WHERE vd.venta_id = ? ORDER BY vd.id`,
    [req.params.id]
  );
  res.render('ticket', { venta, detalle });
});

module.exports = router;
