const express = require('express');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const { sendEmail, syncInbox } = require('../services/email');
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

module.exports = router;
