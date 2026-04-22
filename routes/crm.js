const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const router = express.Router();

router.use(requireAdmin);

// ── DASHBOARD STATS ──────────────────────────────────
// Business insights — everything in one shot so the UI doesn't have to stitch
router.get('/insights', (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
    const startOfThisWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const countActivities = (type, since) =>
      db.prepare('SELECT COUNT(*) as n FROM activities WHERE type = ? AND logged_at >= ?').get(type, since).n;

    // Today / Yesterday / Week / Month
    const sentToday       = countActivities('email_sent', startOfToday);
    const sentYesterday   = db.prepare('SELECT COUNT(*) as n FROM activities WHERE type = ? AND logged_at >= ? AND logged_at < ?').get('email_sent', startOfYesterday, startOfToday).n;
    const receivedToday   = countActivities('email_received', startOfToday);
    const bouncesToday    = countActivities('email_bounce', startOfToday);
    const sentThisWeek    = countActivities('email_sent', startOfThisWeek);
    const sentThisMonth   = countActivities('email_sent', startOfThisMonth);
    const receivedThisMonth = countActivities('email_received', startOfThisMonth);
    const sentLast30      = countActivities('email_sent', thirtyDaysAgo);
    const receivedLast30  = countActivities('email_received', thirtyDaysAgo);
    const bouncesLast30   = countActivities('email_bounce', thirtyDaysAgo);

    // Overall reply rate: contacts who received AT LEAST one send AND replied / contacts who received at least one send
    const sentContacts = db.prepare(`
      SELECT COUNT(DISTINCT contact_id) as n FROM activities WHERE type = 'email_sent'
    `).get().n;
    const repliedContacts = db.prepare(`
      SELECT COUNT(DISTINCT a.contact_id) as n FROM activities a
      WHERE a.type = 'email_received'
      AND EXISTS (SELECT 1 FROM activities b WHERE b.contact_id = a.contact_id AND b.type = 'email_sent' AND b.logged_at < a.logged_at)
    `).get().n;
    const bouncedContacts = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE reply_status = 'Bounced'").get().n;

    // Daily volume chart (last 30 days)
    const dailySent = db.prepare(`
      SELECT DATE(logged_at) as day, COUNT(*) as sent
      FROM activities WHERE type = 'email_sent' AND logged_at >= ?
      GROUP BY DATE(logged_at) ORDER BY day ASC
    `).all(thirtyDaysAgo);
    const dailyReceived = db.prepare(`
      SELECT DATE(logged_at) as day, COUNT(*) as received
      FROM activities WHERE type = 'email_received' AND logged_at >= ?
      GROUP BY DATE(logged_at) ORDER BY day ASC
    `).all(thirtyDaysAgo);
    // Merge into one series per day, last 30 days
    const dayMap = {};
    for (const d of dailySent) dayMap[d.day] = { day: d.day, sent: d.sent, received: 0 };
    for (const d of dailyReceived) {
      if (!dayMap[d.day]) dayMap[d.day] = { day: d.day, sent: 0, received: 0 };
      dayMap[d.day].received = d.received;
    }
    const dailyVolume = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyVolume.push(dayMap[key] || { day: key, sent: 0, received: 0 });
    }

    // Reply rate by industry
    const industryRows = db.prepare(`
      SELECT
        COALESCE(c.industry,'other') as industry,
        COUNT(DISTINCT CASE WHEN a.type = 'email_sent' THEN c.id END) as sent,
        COUNT(DISTINCT CASE WHEN a.type = 'email_received' THEN c.id END) as replied
      FROM contacts c
      JOIN activities a ON a.contact_id = c.id
      WHERE a.type IN ('email_sent','email_received')
      GROUP BY COALESCE(c.industry,'other')
    `).all();

    // Reply rate by day-of-week (strftime %w: 0=Sun..6=Sat)
    // We look at the day the outbound was sent, then check if the contact replied within 14 days.
    const dayOfWeek = db.prepare(`
      SELECT
        strftime('%w', a.logged_at) as dow,
        COUNT(*) as sent,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM activities b WHERE b.contact_id = a.contact_id AND b.type = 'email_received'
            AND b.logged_at > a.logged_at AND julianday(b.logged_at) - julianday(a.logged_at) < 14
        ) THEN 1 ELSE 0 END) as got_reply
      FROM activities a
      WHERE a.type = 'email_sent' AND a.logged_at >= ?
      GROUP BY dow ORDER BY dow
    `).all(new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());

    // Top subject lines by reply rate (at least 2 sends, sorted by rate desc)
    const subjectPerf = db.prepare(`
      WITH sent_by_subject AS (
        SELECT subject, contact_id, MIN(logged_at) as first_sent
        FROM activities WHERE type = 'email_sent' AND subject IS NOT NULL AND subject != ''
        GROUP BY subject, contact_id
      )
      SELECT
        s.subject,
        COUNT(*) as sent,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM activities b WHERE b.contact_id = s.contact_id AND b.type = 'email_received'
            AND b.logged_at > s.first_sent AND julianday(b.logged_at) - julianday(s.first_sent) < 21
        ) THEN 1 ELSE 0 END) as replied
      FROM sent_by_subject s
      GROUP BY s.subject
      HAVING COUNT(*) >= 2
      ORDER BY (CAST(replied AS FLOAT) / sent) DESC, sent DESC
      LIMIT 10
    `).all();

    // Pipeline funnel
    const pipelineStages = ['Lead','Session Booked','Proposal Sent','Active Client','Dormant'];
    const pipelineRows = db.prepare('SELECT pipeline_stage, COUNT(*) as n FROM contacts GROUP BY pipeline_stage').all();
    const pipelineByStage = {};
    for (const r of pipelineRows) pipelineByStage[r.pipeline_stage] = r.n;
    const funnel = pipelineStages.map(s => ({ stage: s, count: pipelineByStage[s] || 0 }));

    // Recent replies — actual inbound emails in the last 7 days
    const recentReplies = db.prepare(`
      SELECT a.subject, a.logged_at, a.body, c.id as contact_id, c.name, c.firm, c.email
      FROM activities a JOIN contacts c ON a.contact_id = c.id
      WHERE a.type = 'email_received' AND a.logged_at >= ?
      ORDER BY a.logged_at DESC LIMIT 10
    `).all(sevenDaysAgo);

    // Average time-to-reply (hours) — for contacts who replied
    const avgTimeRow = db.prepare(`
      WITH first_send AS (
        SELECT contact_id, MIN(logged_at) as t FROM activities WHERE type='email_sent' GROUP BY contact_id
      ), first_reply AS (
        SELECT contact_id, MIN(logged_at) as t FROM activities WHERE type='email_received' GROUP BY contact_id
      )
      SELECT AVG((julianday(r.t) - julianday(s.t)) * 24.0) as avg_hours
      FROM first_send s JOIN first_reply r ON s.contact_id = r.contact_id
      WHERE r.t > s.t
    `).get();

    const lastSyncRow = db.prepare("SELECT value FROM email_sync_state WHERE key = 'last_sync_at'").get();

    // Open tracking stats
    const openedToday = db.prepare(
      "SELECT COUNT(*) as n FROM activities WHERE type='email_sent' AND opened_at IS NOT NULL AND opened_at >= ?"
    ).get(startOfToday).n;

    const totalSent = db.prepare(
      "SELECT COUNT(*) as n FROM activities WHERE type='email_sent' AND tracking_id IS NOT NULL"
    ).get().n;

    const totalOpened = db.prepare(
      "SELECT COUNT(*) as n FROM activities WHERE type='email_sent' AND opened_at IS NOT NULL"
    ).get().n;

    const openRate = totalSent > 0 ? (totalOpened / totalSent) : 0;

    res.json({
      last_sync_at: lastSyncRow?.value || null,
      today: { sent: sentToday, received: receivedToday, bounces: bouncesToday, sent_yesterday: sentYesterday },
      week: { sent: sentThisWeek },
      month: { sent: sentThisMonth, received: receivedThisMonth },
      last_30: { sent: sentLast30, received: receivedLast30, bounces: bouncesLast30 },
      overall: {
        sent_contacts: sentContacts,
        replied_contacts: repliedContacts,
        bounced_contacts: bouncedContacts,
        reply_rate: sentContacts > 0 ? repliedContacts / sentContacts : 0,
        bounce_rate: sentContacts > 0 ? bouncedContacts / sentContacts : 0,
        avg_reply_hours: avgTimeRow?.avg_hours || null,
      },
      daily_volume: dailyVolume,
      by_industry: industryRows,
      by_day_of_week: dayOfWeek,
      top_subjects: subjectPerf,
      funnel,
      recent_replies: recentReplies,
      openTracking: { openedToday, totalOpened, totalSent, openRate },
    });
  } catch (err) {
    console.error('[insights]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM contacts').get().n;
  const active = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE pipeline_stage = 'Active Client'").get().n;
  const booked = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE pipeline_stage = 'Session Booked'").get().n;
  const today = new Date().toISOString().split('T')[0];
  const followups = db.prepare('SELECT COUNT(*) as n FROM contacts WHERE follow_up_date <= ? AND follow_up_date IS NOT NULL').get(today).n;
  const bounced = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE reply_status = 'Bounced'").get().n;
  const bouncedList = db.prepare(
    "SELECT id, name, firm, email FROM contacts WHERE reply_status = 'Bounced' ORDER BY updated_at DESC LIMIT 10"
  ).all();
  const pipeline = db.prepare('SELECT pipeline_stage, COUNT(*) as count FROM contacts GROUP BY pipeline_stage').all();
  const overdue = db.prepare(
    'SELECT id, name, firm, follow_up_date FROM contacts WHERE follow_up_date <= ? AND follow_up_date IS NOT NULL ORDER BY follow_up_date ASC'
  ).all(today);
  res.json({ total, active, booked, followups, bounced, bouncedList, pipeline, overdue });
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
  const valid = ['None', 'Sent', 'Replied', 'Booked', 'Not Interested', 'Bounced'];
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
