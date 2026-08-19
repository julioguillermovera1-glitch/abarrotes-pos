const venta = []; // {producto_id, nombre, precio_venta, tipo_venta, cantidad, existencia}

function moneyCL(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
}

const inicioVenta = document.getElementById('inicioVenta');
const ventaActiva = document.getElementById('ventaActiva');
const escanearInput = document.getElementById('escanearProducto');
const resultadosDiv = document.getElementById('resultados');
const mensajeEscaneo = document.getElementById('mensajeEscaneo');
const ventaBody = document.getElementById('ventaBody');
const totalVentaEl = document.getElementById('totalVenta');
const pagadoConEl = document.getElementById('pagadoCon');
const cambioVentaEl = document.getElementById('cambioVenta');
const mensajeVenta = document.getElementById('mensajeVenta');
const clienteBox = document.getElementById('clienteBox');
const efectivoBox = document.getElementById('efectivoBox');

let ultimosResultados = [];
let debounceTimer;

// --- "+ Nueva venta": revela la zona de trabajo (escaneo + venta) ---
document.getElementById('btnNuevaVenta').addEventListener('click', () => {
  inicioVenta.style.display = 'none';
  ventaActiva.style.display = 'flex';
  escanearInput.focus();
});

document.getElementById('btnCancelarVenta').addEventListener('click', () => {
  if (venta.length > 0 && !confirm('¿Cancelar esta venta? Se perderán los productos agregados.')) return;
  volverAlInicio();
});

function volverAlInicio() {
  venta.length = 0;
  renderVenta();
  pagadoConEl.value = '';
  escanearInput.value = '';
  resultadosDiv.innerHTML = '';
  mensajeVenta.style.display = 'none';
  mensajeEscaneo.style.display = 'none';
  ventaActiva.style.display = 'none';
  inicioVenta.style.display = 'flex';
}

escanearInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = escanearInput.value.trim();
  if (!q) { resultadosDiv.innerHTML = ''; ultimosResultados = []; return; }
  debounceTimer = setTimeout(async () => {
    const res = await fetch(`/api/productos/buscar?q=${encodeURIComponent(q)}`);
    ultimosResultados = await res.json();
    renderResultados(ultimosResultados);
  }, 200);
});

// El corazón del flujo de caja: escanear (o escribir) el código y presionar Enter
// agrega el producto de inmediato, sin necesidad de hacer clic en nada.
escanearInput.addEventListener('keydown', async (ev) => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  const codigo = escanearInput.value.trim();
  if (!codigo) return;

  // 1) Intenta coincidencia exacta por código de barra (caso normal: lectora de código de barra)
  const resExacto = await fetch(`/api/productos/codigo/${encodeURIComponent(codigo)}`);
  if (resExacto.ok) {
    const producto = await resExacto.json();
    agregarAVenta(producto);
    return;
  }

  // 2) Si no hay coincidencia exacta pero la búsqueda por nombre dejó un solo resultado, se usa ese
  if (ultimosResultados.length === 1) {
    agregarAVenta(ultimosResultados[0]);
    return;
  }
  if (ultimosResultados.length > 1) {
    mostrarMensajeEscaneo('Hay varios productos que coinciden, elige uno de la lista', 'error');
    return;
  }

  mostrarMensajeEscaneo(`No se encontró ningún producto con "${codigo}"`, 'error');
});

function renderResultados(productos) {
  if (productos.length === 0) {
    resultadosDiv.innerHTML = '<div class="resultado-vacio">Sin resultados</div>';
    return;
  }
  resultadosDiv.innerHTML = productos.map(p => `
    <div class="resultado-item" data-id="${p.id}">
      <span>${p.nombre}</span>
      <span>${moneyCL(p.precio_venta)}${p.tipo_venta === 'peso' ? ' /kg' : ''}</span>
      <span class="existencia">Stock: ${p.tipo_venta === 'peso' ? (p.existencia/1000).toLocaleString('es-CL', {maximumFractionDigits:2}) + ' kg' : p.existencia}</span>
    </div>
  `).join('');
  resultadosDiv.querySelectorAll('.resultado-item').forEach((el, i) => {
    el.addEventListener('click', () => agregarAVenta(productos[i]));
  });
}

function agregarAVenta(producto) {
  mensajeEscaneo.style.display = 'none';
  if (producto.tipo_venta === 'peso') {
    abrirModalPeso(producto);
    return;
  }
  const existente = venta.find(i => i.producto_id === producto.id);
  if (existente) {
    if (existente.cantidad + 1 > producto.existencia) {
      mostrarMensajeEscaneo('No hay suficiente existencia', 'error');
      return;
    }
    existente.cantidad++;
  } else {
    if (producto.existencia < 1) {
      mostrarMensajeEscaneo('Sin existencia', 'error');
      return;
    }
    venta.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      codigo_barra: producto.codigo_barra,
      precio_venta: Number(producto.precio_venta),
      tipo_venta: 'unidad',
      cantidad: 1,
      existencia: producto.existencia
    });
  }
  escanearInput.value = '';
  resultadosDiv.innerHTML = '';
  ultimosResultados = [];
  escanearInput.focus();
  renderVenta();
}

// --- Modal de productos por peso (pan, cecinas, etc.): pide gramos y calcula el precio solo ---
let productoPesoActual = null;

function abrirModalPeso(producto) {
  productoPesoActual = producto;
  document.getElementById('modalPesoTitulo').textContent = `${producto.nombre} (${moneyCL(producto.precio_venta)}/kg)`;
  const input = document.getElementById('modalPesoGramos');
  input.value = '';
  document.getElementById('modalPesoPrecio').textContent = '$0';
  document.getElementById('modalPeso').style.display = 'flex';
  input.oninput = () => {
    const gramos = Number(input.value) || 0;
    document.getElementById('modalPesoPrecio').textContent = moneyCL((producto.precio_venta / 1000) * gramos);
  };
  setTimeout(() => input.focus(), 50);
}

