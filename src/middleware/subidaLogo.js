const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ValidationError = require('../utils/ValidationError');

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

// El formulario de Configuración sube un archivo (multipart/form-data), y
// eso necesita parsearse ANTES del chequeo de CSRF global (que lee
// req.body._csrf): si no, el cuerpo todavía no existe y el CSRF siempre
// rechaza la petición. Por eso esto se monta en server.js antes que el
// chequeo de CSRF, en vez de adentro de la ruta como cualquier otro POST.
// Los errores de tipo de archivo quedan en req.errorLogo para que la ruta
// los muestre con su propio mensaje, en vez de caer al manejador genérico.
function subirLogo(req, res, next) {
  if (req.method !== 'POST') return next();
  upload.single('logo')(req, res, (err) => {
    if (err instanceof ValidationError) {
      req.errorLogo = err.message;
      return next();
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { subirLogo, uploadDir };
