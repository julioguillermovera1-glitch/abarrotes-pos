const { obtenerOCrearLicencia } = require('../routes/licencia');
const { diasRestantes } = require('../utils/licencia');

const RUTAS_LIBRES = ['/licencia', '/licencia/activar', '/login', '/logout', '/recuperar'];

// Bloquea todo el programa (menos la pantalla de activación, el login y la
// recuperación de contraseña) una vez que pasan los 7 días de prueba, hasta
// que se ingrese un código válido.
async function verificarLicencia(req, res, next) {
  if (
    RUTAS_LIBRES.includes(req.path) ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/img/') ||
    req.path.startsWith('/uploads/')
  ) {
    return next();
  }

  const licencia = await obtenerOCrearLicencia();
  if (licencia.activado) return next();

  const dias = diasRestantes(licencia.fecha_instalacion);
  res.locals.diasPruebaRestantes = dias;
  if (dias > 0) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'La prueba gratis de 7 días terminó. Ve a "Licencia" para activar el programa.' });
  }
  res.redirect('/licencia');
}

module.exports = { verificarLicencia };
