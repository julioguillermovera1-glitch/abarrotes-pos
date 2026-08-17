// Punto de conexión para abrir el cajón de dinero físico al cobrar en efectivo.
// Todavía no hay hardware conectado, así que por ahora es un "no-op" documentado.
//
// Cuando se compre el equipo, lo normal es que el cajón se abra a través del
// puerto RJ11/RJ12 de una impresora térmica de tickets, enviándole un comando
// ESC/POS de "kick" (por ejemplo: Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])).
// Ese comando se puede mandar por USB, red o puerto serie según el modelo.
// También existen cajones USB/serial independientes con su propio comando.
//
// Cuando se sepa el modelo exacto, reemplazar el contenido de esta función por
// el envío real del comando (por ejemplo con el paquete "escpos" o "serialport").
function abrirCaja() {
  console.log('Caja registradora: (sin hardware conectado todavía, no se hizo nada)');
}

module.exports = { abrirCaja };
