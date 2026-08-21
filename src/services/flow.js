const crypto = require('crypto');

// Sandbox por defecto a propósito: hasta que no se pase FLOW_API_URL a mano
// (con la URL de producción), cualquier pago que se intente cae en el
// entorno de pruebas de Flow, nunca cobra plata real por accidente.
const BASE_URL = process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api';

function credencialesListas() {
  return !!(process.env.FLOW_API_KEY && process.env.FLOW_SECRET_KEY);
}

// Flow firma concatenando "clave+valor" de cada parámetro (sin separadores),
// ordenados alfabéticamente por nombre de clave, y sacando el HMAC-SHA256
// de eso con el secretKey del comercio. Sin esto Flow rechaza la petición.
function firmar(params) {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha256', process.env.FLOW_SECRET_KEY).update(base).digest('hex');
}

async function crearOrden({ commerceOrder, subject, amount, email, urlConfirmation, urlReturn }) {
  if (!credencialesListas()) {
    throw new Error('Flow todavía no está configurado (faltan FLOW_API_KEY / FLOW_SECRET_KEY en el .env).');
  }
  const params = {
    apiKey: process.env.FLOW_API_KEY,
    commerceOrder,
    subject,
    currency: 'CLP',
    amount,
    email,
    urlConfirmation,
    urlReturn
  };
  const s = firmar(params);
  const resp = await fetch(`${BASE_URL}/payment/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, s })
  });
  const data = await resp.json();
  if (!resp.ok || !data.token || !data.url) {
    throw new Error(data.message || 'Flow rechazó la orden de pago.');
  }
  // Flow devuelve la URL base del formulario de pago por separado del token;
  // hay que pegarlos para tener el link real al que mandar al cliente.
  return { token: data.token, url: `${data.url}?token=${data.token}` };
}

// status de Flow: 1 pendiente, 2 pagada, 3 rechazada, 4 anulada.
async function consultarEstado(token) {
  if (!credencialesListas()) {
    throw new Error('Flow todavía no está configurado (faltan FLOW_API_KEY / FLOW_SECRET_KEY en el .env).');
  }
  const params = { apiKey: process.env.FLOW_API_KEY, token };
  const s = firmar(params);
  const qs = new URLSearchParams({ ...params, s });
  const resp = await fetch(`${BASE_URL}/payment/getStatus?${qs}`);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.message || 'No se pudo consultar el estado del pago en Flow.');
  }
  return data;
}

module.exports = { crearOrden, consultarEstado, credencialesListas };
