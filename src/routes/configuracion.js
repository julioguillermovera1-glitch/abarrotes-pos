const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const ValidationError = require('../utils/ValidationError');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const TIPOS_PERMITIDOS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico'
};

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = TIPOS_PERMITIDOS[file.mimetype] || path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!TIPOS_PERMITIDOS[file.mimetype]) {
      return cb(new ValidationError('El logo debe ser una imagen (PNG, JPG, GIF, WEBP o ICO).'));
    }
    cb(null, true);
  }
});

router.get('/configuracion', requireAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT nombre_local, logo FROM configuracion WHERE id = 1');
  res.render('configuracion', { usuario: req.session.usuario, config: rows[0], error: null, exito: null });
});

router.post('/configuracion', requireAdmin, (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err instanceof ValidationError) {
      return pool.query('SELECT nombre_local, logo FROM configuracion WHERE id = 1').then(([rows]) => {
        res.render('configuracion', { usuario: req.session.usuario, config: rows[0], error: err.message, exito: null });
      });
    }
    if (err) return next(err);
    next();
  });
}, async (req, res) => {
  const nombreLocal = (req.body.nombre_local || '').trim();
  if (!nombreLocal) {
    const [rows] = await pool.query('SELECT nombre_local, logo FROM configuracion WHERE id = 1');
    return res.render('configuracion', { usuario: req.session.usuario, config: rows[0], error: 'El nombre del local no puede quedar vacío.', exito: null });
  }

  if (req.file) {
    const [rows] = await pool.query('SELECT logo FROM configuracion WHERE id = 1');
    const logoAnterior = rows[0] && rows[0].logo;
    await pool.query(
      'UPDATE configuracion SET nombre_local = ?, logo = ? WHERE id = 1',
      [nombreLocal, `/uploads/${req.file.filename}`]
    );
    if (logoAnterior && logoAnterior.startsWith('/uploads/')) {
      fs.unlink(path.join(uploadDir, path.basename(logoAnterior)), () => {});
    }
  } else {
    await pool.query('UPDATE configuracion SET nombre_local = ? WHERE id = 1', [nombreLocal]);
  }

  const [rows] = await pool.query('SELECT nombre_local, logo FROM configuracion WHERE id = 1');
  res.render('configuracion', { usuario: req.session.usuario, config: rows[0], error: null, exito: 'Datos del local actualizados.' });
});

module.exports = router;
