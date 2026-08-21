const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const flow = require('../services/flow');
const email = require('../services/email');
const { generarCodigo } = require('../services/licencias');

const router = express.Router();

// Se agrega sola al arrancar, igual que las demás tablas de este panel
// (nadie corre migraciones a mano en producción).
pool.query(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    commerce_order VARCHAR(40) NOT NULL UNIQUE,
    producto VARCHAR(30) NOT NULL,
    monto INT NOT NULL,
    email_cliente VARCHAR(150) NOT NULL,
    flow_token VARCHAR(100),
    estado ENUM('pendiente','pagado','fallido') NOT NULL DEFAULT 'pendiente',
    codigo_generado VARCHAR(10),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pagado_en TIMESTAMP NULL
  )
`).catch((err) => console.error('No se pudo verificar la tabla "pedidos":', err.message));

// Precios de venta online (pago único = licencia indefinida), iguales a los
// publicados en creotuidea.cl. Solo Totem y AbarrotesPOS por ahora -- para
// sumar otro producto basta con agregar su fila aquí.
const PRECIOS = {
  totem: { nombre: 'Totem', monto: 300000 },
  abarrotes: { nombre: 'AbarrotesPOS', monto: 500000 }
};

function urlBase(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/comprar', (req, res) => {
  const producto = req.query.producto;
  const info = PRECIOS[producto];
  if (!info) return res.status(404).send('Ese producto todavía no está disponible para compra online.');
  res.render('comprar', { producto, info, error: null });
});

router.post('/api/pagos/crear', async (req, res) => {
  const producto = req.body.producto;
  const emailCliente = (req.body.email || '').trim();
  const info = PRECIOS[producto];
  if (!info) return res.status(400).send('Producto inválido.');
  if (!emailCliente || !emailCliente.includes('@')) {
    return res.render('comprar', { producto, info, error: 'Ingresa un correo válido.' });
  }

  const commerceOrder = `CTI-${Date.now()}-${crypto.randomInt(1000, 9999)}`;
  try {
    const { token, url } = await flow.crearOrden({
      commerceOrder,
      subject: `Licencia ${info.nombre} - CREA.TU.IDEA`,
      amount: info.monto,
      email: emailCliente,
      urlConfirmation: `${urlBase(req)}/api/pagos/confirmacion`,
      urlReturn: `${urlBase(req)}/pago-retorno`
    });
    await pool.query(
      'INSERT INTO pedidos (commerce_order, producto, monto, email_cliente, flow_token, estado) VALUES (?, ?, ?, ?, ?, "pendiente")',
      [commerceOrder, producto, info.monto, emailCliente, token]
    );
    res.redirect(url);
  } catch (err) {
    console.error('Error creando orden de pago:', err.message);
    res.render('comprar', { producto, info, error: 'No pudimos iniciar el pago. Intenta de nuevo en unos minutos.' });
  }
});

// Revisa el estado real en Flow y, si ya está pagado, genera el código y lo
// manda por correo. Se puede llamar más de una vez con el mismo token sin
// problema -- si el pedido ya quedó "pagado" la segunda vez no hace nada.
async function procesarConfirmacion(token) {
  const [[pedido]] = await pool.query('SELECT * FROM pedidos WHERE flow_token = ?', [token]);
  if (!pedido) throw new Error(`No existe ningún pedido con el token ${token}`);
  if (pedido.estado === 'pagado') return pedido;

  const estadoFlow = await flow.consultarEstado(token);
  const status = Number(estadoFlow.status);

  if (status === 2) {
    const codigo = await generarCodigo({
      producto: pedido.producto,
      duracion: 'indefinido',
      nota: `Compra online ${pedido.commerce_order}`
    });
    await pool.query(
      'UPDATE pedidos SET estado = "pagado", codigo_generado = ?, pagado_en = NOW() WHERE id = ?',
      [codigo, pedido.id]
    );
    const info = PRECIOS[pedido.producto] || { nombre: pedido.producto };
    await email.enviarCodigoLicencia({ to: pedido.email_cliente, nombreProducto: info.nombre, codigo });
    pedido.estado = 'pagado';
    pedido.codigo_generado = codigo;
  } else if (status === 3 || status === 4) {
    await pool.query('UPDATE pedidos SET estado = "fallido" WHERE id = ?', [pedido.id]);
    pedido.estado = 'fallido';
  }
  return pedido;
}

// Webhook servidor-a-servidor: Flow llama aquí cuando el pago cambia de
// estado. No tiene sesión de navegador ni token CSRF (ver RUTAS_PUBLICAS en
// middleware/csrf.js) -- Flow se autentica solo con el token que ya conoce.
router.post('/api/pagos/confirmacion', async (req, res) => {
  const token = req.body.token;
  if (!token) return res.status(400).send('Falta token');
  try {
    await procesarConfirmacion(token);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Error procesando confirmación de pago:', err.message);
    // 500 le dice a Flow que reintente más tarde en vez de darse por
    // enterado de algo que en realidad no se pudo procesar.
    res.status(500).send('Error');
  }
});

// Donde vuelve el navegador del cliente después de pagar (Flow lo manda acá,
// normalmente por POST). Se re-confirma por si el webhook todavía no llegó
// -- procesarConfirmacion es seguro de llamar dos veces.
async function mostrarRetorno(req, res) {
  const token = req.body.token || req.query.token;
  if (!token) return res.render('pago_retorno', { estado: 'error', codigo: null, nombreProducto: null });

  let pedido = null;
  try {
    pedido = await procesarConfirmacion(token);
  } catch (err) {
    console.error('Error en pago-retorno:', err.message);
    const [[fila]] = await pool.query('SELECT * FROM pedidos WHERE flow_token = ?', [token]);
    pedido = fila || null;
  }

  const info = pedido ? PRECIOS[pedido.producto] : null;
  res.render('pago_retorno', {
    estado: pedido ? pedido.estado : 'error',
    codigo: pedido ? pedido.codigo_generado : null,
    nombreProducto: info ? info.nombre : null
  });
}
router.post('/pago-retorno', mostrarRetorno);
router.get('/pago-retorno', mostrarRetorno);

module.exports = { router };
