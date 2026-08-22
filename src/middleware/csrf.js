const crypto = require('crypto');

// Protección CSRF simple basada en un token por sesión: se genera una vez,
// se manda en cada formulario (campo oculto _csrf) o header X-CSRF-Token
// para las llamadas fetch, y se valida en cada POST/PUT/DELETE.

function emitirToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

// Rutas que reciben peticiones de otros servidores (no de un navegador con
// sesión), autenticadas por su propio mecanismo (clave de sincronización,
// código de emparejamiento). No tiene sentido pedirles token CSRF.
// /api/pagos/confirmacion es el webhook que llama Flow servidor-a-servidor
// cuando un pago cambia de estado -- tampoco trae sesión de navegador.
// /pago-retorno tampoco: Flow manda ahí el navegador del cliente con un POST
// propio (sin nuestro token) cuando termina de pagar.
// /api/contacto recibe el formulario de contacto desde creotuidea.cl (otro
// dominio, sin sesión compartida con este panel).
const RUTAS_PUBLICAS = ['/api/sync', '/api/pair', '/api/activar-licencia', '/api/pagos/confirmacion', '/pago-retorno', '/api/contacto'];

function verificarToken(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (RUTAS_PUBLICAS.includes(req.path)) return next();

  const enviado = req.body._csrf || req.headers['x-csrf-token'];
  if (!enviado || enviado !== req.session.csrfToken) {
    return res.status(403).send('Sesión inválida o expirada, vuelve a cargar la página e intenta de nuevo.');
  }
  next();
}

module.exports = { emitirToken, verificarToken };
