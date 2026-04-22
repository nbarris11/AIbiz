const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const router = express.Router();

router.use(requireAdmin);

// ── DASHBOARD STATS ──────────────────────────────────
router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM contacts').get().n;
  const active = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE pipeline_stage = 'Active Client'").get().n;
  const booked = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE pipeline_stage = 'Session Booked'").get().n;
  const today = new Date().toISOString().split('T')[0];
  const followups = db.prepare('SELECT COUNT(*) as n FROM contacts WHERE follow_up_date <= ? AND follow_up_date IS NOT NULL').get(today).n;
  const pipeline = db.prepare('SELECT pipeline_stage, COUNT(*) as count FROM contacts GROUP BY pipeline_stage').all();
  const overdue = db.prepare(
    'SELECT id, name, firm, follow_up_date FROM contacts WHERE follow_up_date <= ? AND follow_up_date IS NOT NULL ORDER BY follow_up_date ASC'
  ).all(today);
  res.json({ total, active, booked, followups, pipeline, overdue });
});

// ── CONTACTS ─────────────────────────────────────────
router.get('/contacts', (req, res) => {
  const { q, industry, stage } = req.query;
  let sql = `SELECT c.*,
    (SELECT logged_at FROM activities WHERE contact_id = c.id ORDER BY logged_at DESC LIMIT 1) as last_activity
    FROM contacts c WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND (c.name LIKE ? OR c.firm LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (industry) { sql += ' AND c.industry = ?'; params.push(industry); }
  if (stage) { sql += ' AND c.pipeline_stage = ?'; params.push(stage); }
  sql += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/contacts/:id', (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  const activities = db.prepare('SELECT * FROM activities WHERE contact_id = ? ORDER BY logged_at DESC').all(req.params.id);
  const portalClient = db.prepare('SELECT id, username, display_name FROM clients WHERE contact_id = ?').get(req.params.id);
  const files = portalClient
    ? db.prepare('SELECT * FROM files WHERE client_id = ? ORDER BY uploaded_at DESC').all(portalClient.id)
    : [];
  res.json({ ...contact, activities, portalClient, files });
});

router.post('/contacts', (req, res) => {
  const { name, firm, industry, email, phone, pipeline_stage, source, notes, follow_up_date } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO contacts (id, name, firm, industry, email, phone, pipeline_stage, source, notes, follow_up_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, firm || null, industry || null, email || null, phone || null,
         pipeline_stage || 'Lead', source || null, notes || null, follow_up_date || null);
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});

router.put('/contacts/:id', (req, res) => {
  const { name, firm, industry, email, phone, pipeline_stage, source, notes, follow_up_date } = req.body;
  const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE contacts SET name=?, firm=?, industry=?, email=?, phone=?, pipeline_stage=?,
    source=?, notes=?, follow_up_date=?, updated_at=datetime('now') WHERE id=?
  `).run(name, firm || null, industry || null, email || null, phone || null,
         pipeline_stage || 'Lead', source || null, notes || null, follow_up_date || null, req.params.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id));
});

router.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── ACTIVITIES ────────────────────────────────────────
router.post('/contacts/:id/activities', (req, res) => {
  const { type, subject, body, logged_at } = req.body;
  if (!type || !subject) return res.status(400).json({ error: 'type and subject required' });
  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO activities (id, contact_id, type, subject, body, logged_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, type, subject, body || null, logged_at || new Date().toISOString());
  db.prepare("UPDATE contacts SET updated_at=datetime('now') WHERE id=?").run(req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM activities WHERE id = ?').get(id));
});

// ── FOLLOW-UPS ────────────────────────────────────────
router.get('/followups', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const rows = db.prepare('SELECT * FROM contacts WHERE follow_up_date IS NOT NULL ORDER BY follow_up_date ASC').all();
  res.json(rows.map(r => ({ ...r, overdue: r.follow_up_date <= today })));
});

router.post('/contacts/:id/followup', (req, res) => {
  const { follow_up_date } = req.body;
  db.prepare("UPDATE contacts SET follow_up_date=?, updated_at=datetime('now') WHERE id=?")
    .run(follow_up_date || null, req.params.id);
  res.json({ ok: true });
});

// ── OUTREACH ──────────────────────────────────────────
router.get('/outreach', (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM contacts WHERE source IS NOT NULL AND source != '' ORDER BY created_at DESC"
  ).all();
  res.json(rows);
});

router.post('/contacts/:id/reply-status', (req, res) => {
  const { reply_status } = req.body;
  const valid = ['None', 'Sent', 'Replied', 'Booked', 'Not Interested'];
  if (!valid.includes(reply_status)) return res.status(400).json({ error: 'Invalid reply_status' });
  db.prepare("UPDATE contacts SET reply_status=?, updated_at=datetime('now') WHERE id=?")
    .run(reply_status, req.params.id);
  res.json({ ok: true });
});

// ── PORTAL CLIENT MANAGEMENT ──────────────────────────
router.get('/portal-clients', (req, res) => {
  const clients = db.prepare(`
    SELECT cl.*, co.name as contact_name,
      (SELECT COUNT(*) FROM files WHERE client_id = cl.id) as file_count
    FROM clients cl
    LEFT JOIN contacts co ON cl.contact_id = co.id
    ORDER BY cl.created_at DESC
  `).all();
  res.json(clients);
});

router.post('/portal-clients', (req, res) => {
  const { display_name, username, password, contact_id } = req.body;
  if (!display_name || !username || !password) {
    return res.status(400).json({ error: 'display_name, username, and password are required' });
  }
  const existing = db.prepare('SELECT id FROM clients WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username already taken' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO clients (id, contact_id, username, password_hash, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(id, contact_id || null, username, hash, display_name);
  res.status(201).json(
    db.prepare('SELECT id, username, display_name, contact_id, created_at FROM clients WHERE id = ?').get(id)
  );
});

router.post('/portal-clients/:id/reset-password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

router.delete('/portal-clients/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── EMAIL TEMPLATES ──────────────────────────────────
router.get('/templates', (req, res) => {
  res.json(db.prepare('SELECT * FROM email_templates ORDER BY name ASC').all());
});

router.post('/templates', (req, res) => {
  const { name, subject, body } = req.body;
  if (!name || !subject || !body) return res.status(400).json({ error: 'name, subject, body required' });
  const id = uuidv4();
  db.prepare('INSERT INTO email_templates (id, name, subject, body) VALUES (?, ?, ?, ?)')
    .run(id, name, subject, body);
  res.status(201).json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id));
});

router.put('/templates/:id', (req, res) => {
  const { name, subject, body } = req.body;
  const existing = db.prepare('SELECT id FROM email_templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE email_templates SET name=?, subject=?, body=?, updated_at=datetime('now') WHERE id=?")
    .run(name, subject, body, req.params.id);
  res.json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id));
});

router.delete('/templates/:id', (req, res) => {
  db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
