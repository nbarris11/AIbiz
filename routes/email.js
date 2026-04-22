const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const { sendEmail, syncInbox, importContactsFromInbox, recomputeAllReplyStatuses, backfillEmailBodies, EMAIL_SIGNATURE } = require('../services/email');
const router = express.Router();

router.use(requireAdmin);

// Send an email to a contact
router.post('/send/:contactId', async (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  if (!contact.email) return res.status(400).json({ error: 'Contact has no email address' });

  const { subject, body } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

  try {
    await sendEmail({ to: contact.email, subject, body, contactId: contact.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[send email]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger an inbox sync
router.post('/sync', async (req, res) => {
  try {
    await syncInbox();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch + store email bodies for any existing activity that doesn't have one
router.post('/backfill-bodies', async (req, res) => {
  try {
    const result = await backfillEmailBodies();
    res.json(result);
  } catch (err) {
    console.error('[backfill-bodies]', err);
    res.status(500).json({ error: err.message });
  }
});

// Rebuild reply_status for every contact based on their email activity
router.post('/recompute-statuses', (req, res) => {
  const updated = recomputeAllReplyStatuses();
  res.json({ ok: true, contacts_processed: updated });
});

// Scan inbox + sent, create contacts from unique senders/recipients,
// and log every historical email as an activity. Can be re-run safely —
// existing contacts aren't duplicated, already-synced messages aren't re-logged.
router.post('/import-contacts', async (req, res) => {
  try {
    const result = await importContactsFromInbox();
    res.json(result);
  } catch (err) {
    console.error('[import-contacts]', err);
    res.status(500).json({ error: err.message });
  }
});

// Compose a new email — auto-creates the contact if one doesn't exist for that email
router.post('/compose', async (req, res) => {
  const { to, subject, body, name, firm, industry } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, body required' });

  const toLower = String(to).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toLower)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Find existing contact
  let contact = db.prepare('SELECT * FROM contacts WHERE LOWER(email) = ?').get(toLower);
  let wasNew = false;

  if (!contact) {
    // Auto-create. Derive a reasonable name/firm from the address if not provided.
    const local = toLower.split('@')[0];
    const derivedName = local.replace(/[._-]+/g, ' ').split(' ')
      .filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const domain = toLower.split('@')[1] || '';
    const GENERIC = new Set(['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','me.com','mac.com','aol.com','protonmail.com','proton.me','live.com','msn.com','comcast.net','verizon.net','att.net']);
    const derivedFirm = GENERIC.has(domain.toLowerCase()) ? null : (() => {
      const base = domain.split('.').slice(0, -1).pop() || domain;
      return base.charAt(0).toUpperCase() + base.slice(1);
    })();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO contacts (id, name, firm, email, industry, pipeline_stage, source, notes)
      VALUES (?, ?, ?, ?, ?, 'Lead', 'Compose Email', 'Auto-created from compose window')
    `).run(
      id,
      (name && name.trim()) || derivedName || toLower,
      (firm && firm.trim()) || derivedFirm,
      toLower,
      industry || null,
    );
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    wasNew = true;
  }

  try {
    await sendEmail({ to: contact.email, subject, body, contactId: contact.id });
    res.json({ ok: true, contactId: contact.id, contactName: contact.name, wasNew });
  } catch (err) {
    console.error('[compose]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Look up whether an email address already has a contact (used by compose window)
router.get('/lookup', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  if (!email) return res.json({ exists: false });
  const contact = db.prepare('SELECT id, name, firm, email, pipeline_stage, reply_status FROM contacts WHERE LOWER(email) = ?').get(email);
  if (!contact) return res.json({ exists: false });
  const emailCount = db.prepare(
    "SELECT COUNT(*) as n FROM activities WHERE contact_id = ? AND type IN ('email_sent','email_received')"
  ).get(contact.id).n;
  const lastEmail = db.prepare(
    "SELECT type, logged_at FROM activities WHERE contact_id = ? AND type IN ('email_sent','email_received') ORDER BY logged_at DESC LIMIT 1"
  ).get(contact.id);
  res.json({ exists: true, contact, emailCount, lastEmail });
});

// Expose the current signature so the compose window can show a preview
router.get('/signature', (req, res) => {
  res.json({ signature: EMAIL_SIGNATURE });
});

module.exports = router;
