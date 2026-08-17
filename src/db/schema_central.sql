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
