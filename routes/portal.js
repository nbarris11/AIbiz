const express = require('express');
const db = require('../db');
const requireClient = require('../middleware/requireClient');
const router = express.Router();

// Client's file list (only their own files)
router.get('/files', requireClient, (req, res) => {
  const files = db.prepare(
    'SELECT id, filename, uploaded_at FROM files WHERE client_id = ? ORDER BY uploaded_at DESC'
  ).all(req.session.clientId);
  res.json(files);
});

module.exports = router;
