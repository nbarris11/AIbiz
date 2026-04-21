module.exports = function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
  if (wantsJson) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/internal/login');
};
