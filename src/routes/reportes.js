const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/reportes', requireLogin, async (req, res) => {
  let { desde, hasta } = req.query;
  if (!desde || !hasta) {
    const [[hoy]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy");
    desde = desde || hoy.hoy;
    hasta = hasta || hoy.hoy;
  }

  const [[resumen]] = await pool.query(
    `SELECT COUNT(*) AS num_ventas, COALESCE(SUM(total),0) AS total_vendido
     FROM ventas WHERE estado='completada' AND DATE(creado_en) BETWEEN ? AND ?`,
    [desde, hasta]
  );

  const [ganancia] = await pool.query(
    `SELECT COALESCE(SUM(vd.subtotal - (p.precio_compra * vd.cantidad)), 0) AS ganancia
     FROM venta_detalle vd
     JOIN ventas v ON v.id = vd.venta_id
     JOIN productos p ON p.id = vd.producto_id
     WHERE v.estado='completada' AND DATE(v.creado_en) BETWEEN ? AND ?`,
    [desde, hasta]
  );

  const [masVendidos] = await pool.query(
    `SELECT p.nombre, SUM(vd.cantidad) AS cantidad_vendida, SUM(vd.subtotal) AS total
     FROM venta_detalle vd
     JOIN ventas v ON v.id = vd.venta_id
     JOIN productos p ON p.id = vd.producto_id
     WHERE v.estado='completada' AND DATE(v.creado_en) BETWEEN ? AND ?
     GROUP BY p.id ORDER BY cantidad_vendida DESC LIMIT 10`,
    [desde, hasta]
  );

  const [ventasPorDia] = await pool.query(
    `SELECT DATE_FORMAT(creado_en, '%Y-%m-%d') AS dia, COUNT(*) AS num_ventas, SUM(total) AS total
     FROM ventas WHERE estado='completada' AND DATE(creado_en) BETWEEN ? AND ?
     GROUP BY DATE(creado_en) ORDER BY dia`,
    [desde, hasta]
  );

  const [creditosPendientes] = await pool.query(
    `SELECT nombre, saldo_pendiente FROM clientes WHERE saldo_pendiente > 0 ORDER BY saldo_pendiente DESC`
  );

  const [cuentasPorPagar] = await pool.query(
    `SELECT p.nombre, SUM(f.saldo_pendiente) AS saldo_pendiente
     FROM facturas_proveedor f
     JOIN proveedores p ON p.id = f.proveedor_id
     WHERE f.estado = 'pendiente'
     GROUP BY p.id ORDER BY saldo_pendiente DESC`
  );

  const [bajoStock] = await pool.query(
    `SELECT nombre, existencia, stock_minimo FROM productos WHERE activo=1 AND existencia <= stock_minimo ORDER BY existencia ASC`
  );

  res.render('reportes', {
    usuario: req.session.usuario,
    desde, hasta,
    resumen,
    ganancia: ganancia[0].ganancia,
    masVendidos,
    ventasPorDia,
    creditosPendientes,
    cuentasPorPagar,
    bajoStock
  });
});

module.exports = router;
