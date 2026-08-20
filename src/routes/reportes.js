const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Comparten las mismas consultas la pantalla de Reportes y la descarga en
// Excel, para que lo que se ve en pantalla y lo que se descarga siempre
// coincidan exactamente (mismo rango de fechas, mismos numeros).
async function obtenerDatosReporte(desde, hasta) {
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

  return {
    resumen,
    ganancia: ganancia[0].ganancia,
    masVendidos,
    ventasPorDia,
    creditosPendientes,
    cuentasPorPagar,
    bajoStock
  };
}

function hexToArgb(hex) {
  return 'FF' + hex.replace('#', '').toUpperCase();
}

// Pinta el encabezado de una hoja con el color primario del tema (texto
// blanco) y el resto de las filas con el color de fondo suave del mismo
// tema, para que el Excel descargado se vea igual de "vestido" que la
// pantalla de Reportes.
function estilizarHoja(sheet, tema) {
  const rellenoHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(tema.primario) } };
  const rellenoCuerpo = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(tema.fondo) } };

  sheet.getRow(1).eachCell(celda => {
    celda.fill = rellenoHeader;
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  for (let i = 2; i <= sheet.rowCount; i++) {
    sheet.getRow(i).eachCell(celda => { celda.fill = rellenoCuerpo; });
  }
}

async function fechasPorDefecto(desde, hasta) {
  if (!desde || !hasta) {
    const [[hoy]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy");
    desde = desde || hoy.hoy;
    hasta = hasta || hoy.hoy;
  }
  return { desde, hasta };
}

router.get('/reportes', requireAdmin, async (req, res) => {
  const { desde, hasta } = await fechasPorDefecto(req.query.desde, req.query.hasta);
  const datos = await obtenerDatosReporte(desde, hasta);
  res.render('reportes', { usuario: req.session.usuario, desde, hasta, ...datos });
});

// Descarga el mismo reporte que se ve en pantalla, en un archivo Excel con
// una hoja por sección — asi se puede filtrar/ordenar/graficar en Excel sin
// tener que copiar los datos a mano desde la pagina.
router.get('/reportes/excel', requireAdmin, async (req, res) => {
  const { desde, hasta } = await fechasPorDefecto(req.query.desde, req.query.hasta);
  const { resumen, ganancia, masVendidos, ventasPorDia, creditosPendientes, cuentasPorPagar, bajoStock } =
    await obtenerDatosReporte(desde, hasta);
  const tema = res.locals.tema;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Abarrotes POS';
  wb.created = new Date();

  const resumenSheet = wb.addWorksheet('Resumen');
  resumenSheet.columns = [{ header: 'Indicador', key: 'k', width: 28 }, { header: 'Valor', key: 'v', width: 20 }];
  resumenSheet.addRows([
    { k: 'Rango', v: `${desde} a ${hasta}` },
    { k: 'Número de ventas', v: resumen.num_ventas },
    { k: 'Total vendido', v: Number(resumen.total_vendido) },
    { k: 'Ganancia estimada', v: Number(ganancia) }
  ]);
  estilizarHoja(resumenSheet, tema);

  const ventasSheet = wb.addWorksheet('Ventas por día');
  ventasSheet.columns = [
    { header: 'Fecha', key: 'dia', width: 14 },
    { header: 'N.º de ventas', key: 'num_ventas', width: 14 },
    { header: 'Total', key: 'total', width: 16 }
  ];
  ventasPorDia.forEach(v => ventasSheet.addRow({ dia: v.dia, num_ventas: v.num_ventas, total: Number(v.total) }));
  estilizarHoja(ventasSheet, tema);

  const productosSheet = wb.addWorksheet('Más vendidos');
  productosSheet.columns = [
    { header: 'Producto', key: 'nombre', width: 30 },
    { header: 'Cantidad vendida', key: 'cantidad_vendida', width: 16 },
    { header: 'Total', key: 'total', width: 16 }
  ];
  masVendidos.forEach(p => productosSheet.addRow({ nombre: p.nombre, cantidad_vendida: Number(p.cantidad_vendida), total: Number(p.total) }));
  estilizarHoja(productosSheet, tema);

  const creditosSheet = wb.addWorksheet('Créditos pendientes');
  creditosSheet.columns = [{ header: 'Cliente', key: 'nombre', width: 30 }, { header: 'Saldo pendiente', key: 'saldo', width: 18 }];
  creditosPendientes.forEach(c => creditosSheet.addRow({ nombre: c.nombre, saldo: Number(c.saldo_pendiente) }));
  estilizarHoja(creditosSheet, tema);

  const proveedoresSheet = wb.addWorksheet('Cuentas por pagar');
  proveedoresSheet.columns = [{ header: 'Proveedor', key: 'nombre', width: 30 }, { header: 'Saldo pendiente', key: 'saldo', width: 18 }];
  cuentasPorPagar.forEach(c => proveedoresSheet.addRow({ nombre: c.nombre, saldo: Number(c.saldo_pendiente) }));
  estilizarHoja(proveedoresSheet, tema);

  const stockSheet = wb.addWorksheet('Bajo stock');
  stockSheet.columns = [
    { header: 'Producto', key: 'nombre', width: 30 },
    { header: 'Existencia', key: 'existencia', width: 14 },
    { header: 'Mínimo', key: 'stock_minimo', width: 14 }
  ];
  bajoStock.forEach(p => stockSheet.addRow({ nombre: p.nombre, existencia: Number(p.existencia), stock_minimo: Number(p.stock_minimo) }));
  estilizarHoja(stockSheet, tema);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Reporte_${desde}_a_${hasta}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
