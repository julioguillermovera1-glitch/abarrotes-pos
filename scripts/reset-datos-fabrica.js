// Borra todos los datos de prueba/uso de un local (productos, ventas, clientes,
// vendedoras, turnos, categorías, proveedores) y deja una única cuenta
// administrador con las credenciales por defecto, lista para entregar a un
// cliente nuevo como instalación limpia.
//
// Uso:  node scripts/reset-datos-fabrica.js --confirmar
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');

async function main() {
  if (!process.argv.includes('--confirmar')) {
    console.log('Esto borra TODOS los datos (productos, ventas, clientes, usuarios, turnos, etc).');
    console.log('Vuelve a ejecutar con --confirmar si estás seguro:');
    console.log('  node scripts/reset-datos-fabrica.js --confirmar');
    process.exit(1);
  }

  // Freno de seguridad: si esta base ya tiene bastante actividad, probablemente
  // es una tienda real en uso y no una instalación de prueba — exige --forzar
  // además de --confirmar para no borrar por error el negocio de un cliente.
  const [[{ n: numVentas }]] = await pool.query('SELECT COUNT(*) AS n FROM ventas');
  const [[{ n: numProductos }]] = await pool.query('SELECT COUNT(*) AS n FROM productos');
  const parececonDatosReales = numVentas > 3 || numProductos > 5;
  if (parececonDatosReales && !process.argv.includes('--forzar')) {
    console.log(`¡Atención! Esta base ya tiene ${numVentas} ventas y ${numProductos} productos —`);
    console.log('no parece una instalación de prueba recién armada. Si de verdad quieres borrar');
    console.log('TODO esto, vuelve a ejecutar agregando también --forzar:');
    console.log('  node scripts/reset-datos-fabrica.js --confirmar --forzar');
    process.exit(1);
  }

  const tablas = [
    'venta_detalle',
    'abonos_credito',
    'movimientos_inventario',
    'pagos_proveedor',
    'facturas_proveedor',
    'ventas',
    'turnos',
    'productos',
    'clientes',
    'proveedores',
    'categorias'
  ];

  for (const tabla of tablas) {
    await pool.query(`DELETE FROM ${tabla}`);
    await pool.query(`ALTER TABLE ${tabla} AUTO_INCREMENT = 1`);
    console.log(`Vaciada: ${tabla}`);
  }

  await pool.query('DELETE FROM usuarios');
  await pool.query('ALTER TABLE usuarios AUTO_INCREMENT = 1');
  const passwordHash = bcrypt.hashSync('admin123', 10);
  await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Administrador', 'admin', ?, 'admin')`,
    [passwordHash]
  );
  console.log('Vaciada: usuarios (queda solo admin / admin123)');

  console.log('\nListo. Instalación en blanco, lista para entregar.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
