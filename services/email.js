const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const IMAP_HOST  = process.env.EMAIL_IMAP_HOST || 'mail.privateemail.com';
const IMAP_PORT  = parseInt(process.env.EMAIL_IMAP_PORT || '993', 10);
const SMTP_HOST  = process.env.EMAIL_SMTP_HOST || 'mail.privateemail.com';
const SMTP_PORT  = parseInt(process.env.EMAIL_SMTP_PORT || '465', 10);

// ── SMTP TRANSPORT ───────────────────────────────────
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: true,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

async function sendEmail({ to, subject, body, contactId }) {
  await transport.sendMail({
    from: `Neil Barris <${EMAIL_USER}>`,
    to,
    subject,
    text: body,
  });
  // Log as activity
  db.prepare('INSERT INTO activities (id, contact_id, type, subject, body, logged_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), contactId, 'email_sent', subject, body, new Date().toISOString());
  db.prepare("UPDATE contacts SET updated_at=datetime('now') WHERE id=?").run(contactId);
}

// ── IMAP SYNC ────────────────────────────────────────
function getSyncState(key) {
  const row = db.prepare('SELECT value FROM email_sync_state WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSyncState(key, value) {
  db.prepare('INSERT INTO email_sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value);
}

function isMessageSynced(messageId) {
  return !!db.prepare('SELECT 1 FROM synced_message_ids WHERE message_id = ?').get(messageId);
}

function markMessageSynced(messageId) {
  db.prepare('INSERT OR IGNORE INTO synced_message_ids (message_id) VALUES (?)').run(messageId);
}

function findContactByEmail(address) {
  if (!address) return null;
  return db.prepare('SELECT id FROM contacts WHERE LOWER(email) = LOWER(?) LIMIT 1').get(address);
}

async function syncInbox() {
  if (!EMAIL_USER || !EMAIL_PASS) return;

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    // Fetch emails from the last 60 days on first run, last 3 days on subsequent runs
    const lastSync = getSyncState('last_sync_at');
    const since = lastSync
      ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const messages = client.fetch(
      { since },
      { envelope: true, bodyStructure: true, source: false }
    );

    let synced = 0;
    for await (const msg of messages) {
      const env = msg.envelope;
      if (!env) continue;

      const messageId = env.messageId;
      if (!messageId || isMessageSynced(messageId)) continue;

      const fromAddr = env.from?.[0]?.address?.toLowerCase();
      const toAddrs = (env.to || []).map(a => a.address?.toLowerCase()).filter(Boolean);

      // Determine direction and find matching contact
      let contact = null;
      let type = null;

      if (fromAddr && fromAddr !== EMAIL_USER.toLowerCase()) {
        contact = findContactByEmail(fromAddr);
        type = 'email_received';
      }
      if (!contact) {
        for (const addr of toAddrs) {
          if (addr !== EMAIL_USER.toLowerCase()) {
            contact = findContactByEmail(addr);
            if (contact) { type = 'email_sent'; break; }
          }
        }
      }

      if (contact && type) {
        const subject = env.subject || '(no subject)';
        const loggedAt = env.date ? new Date(env.date).toISOString() : new Date().toISOString();
        db.prepare('INSERT INTO activities (id, contact_id, type, subject, logged_at) VALUES (?, ?, ?, ?, ?)')
          .run(uuidv4(), contact.id, type, subject, loggedAt);
        db.prepare("UPDATE contacts SET updated_at=datetime('now') WHERE id=?").run(contact.id);
        synced++;
      }

      markMessageSynced(messageId);
    }

    setSyncState('last_sync_at', new Date().toISOString());
    if (synced > 0) console.log(`[email sync] Logged ${synced} new email(s)`);
  } catch (err) {
    console.error('[email sync] Error:', err.message);
  } finally {
    await client.logout().catch(() => {});
  }
}

// Run sync on a 5-minute interval
function startEmailSync() {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.log('[email sync] No credentials configured, skipping.');
    return;
  }
  syncInbox();
  setInterval(syncInbox, 5 * 60 * 1000);
  console.log('[email sync] Started — polling every 5 minutes');
}

module.exports = { sendEmail, startEmailSync, syncInbox };
