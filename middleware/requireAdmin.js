module.exports = function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  // Any API request gets JSON — avoids the "<!DOCTYPE..." parse error on the client
  const isApiRequest = req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/');
  const wantsJson = req.xhr || isApiRequest || (req.headers.accept && req.headers.accept.includes('application/json'));
  if (wantsJson) return res.status(401).json({ error: 'Not authenticated — please sign in again', requiresLogin: true });
  res.redirect('/internal/login');
};
