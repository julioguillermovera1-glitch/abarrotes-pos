const pool = require('../db/pool');
const { obtenerConfig } = require('./syncConfig');

const INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MINUTES) || 20;
let activo = false;

async function construirResumen(localId, localNombre) {
  const [[ventasHoy]] = await pool.query(
    `SELECT COUNT(*) AS ventas_hoy_count, COALESCE(SUM(total),0) AS ventas_hoy_total
     FROM ventas WHERE estado='completada' AND DATE(creado_en) = CURDATE()`
  );

  const [topProductos] = await pool.query(
    `SELECT p.nombre, SUM(vd.cantidad) AS cantidad
     FROM venta_detalle vd
     JOIN ventas v ON v.id = vd.venta_id
     JOIN productos p ON p.id = vd.producto_id
     WHERE v.estado='completada' AND v.creado_en >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY p.id ORDER BY cantidad DESC LIMIT 5`
  );

  const [bajoStock] = await pool.query(
    `SELECT nombre, existencia, stock_minimo FROM productos
     WHERE activo=1 AND existencia <= stock_minimo ORDER BY existencia ASC LIMIT 20`
  );

  const [cuentasPorPagar] = await pool.query(
    `SELECT p.nombre AS proveedor, SUM(f.saldo_pendiente) AS saldo
     FROM facturas_proveedor f JOIN proveedores p ON p.id = f.proveedor_id
     WHERE f.estado='pendiente' GROUP BY p.id ORDER BY saldo DESC LIMIT 20`
  );
  const cuentasPorPagarTotal = cuentasPorPagar.reduce((s, c) => s + Number(c.saldo), 0);

  return {
    local_id: localId,
    local_nombre: localNombre,
    ventas_hoy_total: Number(ventasHoy.ventas_hoy_total),
    ventas_hoy_count: Number(ventasHoy.ventas_hoy_count),
    top_productos: topProductos.map(p => ({ nombre: p.nombre, cantidad: Number(p.cantidad) })),
    bajo_stock: bajoStock,
    cuentas_por_pagar_total: cuentasPorPagarTotal,
    cuentas_por_pagar: cuentasPorPagar.map(c => ({ proveedor: c.proveedor, saldo: Number(c.saldo) }))
  };
}

async function sincronizar() {
  const { localId, localNombre, centralUrl, syncSecret } = obtenerConfig();
  if (!localId || !centralUrl || !syncSecret) return; // aún no emparejado

  try {
    const resumen = await construirResumen(localId, localNombre);
    const res = await fetch(`${centralUrl.replace(/\/$/, '')}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': syncSecret },
      body: JSON.stringify(resumen)
    });
    if (!res.ok) {
      console.error(`Sync: el panel central respondió ${res.status}`);
    } else {
      console.log(`Sync: resumen enviado al panel central (${new Date().toLocaleTimeString('es-CL')})`);
    }
  } catch (err) {
    // Sin internet o el panel central no responde: no debe afectar la venta local.
    console.error('Sync: no se pudo conectar al panel central —', err.message);
  }
}

function start() {
  if (activo) return;
  const { localId, centralUrl, syncSecret } = obtenerConfig();
  if (!localId || !centralUrl || !syncSecret) {
    console.warn('Sync: este local todavía no está emparejado con un panel central (ver /setup-sync).');
    return;
  }
  activo = true;
  console.log(`Sync: activado hacia ${centralUrl} cada ${INTERVAL_MIN} min`);
  setTimeout(sincronizar, 10 * 1000);
  setInterval(sincronizar, INTERVAL_MIN * 60 * 1000);
}

module.exports = { start, sincronizar, construirResumen };
