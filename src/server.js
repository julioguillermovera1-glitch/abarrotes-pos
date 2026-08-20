const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('express-async-errors'); // hace que los errores en rutas async caigan al manejador de errores en vez de tumbar el proceso
const express = require('express');
const session = require('express-session');
const { emitirToken, verificarToken } = require('./middleware/csrf');

const app = express();
const APP_MODE = process.env.APP_MODE === 'central' ? 'central' : 'local';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (APP_MODE === 'central') {
  // Render (y proxys similares) terminan el HTTPS antes de llegar a la app;
  // sin esto, la cookie "secure" nunca se marcaría como enviada por HTTPS.
  app.set('trust proxy', 1);

  // El panel central sirve páginas con sesión (login, dashboard) detrás de un
  // proxy/caché (Render, o el NGINX caching de un hosting compartido). Sin
  // esto, un proxy puede guardar una respuesta con la cookie de sesión de
  // OTRA persona y devolvérsela a todos los visitantes siguientes hasta que
  // alguien limpie el caché a mano — ya pasó una vez. No depender de que
  // nadie se acuerde de limpiar el caché.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: APP_MODE === 'central' // en local se sirve por http://localhost, no tiene TLS
  }
}));

// El formulario de Configuración (nombre/logo/color del local) es el único
// que sube un archivo, así que necesita parsearse antes del chequeo de CSRF
// de abajo (ver middleware/subidaLogo.js para el porqué).
if (APP_MODE !== 'central') {
  app.use('/configuracion', require('./middleware/subidaLogo').subirLogo);
}

app.use(emitirToken);
app.use(verificarToken);
app.use((req, res, next) => {
  res.locals.passwordPorDefecto = !!req.session.passwordPorDefecto;
  next();
});

// Formato de moneda para Chile (CLP): sin decimales, puntos de miles.
app.locals.moneyCL = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');

if (APP_MODE === 'central') {
  // Panel central: solo dashboard de solo lectura + API de sincronización.
  // No monta el POS (ventas/inventario/etc.) para mantenerse liviano.
  const { router: centralRoutes } = require('./routes/central');
  app.get('/', (req, res) => res.redirect('/dashboard'));
  app.use(centralRoutes);
} else {
  // Modo local: el POS completo, tal como corre en cada local.
  const authRoutes = require('./routes/auth');
  const ventasRoutes = require('./routes/ventas');
  const inventarioRoutes = require('./routes/inventario');
  const clientesRoutes = require('./routes/clientes');
  const proveedoresRoutes = require('./routes/proveedores');
  const reportesRoutes = require('./routes/reportes');
  const setupRoutes = require('./routes/setup');
  const usuariosRoutes = require('./routes/usuarios');
  const configuracionRoutes = require('./routes/configuracion');
  const { router: licenciaRoutes } = require('./routes/licencia');
  const { verificarLicencia } = require('./middleware/licencia');
  const { router: cajaRoutes } = require('./routes/caja');
  const pool = require('./db/pool');
  const { obtenerTema } = require('./utils/temas');

  // Instalaciones hechas antes de que existiera el selector de color no
  // tienen esta columna todavía. Se agrega sola al arrancar (no hace nada
  // si ya existe), para no depender de que alguien corra una migración a
  // mano en cada local.
  pool.query("ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS tema VARCHAR(30) NOT NULL DEFAULT 'clasico'")
    .catch(err => console.error('No se pudo verificar la columna "tema":', err.message));

  // Nombre, logo y color del local: se muestran en el login, el menú y el
  // ticket, así el mismo programa sirve para cualquier tipo de negocio.
  app.use(async (req, res, next) => {
    const [rows] = await pool.query('SELECT nombre_local, logo, tema FROM configuracion WHERE id = 1');
    const config = rows[0] || {};
    res.locals.nombreLocal = config.nombre_local || 'Mi Negocio';
    res.locals.logoLocal = config.logo || '/img/icon.ico';
    res.locals.tema = obtenerTema(config.tema);
    next();
  });

  app.get('/', (req, res) => res.redirect('/ventas'));
  app.use(authRoutes);
  app.use(licenciaRoutes);
  app.use(verificarLicencia);
  app.use(ventasRoutes);
  app.use(inventarioRoutes);
  app.use(clientesRoutes);
  app.use(proveedoresRoutes);
  app.use(reportesRoutes);
  app.use(setupRoutes);
  app.use(usuariosRoutes);
  app.use(configuracionRoutes);
  app.use(cajaRoutes);

  require('./services/sync').start();
}

app.use((req, res) => res.status(404).send('Página no encontrada'));

// Manejador de errores global: cualquier excepción que se escape de una ruta
// (incluidas las async, gracias a express-async-errors) termina aquí en vez
// de tumbar el proceso. Al usuario nunca se le muestra el detalle interno.
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  const esApi = req.path.startsWith('/api/');
  const mensaje = 'Ocurrió un error inesperado. Intenta de nuevo.';
  if (esApi) {
    res.status(500).json({ error: mensaje });
  } else {
    res.status(500).send(mensaje);
  }
});

// Última red de seguridad: si algo se escapa fuera del ciclo de una petición
// (por ejemplo en el servicio de sincronización), se registra pero no se
// tumba el proceso — más vale seguir vendiendo que reiniciar a medio día.
process.on('unhandledRejection', (err) => console.error('Promesa no manejada:', err));
process.on('uncaughtException', (err) => console.error('Excepción no capturada:', err));

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Abarrotes POS (modo ${APP_MODE}) corriendo en http://localhost:${PORT}`);
});
