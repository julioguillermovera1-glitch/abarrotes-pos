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
  if (licencia.activado) {
    const vigente = !licencia.expira_en || new Date(licencia.expira_en) > new Date();
    if (vigente) {
      // Aviso temprano si la licencia paga vence pronto (no aplica a las
      // indefinidas, esas no tienen expira_en).
      if (licencia.expira_en) {
        const diasParaVencer = Math.ceil((new Date(licencia.expira_en).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (diasParaVencer <= 14) res.locals.diasLicenciaRestantes = diasParaVencer;
      }
      return next();
    }

    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Tu licencia venció. Ve a "Licencia" para renovarla.' });
    }
    return res.redirect('/licencia');
  }

  const dias = diasRestantes(licencia.fecha_instalacion);
  res.locals.diasPruebaRestantes = dias;
  if (dias > 0) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'La prueba gratis de 7 días terminó. Ve a "Licencia" para activar el programa.' });
  }
  res.redirect('/licencia');
}

module.exports = { verificarLicencia };
