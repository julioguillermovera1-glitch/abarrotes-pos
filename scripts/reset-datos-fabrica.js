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
