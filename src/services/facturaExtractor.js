const fs = require('fs');
const path = require('path');

// Extrae texto crudo de un PDF o imagen de factura.
async function extraerTexto(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const resultado = await parser.getText();
      return resultado.text;
    } finally {
      await parser.destroy();
    }
  }

  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext)) {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('spa');
    try {
      const { data } = await worker.recognize(filePath);
      return data.text;
    } finally {
      await worker.terminate();
    }
  }

  throw new Error('Formato no soportado. Sube un PDF o una imagen (jpg, png).');
}

// Heurísticas para extraer los campos clave de una factura de proveedor.
// Esto es un "mejor esfuerzo": siempre debe revisarse antes de guardar.
function extraerCampos(texto) {
  const limpio = texto.replace(/\r/g, '');
  const lineas = limpio.split('\n').map(l => l.trim()).filter(Boolean);

  const resultado = {
    proveedor_nombre: null,
    numero_factura: null,
    fecha_factura: null,
    monto: null,
    texto_crudo: texto
  };

  // --- Monto total ---
  // Busca todas las ocurrencias de "total" seguidas de un monto; usa la última
  // (normalmente subtotal/IVA aparecen antes que el total final).
  const montoRegex = /total[^\d$]{0,15}\$?\s*([\d]{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{2})?)/gi;
  let match;
  let ultimoMonto = null;
  while ((match = montoRegex.exec(limpio)) !== null) {
    ultimoMonto = match[1];
  }
  if (ultimoMonto) {
    const numero = Number(ultimoMonto.replace(/[,\s]/g, '').replace(/\.(?=\d{3}(?:\D|$))/, ''));
    resultado.monto = isNaN(numero) ? null : numero;
  }
  if (resultado.monto == null) {
    // Alternativa: el monto con formato de dinero más grande del documento
    const montos = [...limpio.matchAll(/\$\s*([\d]{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{2}))/g)]
      .map(m => Number(m[1].replace(/[,\s]/g, '')))
      .filter(n => !isNaN(n));
    if (montos.length) resultado.monto = Math.max(...montos);
  }

  // --- Fecha ---
  const fechaISO = limpio.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  const fechaDMY = limpio.match(/\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](20\d{2})\b/);
  if (fechaISO) {
    resultado.fecha_factura = `${fechaISO[1]}-${fechaISO[2].padStart(2, '0')}-${fechaISO[3].padStart(2, '0')}`;
  } else if (fechaDMY) {
    resultado.fecha_factura = `${fechaDMY[3]}-${fechaDMY[2].padStart(2, '0')}-${fechaDMY[1].padStart(2, '0')}`;
  }

  // --- Número de factura / folio ---
  // Solo etiquetas específicas (no la palabra suelta "factura", que suele
  // aparecer en frases como "FACTURA ELECTRONICA" y produce falsos positivos).
  const folioMatch = limpio.match(/(?:folio|n[uú]mero de factura|no\.?\s*factura|serie[\s-]*folio)\s*[:#-]?\s*([A-Z0-9-]{1,20})/i);
  if (folioMatch && /\d/.test(folioMatch[1])) {
    resultado.numero_factura = folioMatch[1];
  }

  // --- Nombre del proveedor (emisor) ---
  const emisorMatch = limpio.match(/(?:emisor|proveedor|raz[oó]n social)\s*[:\-]?\s*(.+)/i);
  if (emisorMatch) {
    resultado.proveedor_nombre = emisorMatch[1].split(/\s{2,}|\t/)[0].trim().slice(0, 150);
  } else if (lineas.length) {
    // Si no hay etiqueta explícita, se asume que el nombre de la empresa
    // suele estar en las primeras líneas del documento.
    resultado.proveedor_nombre = lineas[0].slice(0, 150);
  }

  return resultado;
}

async function procesarFactura(filePath) {
  const texto = await extraerTexto(filePath);
  return extraerCampos(texto);
}

module.exports = { procesarFactura, extraerCampos, extraerTexto };
