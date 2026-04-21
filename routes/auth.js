const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

// Admin login
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.json({ ok: true });
});

router.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/admin/me', (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: req.session.adminUsername });
});

// Client login
router.post('/client/login', (req, res) => {
  const { username, password } = req.body;
  const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(username);
  if (!client || !bcrypt.compareSync(password, client.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.clientId = client.id;
  req.session.clientDisplayName = client.display_name;
  res.json({ ok: true, displayName: client.display_name });
});

router.post('/client/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/client/me', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ displayName: req.session.clientDisplayName });
});

module.exports = router;
