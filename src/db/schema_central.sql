-- Esquema del panel CENTRAL (nube): un resumen ligero por local, siempre
-- sobrescrito (upsert), nunca se acumula historial línea por línea.
-- Pensado para caber cómodo en un plan gratis de unos pocos MB.

CREATE TABLE IF NOT EXISTS local_status (
  local_id VARCHAR(50) PRIMARY KEY,
  local_nombre VARCHAR(150) NOT NULL,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ventas_hoy_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  ventas_hoy_count INT NOT NULL DEFAULT 0,
  top_productos JSON,
  bajo_stock JSON,
  cuentas_por_pagar_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  cuentas_por_pagar JSON
);

CREATE TABLE IF NOT EXISTS central_admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL
);

-- Códigos de emparejamiento de un solo uso, estilo "agregar cámara" de Dahua:
-- el panel genera un código corto + QR, el local nuevo lo canjea una vez.
CREATE TABLE IF NOT EXISTS pairing_codes (
  code VARCHAR(10) PRIMARY KEY,
  local_nombre_sugerido VARCHAR(150) NOT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expira_en TIMESTAMP NOT NULL,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  local_id VARCHAR(50),
  sync_secret VARCHAR(64)
);

-- Credenciales por local, entregadas al canjear un código de emparejamiento.
CREATE TABLE IF NOT EXISTS local_credentials (
  local_id VARCHAR(50) PRIMARY KEY,
  secret VARCHAR(64) NOT NULL,
  local_nombre VARCHAR(150) NOT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Códigos de activación (de un solo uso) para desbloquear un local después
-- de los 7 días de prueba gratis. El local necesita internet en el momento
-- de activar: el código se valida aquí, no con una fórmula local, para que
-- no se pueda generar uno falso sin conocer el código real.
CREATE TABLE IF NOT EXISTS codigos_activacion (
  code VARCHAR(10) PRIMARY KEY,
  nota VARCHAR(150),
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  instalacion_id VARCHAR(32),
  usado_en TIMESTAMP NULL
);
