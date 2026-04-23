const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const router = express.Router();

const CALENDLY_SECRET = process.env.CALENDLY_WEBHOOK_SECRET;

router.post('/calendly', express.raw({ type: 'application/json' }), (req, res) => {
  if (CALENDLY_SECRET) {
    const sigHeader = req.headers['calendly-webhook-signature'] || '';
    const match = sigHeader.match(/t=([^,]+),v1=([^,]+)/);
    if (!match) {
      console.warn('[calendly] missing or malformed signature header');
      return res.status(403).json({ error: 'Missing signature' });
    }
    const [, timestamp, signature] = match;
    const payload = timestamp + '.' + req.body.toString();
    const expected = crypto.createHmac('sha256', CALENDLY_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      console.warn('[calendly] signature mismatch');
      return res.status(403).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (event.event !== 'invitee.created') return res.json({ ok: true, skipped: true });

  const email = event.payload?.invitee?.email;
  if (!email) return res.json({ ok: true, skipped: 'no email' });

  const contact = db.prepare('SELECT * FROM contacts WHERE email = ? COLLATE NOCASE').get(email);
  if (!contact) {
    console.warn('[calendly] booking for unknown email:', email);
    return res.json({ ok: true, skipped: 'contact not found' });
  }

  try {
    db.prepare("UPDATE contacts SET reply_status = 'Booked', updated_at = datetime('now') WHERE id = ?")
      .run(contact.id);

    const enrollment = db.prepare(`
      SELECT campaign_id FROM campaign_enrollments
      WHERE contact_id = ? AND status IN ('active','completed','replied')
      ORDER BY enrolled_at DESC LIMIT 1
    `).get(contact.id);

    db.prepare(
      "INSERT INTO activities (id, contact_id, type, subject, body, logged_at, campaign_id) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)"
    ).run(
      uuidv4(), contact.id, 'session_booked', 'Clarity Session Booked',
      'Booked via Calendly: ' + email,
      enrollment ? enrollment.campaign_id : null
    );

    db.prepare("UPDATE campaign_enrollments SET status = 'stopped' WHERE contact_id = ? AND status = 'active'")
      .run(contact.id);

    console.log('[calendly] booked:', email, '— contact:', contact.name);
    res.json({ ok: true });
  } catch (err) {
    console.error('[calendly] DB error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
