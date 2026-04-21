const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const requireClient = require('../middleware/requireClient');
const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Admin: upload file for a client
router.post('/upload/:clientId', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO files (id, client_id, filename, stored_filename) VALUES (?, ?, ?, ?)')
    .run(id, req.params.clientId, req.file.originalname, req.file.filename);
  res.status(201).json(db.prepare('SELECT * FROM files WHERE id = ?').get(id));
});

// Admin: delete a file
router.delete('/file/:fileId', requireAdmin, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(UPLOADS_DIR, file.stored_filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);
  res.json({ ok: true });
});

// Client: download a file (only their own)
router.get('/download/:fileId', requireClient, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Not found' });
  if (file.client_id !== req.session.clientId) return res.status(403).json({ error: 'Forbidden' });
  const filePath = path.join(UPLOADS_DIR, file.stored_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.download(filePath, file.filename);
});

module.exports = router;
