const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { TEMAS } = require('../utils/temas');
const { uploadDir } = require('../middleware/subidaLogo');

const router = express.Router();

router.get('/configuracion', requireAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT nombre_local, logo, tema FROM configuracion WHERE id = 1');
  res.render('configuracion', { usuario: req.session.usuario, config: rows[0], temas: TEMAS, error: null, exito: null });
});

// El archivo (si se subió uno) ya viene parseado en req.file: lo procesa el
// middleware subirLogo, montado en server.js antes del chequeo de CSRF
// porque este es el único formulario en multipart/form-data del programa.
router.post('/configuracion', requireAdmin, async (req, res) => {
  if (req.errorLogo) {
    const [rows] = await pool.query('SELECT nombre_local, logo, tema FROM configuracion WHERE id = 1');
    return res.render('configuracion', { usuario: req.session.usuario, config: rows[0], temas: TEMAS, error: req.errorLogo, exito: null });
  }

  const nombreLocal = (req.body.nombre_local || '').trim();
  const tema = TEMAS[req.body.tema] ? req.body.tema : 'clasico';

  if (!nombreLocal) {
    const [rows] = await pool.query('SELECT nombre_local, logo, tema FROM configuracion WHERE id = 1');
    return res.render('configuracion', { usuario: req.session.usuario, config: rows[0], temas: TEMAS, error: 'El nombre del local no puede quedar vacío.', exito: null });
  }

  if (req.file) {
    const [rows] = await pool.query('SELECT logo FROM configuracion WHERE id = 1');
    const logoAnterior = rows[0] && rows[0].logo;
    await pool.query(
      'UPDATE configuracion SET nombre_local = ?, logo = ?, tema = ? WHERE id = 1',
      [nombreLocal, `/uploads/${req.file.filename}`, tema]
    );
    if (logoAnterior && logoAnterior.startsWith('/uploads/')) {
      fs.unlink(path.join(uploadDir, path.basename(logoAnterior)), () => {});
    }
  } else {
    await pool.query('UPDATE configuracion SET nombre_local = ?, tema = ? WHERE id = 1', [nombreLocal, tema]);
  }

  const [rows] = await pool.query('SELECT nombre_local, logo, tema FROM configuracion WHERE id = 1');
  res.render('configuracion', { usuario: req.session.usuario, config: rows[0], temas: TEMAS, error: null, exito: 'Datos del local actualizados.' });
});

module.exports = router;
