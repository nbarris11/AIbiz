const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const router = express.Router();

router.use(requireAdmin);

// GET /api/campaigns — list with per-campaign stats
router.get('/', (req, res) => {
  try {
    const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
    const result = campaigns.map(c => {
      const sent = db.prepare(
        "SELECT COUNT(*) as n FROM activities WHERE campaign_id = ? AND type = 'email_sent'"
      ).get(c.id).n;
      const opened = db.prepare(
        "SELECT COUNT(*) as n FROM activities WHERE campaign_id = ? AND type = 'email_sent' AND opened_at IS NOT NULL"
      ).get(c.id).n;
      const enrollments = db.prepare(
        'SELECT COUNT(*) as n FROM campaign_enrollments WHERE campaign_id = ?'
      ).get(c.id).n;
      const booked = db.prepare(
        "SELECT COUNT(DISTINCT ce.contact_id) as n FROM campaign_enrollments ce JOIN contacts c ON c.id = ce.contact_id WHERE ce.campaign_id = ? AND c.reply_status = 'Booked'"
      ).get(c.id).n;
      const steps = db.prepare(
        'SELECT COUNT(*) as n FROM campaign_steps WHERE campaign_id = ?'
      ).get(c.id).n;
      return { ...c, sent, opened, enrollments, booked, steps };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns — create campaign + steps
router.post('/', (req, res) => {
  try {
    const { name, industry, notes, steps } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = uuidv4();
    db.prepare(
      "INSERT INTO campaigns (id, name, industry, notes) VALUES (?, ?, ?, ?)"
    ).run(id, name, industry || null, notes || null);

    if (Array.isArray(steps)) {
      const insertStep = db.prepare(
        'INSERT INTO campaign_steps (id, campaign_id, step_number, template_id, delay_days, subject_override) VALUES (?, ?, ?, ?, ?, ?)'
      );
      steps.forEach((s, i) => {
        insertStep.run(uuidv4(), id, i + 1, s.template_id || null, s.delay_days ?? 0, s.subject_override || null);
      });
    }

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    const campaignSteps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_number').all(id);
    res.status(201).json({ ...campaign, steps: campaignSteps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/:id — detail + steps + enrollments
router.get('/:id', (req, res) => {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found' });

    const steps = db.prepare(
      'SELECT cs.*, et.name as template_name, et.subject as template_subject FROM campaign_steps cs LEFT JOIN email_templates et ON et.id = cs.template_id WHERE cs.campaign_id = ? ORDER BY cs.step_number'
    ).all(req.params.id);

    const enrollments = db.prepare(
      "SELECT ce.*, c.name as contact_name, c.email as contact_email, c.firm as contact_firm, c.reply_status FROM campaign_enrollments ce JOIN contacts c ON c.id = ce.contact_id WHERE ce.campaign_id = ? ORDER BY ce.enrolled_at DESC"
    ).all(req.params.id);

    const stats = {
      sent: db.prepare("SELECT COUNT(*) as n FROM activities WHERE campaign_id = ? AND type = 'email_sent'").get(req.params.id).n,
      opened: db.prepare("SELECT COUNT(*) as n FROM activities WHERE campaign_id = ? AND type = 'email_sent' AND opened_at IS NOT NULL").get(req.params.id).n,
    };

    res.json({ ...campaign, steps, enrollments, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/campaigns/:id — update status or name/industry/notes
router.patch('/:id', (req, res) => {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found' });

    const { status, name, industry, notes } = req.body;
    const validStatuses = ['draft', 'active', 'paused', 'completed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const newStatus = status || campaign.status;
    const newName = name !== undefined ? name : campaign.name;
    const newIndustry = industry !== undefined ? industry : campaign.industry;
    const newNotes = notes !== undefined ? notes : campaign.notes;

    let startedAt = campaign.started_at;
    let completedAt = campaign.completed_at;
    if (status === 'active' && !campaign.started_at) startedAt = new Date().toISOString();
    if (status === 'completed') completedAt = new Date().toISOString();

    db.prepare(
      'UPDATE campaigns SET status = ?, name = ?, industry = ?, notes = ?, started_at = ?, completed_at = ? WHERE id = ?'
    ).run(newStatus, newName, newIndustry, newNotes, startedAt, completedAt, req.params.id);

    res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/enroll — enroll contacts (array of contact IDs)
router.post('/:id/enroll', (req, res) => {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found' });

    const { contact_ids } = req.body;
    if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
      return res.status(400).json({ error: 'contact_ids array required' });
    }

    const insert = db.prepare(
      'INSERT OR IGNORE INTO campaign_enrollments (id, campaign_id, contact_id) VALUES (?, ?, ?)'
    );
    let enrolled = 0;
    for (const contactId of contact_ids) {
      const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(contactId);
      if (!contact) continue;
      insert.run(uuidv4(), req.params.id, contactId);
      enrolled++;
    }

    res.json({ enrolled, total: contact_ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/insights/by-industry
router.get('/insights/by-industry', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        COALESCE(c.industry, 'other') as industry,
        COUNT(DISTINCT CASE WHEN a.type = 'email_sent' THEN a.id END) as sent,
        COUNT(DISTINCT CASE WHEN a.type = 'email_sent' AND a.opened_at IS NOT NULL THEN a.id END) as opened,
        COUNT(DISTINCT CASE WHEN a.type = 'email_received' THEN c.id END) as replied,
        COUNT(DISTINCT CASE WHEN c.reply_status = 'Replied — Interested' THEN c.id END) as interested,
        COUNT(DISTINCT CASE WHEN c.reply_status = 'Booked' THEN c.id END) as booked
      FROM contacts c
      JOIN activities a ON a.contact_id = c.id
      WHERE a.type IN ('email_sent', 'email_received')
      GROUP BY COALESCE(c.industry, 'other')
      ORDER BY sent DESC
    `).all();

    // Compute averages for color-coding
    const withRates = rows.map(r => ({
      ...r,
      open_rate: r.sent > 0 ? r.opened / r.sent : 0,
      reply_rate: r.sent > 0 ? r.replied / r.sent : 0,
    }));

    const avgOpenRate = withRates.length
      ? withRates.reduce((s, r) => s + r.open_rate, 0) / withRates.length : 0;
    const avgReplyRate = withRates.length
      ? withRates.reduce((s, r) => s + r.reply_rate, 0) / withRates.length : 0;

    res.json({ rows: withRates, avgOpenRate, avgReplyRate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/insights/attribution
router.get('/insights/attribution', (req, res) => {
  try {
    const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();

    const perCampaign = campaigns.map(c => {
      const sent = db.prepare(
        "SELECT COUNT(*) as n FROM activities WHERE campaign_id = ? AND type = 'email_sent'"
      ).get(c.id).n;
      const opened = db.prepare(
        "SELECT COUNT(*) as n FROM activities WHERE campaign_id = ? AND type = 'email_sent' AND opened_at IS NOT NULL"
      ).get(c.id).n;
      const booked = db.prepare(
        "SELECT COUNT(DISTINCT ce.contact_id) as n FROM campaign_enrollments ce JOIN contacts ct ON ct.id = ce.contact_id WHERE ce.campaign_id = ? AND ct.reply_status = 'Booked'"
      ).get(c.id).n;
      return { id: c.id, name: c.name, industry: c.industry, status: c.status, sent, opened, booked };
    });

    // Pipeline: enrolled contacts who are Booked or have a reply sub-status
    const pipeline = db.prepare(`
      SELECT
        ct.name as contact_name, ct.firm as contact_firm, ct.reply_status,
        ce.campaign_id, ce.enrolled_at, ce.current_step,
        cam.name as campaign_name
      FROM campaign_enrollments ce
      JOIN contacts ct ON ct.id = ce.contact_id
      JOIN campaigns cam ON cam.id = ce.campaign_id
      WHERE ct.reply_status IN ('Booked','Replied — Interested','Replied — Not Now','Replied — Not Interested')
      ORDER BY ce.enrolled_at DESC
    `).all();

    res.json({ perCampaign, pipeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
