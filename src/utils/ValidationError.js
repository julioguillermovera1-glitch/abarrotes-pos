// Error "esperado" (datos inválidos, regla de negocio) cuyo mensaje es
// seguro de mostrar tal cual al usuario. Cualquier otro error (fallo de
// base de datos, bug, etc.) NO debe mostrarse crudo — lo atrapa el
// manejador de errores global y muestra un mensaje genérico.
class ValidationError extends Error {}

module.exports = ValidationError;
