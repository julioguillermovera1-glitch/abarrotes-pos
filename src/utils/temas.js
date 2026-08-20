// Paletas de color disponibles para el programa. Un mismo tema se usa tanto
// para pintar la pantalla (menu, botones) como los encabezados de los
// reportes en Excel, para que todo se vea consistente.
const TEMAS = {
  clasico: {
    nombre: 'Azul clásico',
    primario: '#1b3a57',
    primarioClaro: '#2c5478',
    fondo: '#eef2f6',
    tablaHead: '#e3e9ef'
  },
  salvia: {
    nombre: 'Verde salvia',
    primario: '#33513f',
    primarioClaro: '#456b54',
    fondo: '#eef3ec',
    tablaHead: '#e2ebe0'
  },
  terracota: {
    nombre: 'Terracota cálido',
    primario: '#7a4a34',
    primarioClaro: '#94604a',
    fondo: '#faf1ea',
    tablaHead: '#f4e6da'
  },
  pizarra: {
    nombre: 'Gris pizarra',
    primario: '#33363d',
    primarioClaro: '#484c55',
    fondo: '#f1f1ef',
    tablaHead: '#e6e6e3'
  }
};

const TEMA_POR_DEFECTO = 'clasico';

function obtenerTema(id) {
  return TEMAS[id] || TEMAS[TEMA_POR_DEFECTO];
}

module.exports = { TEMAS, TEMA_POR_DEFECTO, obtenerTema };
