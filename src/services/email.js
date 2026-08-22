const nodemailer = require('nodemailer');

// El transportador se arma una sola vez y se reutiliza (nodemailer mantiene
// su propio pool de conexiones SMTP por dentro).
let transportador = null;

function obtenerTransportador() {
  if (!process.env.SMTP_HOST) return null;
  if (!transportador) {
    transportador = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transportador;
}

async function enviarCodigoLicencia({ to, nombreProducto, codigo }) {
  const t = obtenerTransportador();
  if (!t) {
    throw new Error('El correo todavía no está configurado (faltan las variables SMTP_* en el .env).');
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `Tu código de licencia de ${nombreProducto}`,
    text: [
      `¡Gracias por tu compra de ${nombreProducto}!`,
      '',
      `Tu código de licencia es: ${codigo}`,
      '',
      'Actívalo desde el programa, en la sección Licencia.',
      '',
      '— CREA·TU·IDEA'
    ].join('\n')
  });
}

// Mensajes del formulario de contacto de creotuidea.cl -- van a la bandeja
// "contactos@creotuidea.cl" (la que se usa para pedidos), con el correo del
// que escribe como "responder a" para poder contestarle directo.
async function enviarContacto({ nombre, emailCliente, telefono, cargo, rut, producto, mensaje }) {
  const t = obtenerTransportador();
  if (!t) {
    throw new Error('El correo todavía no está configurado (faltan las variables SMTP_* en el .env).');
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: 'contactos@creotuidea.cl',
    replyTo: emailCliente,
    subject: `Nuevo contacto de ${nombre}${producto ? ' — ' + producto : ''}`,
    text: [
      `Nombre: ${nombre}`,
      `Correo: ${emailCliente}`,
      telefono ? `Teléfono: ${telefono}` : null,
      cargo ? `Cargo en la empresa: ${cargo}` : null,
      rut ? `RUT de la empresa: ${rut}` : null,
      producto ? `Producto de interés: ${producto}` : null,
      '',
      'Mensaje:',
      mensaje
    ].filter(Boolean).join('\n')
  });
}

module.exports = { enviarCodigoLicencia, enviarContacto, correoListo: () => !!process.env.SMTP_HOST };
