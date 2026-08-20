const DIAS_PRUEBA = 7;

// URL fija del panel central (el mismo para todas las instalaciones): ahí se
// valida cada código de activación, así no se puede generar uno falso sin
// conocer el código real guardado en la base de datos del panel.
const CENTRAL_URL_DEFAULT = process.env.CENTRAL_URL_DEFAULT || 'https://panel.creotuidea.cl';

function diasRestantes(fechaInstalacion) {
  const transcurridos = (Date.now() - new Date(fechaInstalacion).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(DIAS_PRUEBA - transcurridos));
}

module.exports = { diasRestantes, DIAS_PRUEBA, CENTRAL_URL_DEFAULT };
