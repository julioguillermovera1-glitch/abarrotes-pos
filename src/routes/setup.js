const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { guardar, obtenerConfig } = require('../services/syncConfig');
const sync = require('../services/sync');

const router = express.Router();

// URL del panel central por defecto (se puede sobreescribir en la pantalla si hiciera falta).
const CENTRAL_URL_DEFAULT = process.env.CENTRAL_URL_DEFAULT || 'https://ventaslocalconcepcion.onrender.com';

router.get('/setup-sync', requireLogin, (req, res) => {
  const config = obtenerConfig();
  res.render('setup_sync', {
    usuario: req.session.usuario,
    conectado: !!(config.localId && config.centralUrl && config.syncSecret),
    config,
    centralUrlDefault: CENTRAL_URL_DEFAULT,
    error: null,
    ok: null
  });
});

router.post('/setup-sync', requireLogin, async (req, res) => {
  const codigo = (req.body.codigo || '').trim().toUpperCase();
  const centralUrl = (req.body.central_url || CENTRAL_URL_DEFAULT).trim();
  const config = obtenerConfig();

  const render = (error, ok) => res.render('setup_sync', {
    usuario: req.session.usuario,
    conectado: !!(config.localId && config.centralUrl && config.syncSecret),
    config, centralUrlDefault: CENTRAL_URL_DEFAULT, error, ok
  });

  if (!codigo) return render('Ingresa el código del panel central', null);

  try {
    const resp = await fetch(`${centralUrl.replace(/\/$/, '')}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codigo })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return render(data.error || 'No se pudo emparejar', null);
    }

    guardar({
      local_id: data.local_id,
      local_nombre: data.local_nombre,
      central_sync_url: centralUrl,
      sync_secret: data.sync_secret
    });
    sync.start();

    const nuevoConfig = obtenerConfig();
    res.render('setup_sync', {
      usuario: req.session.usuario,
      conectado: true,
      config: nuevoConfig,
      centralUrlDefault: CENTRAL_URL_DEFAULT,
      error: null,
      ok: `Conectado como "${data.local_nombre}". La sincronización ya está activa.`
    });
  } catch (err) {
    render('No se pudo conectar al panel central: ' + err.message, null);
  }
});

module.exports = router;
