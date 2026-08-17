function requireLogin(req, res, next) {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.usuario || req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Acceso solo para administradores');
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
