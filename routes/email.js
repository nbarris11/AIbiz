const express = require('express');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const { sendEmail, syncInbox, importContactsFromInbox, recomputeAllReplyStatuses } = require('../services/email');
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

module.exports = router;
