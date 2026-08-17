// Guarda las credenciales de sincronización obtenidas al canjear un código de
// emparejamiento, para no depender de editar el .env a mano.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'sync-config.json');

function leer() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function guardar(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Combina lo guardado por el asistente de emparejamiento con lo que venga en .env
// (el .env manda si ambos existen, útil para configuración manual/avanzada).
function obtenerConfig() {
  const archivo = leer() || {};
  return {
    localId: process.env.LOCAL_ID || archivo.local_id || null,
    localNombre: process.env.LOCAL_NOMBRE || archivo.local_nombre || null,
    centralUrl: process.env.CENTRAL_SYNC_URL || archivo.central_sync_url || null,
    syncSecret: process.env.SYNC_SECRET || archivo.sync_secret || null
  };
}

module.exports = { leer, guardar, obtenerConfig, CONFIG_PATH };
