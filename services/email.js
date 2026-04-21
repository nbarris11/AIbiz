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

// ── CONTACT IMPORT FROM INBOX ────────────────────────
const EXCLUDE_PATTERNS = [
  /^noreply@/i, /^no-reply@/i, /^donotreply@/i, /^do-not-reply@/i,
  /^mailer-daemon@/i, /^postmaster@/i, /^bounce/i, /^bounces@/i,
  /^notifications?@/i, /^alert@/i, /^alerts@/i, /^updates?@/i,
  /^newsletter@/i, /^news@/i, /^info@facebook\.com$/i, /^info@linkedin\.com$/i,
  /@.*\.bounce\./i, /@.*\.mailchimp\.com$/i, /@.*\.sendgrid\.net$/i,
  /@(em|bounce|reply)\./i,
];

function shouldExcludeAddress(addr) {
  if (!addr) return true;
  const lower = addr.toLowerCase();
  if (lower === EMAIL_USER.toLowerCase()) return true;
  return EXCLUDE_PATTERNS.some(p => p.test(lower));
}

function deriveNameFromEmail(address) {
  const local = address.split('@')[0];
  // Replace common separators with spaces and title-case
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function deriveFirmFromEmail(address) {
  const domain = address.split('@')[1];
  if (!domain) return null;
  // Skip generic personal-email domains
  const GENERIC = new Set([
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me',
    'live.com', 'msn.com', 'comcast.net', 'verizon.net', 'att.net',
  ]);
  if (GENERIC.has(domain.toLowerCase())) return null;
  // Use domain without TLD as firm name
  const parts = domain.split('.');
  const base = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

async function scanMailbox(client, mailboxName, direction, collected) {
  try {
    await client.mailboxOpen(mailboxName);
    // 180 days back
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    for await (const msg of client.fetch({ since }, { envelope: true })) {
      const env = msg.envelope;
      if (!env) continue;

      // Determine the "other party" addresses on this message
      const otherParties = direction === 'inbox'
        ? (env.from || []).map(a => ({ name: a.name, address: a.address }))
        : (env.to || []).concat(env.cc || []).map(a => ({ name: a.name, address: a.address }));

      for (const party of otherParties) {
        const addr = party.address?.toLowerCase();
        if (!addr || shouldExcludeAddress(addr)) continue;
        if (!collected.has(addr)) {
          collected.set(addr, {
            address: addr,
            name: party.name && party.name.trim() ? party.name.trim() : null,
            messages: [],
          });
        }
        const record = collected.get(addr);
        // Prefer a real name over null
        if (!record.name && party.name && party.name.trim()) record.name = party.name.trim();
        record.messages.push({
          messageId: env.messageId,
          subject: env.subject || '(no subject)',
          date: env.date,
          direction,
        });
      }
    }
  } catch (err) {
    console.warn(`[import] Could not scan ${mailboxName}:`, err.message);
  }
}

async function importContactsFromInbox() {
  if (!EMAIL_USER || !EMAIL_PASS) {
    return { error: 'No email credentials configured' };
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false,
  });

  const collected = new Map();

  try {
    await client.connect();

    // Scan INBOX (emails received)
    await scanMailbox(client, 'INBOX', 'inbox', collected);

    // Scan Sent folder (emails sent) — try common names
    const sentNames = ['Sent', 'Sent Messages', 'Sent Items', 'INBOX.Sent'];
    for (const name of sentNames) {
      try {
        const exists = await client.mailboxOpen(name).then(() => true).catch(() => false);
        if (exists) {
          await scanMailbox(client, name, 'sent', collected);
          break;
        }
      } catch {}
    }
  } finally {
    await client.logout().catch(() => {});
  }

  // Now create contacts and log activities
  let created = 0;
  let updated = 0;
  let activitiesLogged = 0;

  for (const [addr, data] of collected) {
    // Check if contact exists
    let contact = db.prepare('SELECT id FROM contacts WHERE LOWER(email) = LOWER(?)').get(addr);

    if (!contact) {
      const id = uuidv4();
      const name = data.name || deriveNameFromEmail(addr);
      const firm = deriveFirmFromEmail(addr);
      db.prepare(`
        INSERT INTO contacts (id, name, firm, email, pipeline_stage, source, notes)
        VALUES (?, ?, ?, ?, 'Lead', 'Imported from inbox', ?)
      `).run(id, name, firm, addr, `Auto-created from ${data.messages.length} email(s)`);
      contact = { id };
      created++;
    } else {
      updated++;
    }

    // Log each message as an activity (skip if already synced)
    for (const msg of data.messages) {
      if (!msg.messageId) continue;
      if (isMessageSynced(msg.messageId)) continue;
      const type = msg.direction === 'inbox' ? 'email_received' : 'email_sent';
      const loggedAt = msg.date ? new Date(msg.date).toISOString() : new Date().toISOString();
      db.prepare('INSERT INTO activities (id, contact_id, type, subject, logged_at) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), contact.id, type, msg.subject, loggedAt);
      markMessageSynced(msg.messageId);
      activitiesLogged++;
    }
  }

  setSyncState('last_sync_at', new Date().toISOString());

  return {
    scanned: collected.size,
    created,
    already_existed: updated,
    activities_logged: activitiesLogged,
  };
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

module.exports = { sendEmail, startEmailSync, syncInbox, importContactsFromInbox };
