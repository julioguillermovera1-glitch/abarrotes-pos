require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const passwordHash = bcrypt.hashSync('admin123', 10);

  await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol)
     VALUES ('Administrador', 'admin', ?, 'admin')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [passwordHash]
  );

  const categorias = ['Abarrotes', 'Bebidas', 'Lácteos', 'Limpieza', 'Botanas'];
  for (const nombre of categorias) {
    await pool.query('INSERT IGNORE INTO categorias (nombre) VALUES (?)', [nombre]);
  }

  const [cats] = await pool.query('SELECT id, nombre FROM categorias');
  const catId = (nombre) => cats.find(c => c.nombre === nombre).id;

  const productos = [
    ['7501000111116', 'Arroz 1kg', 'Abarrotes', 1200, 1590, 50, 10],
    ['7501000222227', 'Frijol 1kg', 'Abarrotes', 1400, 1890, 40, 10],
    ['7501000333338', 'Aceite 1L', 'Abarrotes', 2200, 2990, 30, 8],
    ['7501000444449', 'Coca-Cola 600ml', 'Bebidas', 800, 1200, 60, 15],
    ['7501000555550', 'Agua 1L', 'Bebidas', 400, 700, 80, 20],
    ['7501000666661', 'Leche 1L', 'Lácteos', 900, 1290, 25, 10],
    ['7501000777772', 'Queso panela 400g', 'Lácteos', 2500, 3490, 15, 5],
    ['7501000888883', 'Jabón de trastes', 'Limpieza', 700, 1090, 35, 10],
    ['7501000999994', 'Papel higiénico x4', 'Limpieza', 1800, 2490, 20, 5],
    ['7501001000005', 'Papas fritas 45g', 'Botanas', 500, 890, 45, 15]
  ];

  for (const [codigo, nombre, cat, compra, venta, existencia, minimo] of productos) {
    await pool.query(
      `INSERT INTO productos (codigo_barra, nombre, categoria_id, precio_compra, precio_venta, existencia, stock_minimo)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)`,
      [codigo, nombre, catId(cat), compra, venta, existencia, minimo]
    );
  }

  await pool.query(
    `INSERT IGNORE INTO clientes (id, nombre, telefono, limite_credito) VALUES (1, 'Cliente Mostrador', NULL, 0)`
  );

  console.log('Datos iniciales creados: usuario admin / admin123');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
