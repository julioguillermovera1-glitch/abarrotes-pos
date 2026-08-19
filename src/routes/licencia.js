const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');
const { diasRestantes, CENTRAL_URL_DEFAULT } = require('../utils/licencia');

const router = express.Router();

// Se asegura de que exista la fila de licencia (se crea la primera vez que
// arranca el programa, con un ID único e irrepetible para esta instalación).
async function obtenerOCrearLicencia() {
  const [[existente]] = await pool.query('SELECT * FROM licencia WHERE id = 1');
  if (existente) return existente;

  const instalacionId = crypto.randomBytes(8).toString('hex');
  await pool.query(
    'INSERT INTO licencia (id, instalacion_id) VALUES (1, ?) ON DUPLICATE KEY UPDATE id = id',
    [instalacionId]
  );
  const [[creada]] = await pool.query('SELECT * FROM licencia WHERE id = 1');
  return creada;
}

router.get('/licencia', requireLogin, async (req, res) => {
  const licencia = await obtenerOCrearLicencia();
  res.render('licencia', {
    usuario: req.session.usuario,
    licencia,
    dias: diasRestantes(licencia.fecha_instalacion),
    error: null
  });
});

// Valida el código contra el panel central (necesita internet en este
// momento): así no se puede generar un código falso sin conocer el real,
// a diferencia de una fórmula que el propio programa pudiera calcular solo.
router.post('/licencia/activar', requireLogin, async (req, res) => {
  const licencia = await obtenerOCrearLicencia();
  const codigo = (req.body.codigo || '').trim().toUpperCase();

  if (!codigo) {
    return res.render('licencia', {
      usuario: req.session.usuario,
      licencia,
      dias: diasRestantes(licencia.fecha_instalacion),
      error: 'Escribe el código de activación.'
    });
  }

  let data;
  try {
    const respuesta = await fetch(`${CENTRAL_URL_DEFAULT.replace(/\/$/, '')}/api/activar-licencia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codigo, instalacion_id: licencia.instalacion_id }),
      signal: AbortSignal.timeout(60 * 1000) // el panel gratis puede tardar en "despertar"
    });
    data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      return res.render('licencia', {
        usuario: req.session.usuario,
        licencia,
        dias: diasRestantes(licencia.fecha_instalacion),
        error: data.error || 'Ese código no es válido.'
      });
    }
  } catch (err) {
    return res.render('licencia', {
      usuario: req.session.usuario,
      licencia,
      dias: diasRestantes(licencia.fecha_instalacion),
      error: 'No se pudo conectar para activar. Este paso necesita internet — revisa la conexión e intenta de nuevo.'
    });
  }

  await pool.query('UPDATE licencia SET activado = 1, codigo_activacion = ? WHERE id = 1', [codigo]);
  res.redirect('/ventas');
});

module.exports = { router, obtenerOCrearLicencia };
