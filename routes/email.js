const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const {
  sendEmail, syncInbox, importContactsFromInbox, recomputeAllReplyStatuses,
  backfillEmailBodies, EMAIL_SIGNATURE,
  getFollowUpSettings, setFollowUpSettings, runFollowUpSweep, previewFollowUpQueue,
  bulkSend, renderMergeFields,
} = require('../services/email');
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
  try {
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

    await sendEmail({ to: contact.email, subject, body, contactId: contact.id });
    res.json({ ok: true, contactId: contact.id, contactName: contact.name, wasNew });
  } catch (err) {
    console.error('[compose]', err && err.stack ? err.stack : err);
    res.status(500).json({ error: (err && err.message) || 'Send failed' });
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

// ── AUTO FOLLOW-UP ─────────────────────────────────
router.get('/followup-settings', (req, res) => {
  res.json(getFollowUpSettings());
});

router.post('/followup-settings', (req, res) => {
  const { enabled, delayDays, templateId } = req.body;
  setFollowUpSettings({ enabled, delayDays, templateId });
  res.json(getFollowUpSettings());
});

router.get('/followup-preview', (req, res) => {
  res.json(previewFollowUpQueue());
});

// Manually trigger a sweep (respects business hours + enabled flag)
router.post('/followup-sweep', async (req, res) => {
  try {
    const result = await runFollowUpSweep();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force a sweep bypassing business-hours/enabled checks — for testing
router.post('/followup-sweep-force', async (req, res) => {
  const saved = getFollowUpSettings();
  try {
    // Temporarily enable + bypass business hours by marking "force"
    setFollowUpSettings({ enabled: true });
    const result = await runFollowUpSweep();
    res.json({ ...result, forced: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    setFollowUpSettings({ enabled: saved.enabled });
  }
});

// Per-contact pause/resume follow-ups
router.post('/contacts/:id/followup-paused', (req, res) => {
  const { paused } = req.body;
  const db = require('../db');
  db.prepare('UPDATE contacts SET follow_up_paused = ? WHERE id = ?').run(paused ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ── BULK EMAIL ──────────────────────────────────────────────
// In-memory job store. Jobs are ephemeral — survive only as long as the
// server process. That's fine: bulk sends take ~2-5 min max, way under
// typical session / uptime windows.
const bulkJobs = new Map();
function genJobId() { return Math.random().toString(36).slice(2, 12); }

// Preview recipients matching a filter (or an explicit ID list)
router.post('/bulk-preview', (req, res) => {
  try {
    const { industry, stage, replyStatus, contactIds } = req.body;
    if (Array.isArray(contactIds) && contactIds.length) {
      const placeholders = contactIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id, name, firm, email, industry, pipeline_stage, reply_status
         FROM contacts WHERE id IN (${placeholders}) AND email IS NOT NULL AND email != ''`
      ).all(...contactIds);
      return res.json(rows);
    }
    let sql = `SELECT id, name, firm, email, industry, pipeline_stage, reply_status
               FROM contacts WHERE email IS NOT NULL AND email != ''`;
    const params = [];
    if (industry) { sql += ' AND industry = ?'; params.push(industry); }
    if (stage)    { sql += ' AND pipeline_stage = ?'; params.push(stage); }
    if (replyStatus) { sql += ' AND reply_status = ?'; params.push(replyStatus); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('[bulk-preview]', err);
    res.status(500).json({ error: err.message });
  }
});

// Given an array of emails, report which ones already exist in the CRM.
// Used by CSV upload to warn about duplicates before sending.
router.post('/bulk-lookup', (req, res) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
    const result = emails.map(e => {
      const lower = String(e || '').toLowerCase().trim();
      if (!lower) return { email: lower, exists: false };
      const existing = db.prepare('SELECT id, name FROM contacts WHERE LOWER(email) = ?').get(lower);
      return { email: lower, exists: !!existing, contact: existing || null };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kick off a bulk send. Returns immediately with a jobId; work runs in the
// background. Poll GET /bulk-progress/:jobId every 2s to track.
router.post('/bulk-send', async (req, res) => {
  try {
    let { contactIds, contacts: csvContacts, subject, body, delayMs } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
    delayMs = parseInt(delayMs, 10);
    if (!delayMs || delayMs < 1000) delayMs = 3000;

    let contactsToSend = [];
    const skipped = [];

    if (Array.isArray(contactIds) && contactIds.length) {
      if (contactIds.length > 100) return res.status(400).json({ error: 'Max 100 contacts per batch' });
      const placeholders = contactIds.map(() => '?').join(',');
      contactsToSend = db.prepare(
        `SELECT * FROM contacts WHERE id IN (${placeholders}) AND email IS NOT NULL AND email != ''`
      ).all(...contactIds);
    } else if (Array.isArray(csvContacts) && csvContacts.length) {
      if (csvContacts.length > 100) return res.status(400).json({ error: 'Max 100 contacts per batch' });
      // For CSV mode: skip anyone whose email already exists in the CRM
      for (const c of csvContacts) {
        const email = String(c.email || '').toLowerCase().trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          skipped.push({ email: c.email || '(no email)', reason: 'invalid_email' });
          continue;
        }
        const existing = db.prepare('SELECT id, name FROM contacts WHERE LOWER(email) = ?').get(email);
        if (existing) {
          skipped.push({ email, name: existing.name, reason: 'already_in_crm' });
          continue;
        }
        contactsToSend.push({
          // Preserve ALL columns from the CSV — any of them can be used as
          // {{merge_field}} in the template (e.g., {{custom_opener}}).
          ...c,
          id: null,
          email,
          first_name: c.first_name || '',
          last_name: c.last_name || '',
          name: c.first_name || c.name || email,
          firm: c.firm || '',
          industry: c.industry || '',
        });
      }
    } else {
      return res.status(400).json({ error: 'contactIds or contacts required' });
    }

    if (!contactsToSend.length) {
      return res.status(400).json({
        error: 'No eligible contacts to send to',
        skipped,
      });
    }

    const jobId = genJobId();
    bulkJobs.set(jobId, {
      jobId,
      status: 'starting',
      current: 0,
      total: contactsToSend.length,
      results: [],
      skipped,
      started_at: new Date().toISOString(),
    });

    // Is this a CSV-mode job? Track originals so we can auto-import
    // successfully-sent recipients into the CRM at the end.
    const isCsvMode = Array.isArray(csvContacts);
    const originalsByEmail = {};
    if (isCsvMode) {
      for (const c of contactsToSend) originalsByEmail[c.email] = c;
    }

    // Run the sends in the background so the request returns fast.
    setImmediate(async () => {
      const job = bulkJobs.get(jobId);
      job.status = 'running';
      try {
        await bulkSend({
          contacts: contactsToSend, subject, body, delayMs,
          onProgress: ({ current, total, results, last }) => {
            job.current = current;
            job.total = total;
            job.results = results;
            job.last = last;
          },
          shouldCancel: () => !!job.cancelled,
        });

        // Auto-import CSV recipients who successfully received an email.
        // (In-CRM recipients were already skipped at preflight; only
        // brand-new CSV contacts reach this point.)
        if (isCsvMode) {
          let imported = 0;
          for (const r of (job.results || [])) {
            if (r.status !== 'sent') continue;
            const orig = originalsByEmail[r.email];
            if (!orig) continue;
            const existing = db.prepare('SELECT id FROM contacts WHERE LOWER(email) = ?').get(r.email);
            if (existing) continue;
            const name = orig.first_name
              ? (orig.last_name ? `${orig.first_name} ${orig.last_name}` : orig.first_name)
              : r.email;
            const source = 'CSV Bulk Send';
            db.prepare(`
              INSERT INTO contacts (id, name, firm, email, industry, pipeline_stage, source, reply_status, notes)
              VALUES (?, ?, ?, ?, ?, 'Lead', ?, 'Sent', ?)
            `).run(
              uuidv4(), name, orig.firm || null, r.email, orig.industry || null,
              source, 'Auto-added after bulk email send',
            );
            imported++;
          }
          job.auto_imported = imported;
        }

        job.status = job.cancelled ? 'cancelled' : 'complete';
        job.finished_at = new Date().toISOString();
      } catch (err) {
        job.status = 'error';
        job.error = err && err.message;
      }
    });

    // Clean up jobs older than 1 hour to keep memory bounded
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, j] of bulkJobs) {
      if (j.finished_at && new Date(j.finished_at).getTime() < cutoff) bulkJobs.delete(id);
    }

    res.json({ ok: true, jobId, total: contactsToSend.length, skipped: skipped.length });
  } catch (err) {
    console.error('[bulk-send]', err && err.stack ? err.stack : err);
    res.status(500).json({ error: err && err.message });
  }
});

// Poll for progress + results
router.get('/bulk-progress/:jobId', (req, res) => {
  const job = bulkJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  res.json(job);
});

// Cancel an in-progress bulk job. The running loop checks this flag
// between each send and exits on true; any remaining contacts are
// reported as 'cancelled' in the results.
router.post('/bulk-cancel/:jobId', (req, res) => {
  const job = bulkJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'complete' || job.status === 'error' || job.status === 'cancelled') {
    return res.json({ ok: true, status: job.status, message: 'Job already finished' });
  }
  job.cancelled = true;
  res.json({ ok: true, status: 'cancelling' });
});

// After a CSV bulk send completes, the user can optionally import the
// recipients as CRM contacts at Lead stage
router.post('/bulk-import-csv', (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ error: 'contacts array required' });
    let created = 0, existed = 0;
    for (const c of contacts) {
      const email = String(c.email || '').toLowerCase().trim();
      if (!email) continue;
      const existing = db.prepare('SELECT id FROM contacts WHERE LOWER(email) = ?').get(email);
      if (existing) { existed++; continue; }
      const name = c.first_name
        ? (c.last_name ? `${c.first_name} ${c.last_name}` : c.first_name)
        : email;
      db.prepare(`
        INSERT INTO contacts (id, name, firm, email, industry, pipeline_stage, source, reply_status)
        VALUES (?, ?, ?, ?, ?, 'Lead', 'CSV Bulk Import', 'Sent')
      `).run(uuidv4(), name, c.firm || null, email, c.industry || null);
      created++;
    }
    res.json({ ok: true, created, existed });
  } catch (err) {
    console.error('[bulk-import-csv]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
