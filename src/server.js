const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');

const app = express();
const APP_MODE = process.env.APP_MODE === 'central' ? 'central' : 'local';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

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
  const { router: cajaRoutes } = require('./routes/caja');

  app.get('/', (req, res) => res.redirect('/ventas'));
  app.use(authRoutes);
  app.use(ventasRoutes);
  app.use(inventarioRoutes);
  app.use(clientesRoutes);
  app.use(proveedoresRoutes);
  app.use(reportesRoutes);
  app.use(setupRoutes);
  app.use(usuariosRoutes);
  app.use(cajaRoutes);

  require('./services/sync').start();
}

app.use((req, res) => res.status(404).send('Página no encontrada'));

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Abarrotes POS (modo ${APP_MODE}) corriendo en http://localhost:${PORT}`);
});
