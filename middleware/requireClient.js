module.exports = function requireClient(req, res, next) {
  if (req.session && req.session.clientId) return next();
  const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
  if (wantsJson) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/portal/login');
};