function cerrarModalPeso() {
  document.getElementById('modalPeso').style.display = 'none';
  productoPesoActual = null;
}

function confirmarModalPeso() {
  const gramos = Number(document.getElementById('modalPesoGramos').value);
  if (!gramos || gramos <= 0) { mostrarMensajeEscaneo('Ingresa los gramos', 'error'); return; }
  const producto = productoPesoActual;

  const existente = venta.find(i => i.producto_id === producto.id);
  const gramosActuales = existente ? existente.cantidad : 0;
  if (gramosActuales + gramos > producto.existencia) {
    mostrarMensajeEscaneo(`No hay suficiente existencia (disponible: ${((producto.existencia - gramosActuales)/1000).toLocaleString('es-CL', {maximumFractionDigits:2})} kg)`, 'error');
    return;
  }

  if (existente) {
    existente.cantidad += gramos;
  } else {
    venta.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      codigo_barra: producto.codigo_barra,
      precio_venta: Number(producto.precio_venta),
      tipo_venta: 'peso',
      cantidad: gramos,
      existencia: producto.existencia
    });
  }

  cerrarModalPeso();
  escanearInput.value = '';
  resultadosDiv.innerHTML = '';
  ultimosResultados = [];
  escanearInput.focus();
  renderVenta();
}

function renderVenta() {
  ventaBody.innerHTML = venta.map((item, idx) => {
    const esPeso = item.tipo_venta === 'peso';
    const cantidadHtml = esPeso
      ? `${(item.cantidad/1000).toLocaleString('es-CL', {maximumFractionDigits:3})} kg`
      : `<button class="btn-mini" onclick="cambiarCantidad(${idx}, -1)">-</button> ${item.cantidad} <button class="btn-mini" onclick="cambiarCantidad(${idx}, 1)">+</button>`;
    const subtotal = esPeso ? (item.precio_venta / 1000) * item.cantidad : item.precio_venta * item.cantidad;
    return `
    <tr>
      <td>
        <div class="producto-nombre">${item.nombre}</div>
        <div class="producto-codigo">${item.codigo_barra || ''}</div>
      </td>
      <td>${cantidadHtml}</td>
      <td>${moneyCL(item.precio_venta)}${esPeso ? '/kg' : ''}</td>
      <td>${moneyCL(subtotal)}</td>
      <td><button class="btn-mini btn-danger" onclick="quitarItem(${idx})">✕</button></td>
    </tr>`;
  }).join('');
  actualizarTotal();
}

function cambiarCantidad(idx, delta) {
  const item = venta[idx];
  const nuevaCantidad = item.cantidad + delta;
  if (nuevaCantidad < 1) { quitarItem(idx); return; }
  if (nuevaCantidad > item.existencia) { mostrarMensajeEscaneo('No hay suficiente existencia', 'error'); return; }
  item.cantidad = nuevaCantidad;
  renderVenta();
}

function quitarItem(idx) {
  venta.splice(idx, 1);
  renderVenta();
}

function subtotalItem(item) {
  return item.tipo_venta === 'peso' ? (item.precio_venta / 1000) * item.cantidad : item.precio_venta * item.cantidad;
}

function actualizarTotal() {
  const total = venta.reduce((s, i) => s + subtotalItem(i), 0);
  totalVentaEl.textContent = moneyCL(total);
  actualizarCambio();
}

function actualizarCambio() {
  const total = venta.reduce((s, i) => s + subtotalItem(i), 0);
  const pagado = Number(pagadoConEl.value || 0);
  const cambio = pagado - total;
  cambioVentaEl.textContent = moneyCL(cambio >= 0 ? cambio : 0);
}
pagadoConEl.addEventListener('input', actualizarCambio);

document.querySelectorAll('input[name="tipo_pago"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const esCredito = document.querySelector('input[name="tipo_pago"]:checked').value === 'credito';
    clienteBox.style.display = esCredito ? 'block' : 'none';
    efectivoBox.style.display = esCredito ? 'none' : 'block';
  });
});

document.getElementById('btnCobrar').addEventListener('click', async () => {
  mensajeVenta.style.display = 'none';
  if (venta.length === 0) {
    mostrarMensaje('No hay productos en la venta', 'error');
    return;
  }
  const tipo_pago = document.querySelector('input[name="tipo_pago"]:checked').value;
  const cliente_id = document.getElementById('clienteSelect').value || null;
  const pagado_con = pagadoConEl.value || null;

  if (tipo_pago === 'credito' && !cliente_id) {
    mostrarMensaje('Selecciona un cliente para venta a crédito', 'error');
    return;
  }

  const body = {
    items: venta.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
    tipo_pago,
    cliente_id,
    pagado_con
  };

  const res = await fetch('/api/ventas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok) {
    mostrarMensaje(data.error || 'Error al procesar la venta', 'error');
    return;
  }

  window.open(`/ventas/${data.venta_id}/ticket`, '_blank');
  volverAlInicio();
});

function mostrarMensaje(msg, tipo) {
  mensajeVenta.textContent = msg;
  mensajeVenta.className = `alert alert-${tipo}`;
  mensajeVenta.style.display = 'block';
}

function mostrarMensajeEscaneo(msg, tipo) {
  mensajeEscaneo.textContent = msg;
  mensajeEscaneo.className = `alert alert-${tipo}`;
  mensajeEscaneo.style.display = 'block';
}
