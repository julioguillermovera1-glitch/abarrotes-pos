const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

async function turnoAbierto() {
  const [[turno]] = await pool.query(
    `SELECT t.*, u.nombre AS usuario_nombre
     FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
     WHERE t.estado = 'abierto' ORDER BY t.abierto_en DESC LIMIT 1`
  );
  return turno || null;
}

router.get('/caja', requireLogin, async (req, res) => {
  const turno = await turnoAbierto();

  let ventasEfectivoTurno = 0;
  if (turno) {
    const [[r]] = await pool.query(
      `SELECT COALESCE(SUM(total),0) AS total FROM ventas
       WHERE turno_id = ? AND tipo_pago='efectivo' AND estado='completada'`,
      [turno.id]
    );
    ventasEfectivoTurno = Number(r.total);
  }

  const [historial] = await pool.query(
    `SELECT t.*, u.nombre AS usuario_nombre, uc.nombre AS usuario_cierre_nombre
     FROM turnos t
     JOIN usuarios u ON u.id = t.usuario_id
     LEFT JOIN usuarios uc ON uc.id = t.usuario_cierre_id
     WHERE t.estado = 'cerrado'
     ORDER BY t.cerrado_en DESC LIMIT 20`
  );

  res.render('caja', {
    usuario: req.session.usuario,
    turno,
    ventasEfectivoTurno,
    montoEsperado: turno ? Number(turno.monto_apertura) + ventasEfectivoTurno : 0,
    historial,
    error: null
  });
});

router.post('/caja/abrir', requireLogin, async (req, res) => {
  const existente = await turnoAbierto();
  if (existente) {
    return res.redirect('/caja');
  }
  const monto = Number(req.body.monto_apertura) || 0;
  await pool.query(
    'INSERT INTO turnos (usuario_id, monto_apertura) VALUES (?, ?)',
    [req.session.usuario.id, monto]
  );
  res.redirect('/caja');
});

router.post('/caja/cerrar', requireLogin, async (req, res) => {
  const turno = await turnoAbierto();
  if (!turno) return res.redirect('/caja');

  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(total),0) AS total FROM ventas
     WHERE turno_id = ? AND tipo_pago='efectivo' AND estado='completada'`,
    [turno.id]
  );
  const montoEsperado = Number(turno.monto_apertura) + Number(r.total);
  const montoCierre = Number(req.body.monto_cierre) || 0;
  const diferencia = montoCierre - montoEsperado;

  await pool.query(
    `UPDATE turnos SET estado='cerrado', cerrado_en=NOW(), usuario_cierre_id=?,
       monto_esperado=?, monto_cierre=?, diferencia=?
     WHERE id = ?`,
    [req.session.usuario.id, montoEsperado, montoCierre, diferencia, turno.id]
  );
  res.redirect('/caja');
});

module.exports = { router, turnoAbierto };
