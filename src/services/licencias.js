const crypto = require('crypto');
const pool = require('../db/pool');

// meses: cuantos meses de licencia da cada duracion (null = indefinida).
// Compartido entre el generador manual del dashboard y el flujo de compra
// online, para que ambos produzcan codigos con las mismas reglas.
const MESES_POR_DURACION = { mes: 1, '1': 12, '5': 60, indefinido: null };

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusion

async function generarCodigo({ producto, duracion = 'indefinido', nota = null }) {
  if (!(duracion in MESES_POR_DURACION)) {
    throw new Error(`Duración inválida: ${duracion}`);
  }
  const meses = MESES_POR_DURACION[duracion];

  let code;
  let existe;
  do {
    code = Array.from({ length: 6 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
    [existe] = await pool.query('SELECT 1 FROM codigos_activacion WHERE code = ?', [code]);
  } while (existe.length > 0);

  await pool.query(
    'INSERT INTO codigos_activacion (code, nota, meses, producto) VALUES (?, ?, ?, ?)',
    [code, nota, meses, producto]
  );
  return code;
}

module.exports = { generarCodigo, MESES_POR_DURACION };
