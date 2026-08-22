const express = require('express');
const email = require('../services/email');

const router = express.Router();

// El formulario de contacto vive en creotuidea.cl (otro dominio, sin sesión
// ni token CSRF compartido) y hace un POST normal de navegador aquí -- por
// eso también queda en RUTAS_PUBLICAS en middleware/csrf.js.
router.post('/api/contacto', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const emailCliente = (req.body.email || '').trim();
  const producto = (req.body.producto || '').trim();
  const mensaje = (req.body.mensaje || '').trim();

  if (!nombre || !emailCliente || !mensaje) {
    return res.render('contacto_gracias', { error: 'Faltan datos obligatorios. Vuelve atrás e inténtalo de nuevo.' });
  }

  try {
    await email.enviarContacto({ nombre, emailCliente, producto, mensaje });
    res.render('contacto_gracias', { error: null });
  } catch (err) {
    console.error('Error enviando mensaje de contacto:', err.message);
    res.render('contacto_gracias', { error: 'No pudimos enviar tu mensaje. Escríbenos directo a contactos@creotuidea.cl' });
  }
});

module.exports = { router };
