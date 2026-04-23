const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// Scan a bounce-message body for the email address that failed.
// Bounces tend to include the original recipient after phrases like
// "message wasn't delivered to" / "Final-Recipient: rfc822;" / "RCPT TO:<...>".
// We match our email pattern and prefer addresses adjacent to these cues.
function extractBouncedRecipient(text) {
  if (!text) return null;
  const emailRe = /\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/gi;
  const cues = [
    /Final-Recipient:\s*rfc822;\s*([\w.+-]+@[\w-]+\.[\w.-]+)/i,
    /RCPT TO:\s*<([\w.+-]+@[\w-]+\.[\w.-]+)>/i,
    /delivered to[:\s]+([\w.+-]+@[\w-]+\.[\w.-]+)/i,
    /message (?:wasn'?t|could not be|cannot be) delivered to[:\s]+([\w.+-]+@[\w-]+\.[\w.-]+)/i,
    /to[:\s]+([\w.+-]+@[\w-]+\.[\w.-]+)[\s\S]{0,80}(?:failed|undeliverable|bounced|does not exist)/i,
  ];
  for (const re of cues) {
    const m = text.match(re);
    if (m && m[1]) return m[1].toLowerCase();
  }
  // Fallback: first email in the body that isn't ours and isn't a daemon
  let m;
  while ((m = emailRe.exec(text)) !== null) {
    const addr = m[1].toLowerCase();
    if (addr === (EMAIL_USER || '').toLowerCase()) continue;
    if (/(mailer-daemon|postmaster|bounce|no-?reply)/i.test(addr)) continue;
    return addr;
  }
  return null;
}

// Parse an email body from an imapflow message. Returns plain-text.
async function extractBody(client, uid) {
  try {
    const { content } = await client.download(uid, undefined, { uid: true });
    if (!content) return null;
    const chunks = [];
    for await (const chunk of content) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const parsed = await simpleParser(raw);
    // Prefer plain text; fall back to HTML stripped to text
    if (parsed.text) return parsed.text.trim();
    if (parsed.html) return parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return null;
  } catch (err) {
    return null;
  }
}

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://app.sidecaradvisory.com').replace(/\/$/, '');
const IMAP_HOST  = process.env.EMAIL_IMAP_HOST || 'mail.privateemail.com';
const IMAP_PORT  = parseInt(process.env.EMAIL_IMAP_PORT || '993', 10);
const SMTP_HOST  = process.env.EMAIL_SMTP_HOST || 'mail.privateemail.com';
const SMTP_PORT  = parseInt(process.env.EMAIL_SMTP_PORT || '465', 10);

// Factory for IMAP clients. ImapFlow emits 'error' events on socket timeouts
// which — if unhandled — crash the whole Node process. This wires up a
// listener so a dropped connection is logged instead of fatal, and sets a
// more generous socketTimeout since Namecheap Private Email sometimes
// pauses mid-session while we're doing DB work or body downloads.
function makeImapClient() {
  const c = new ImapFlow({
    host: IMAP_HOST, port: IMAP_PORT, secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false,
    socketTimeout: 2 * 60 * 1000, // 2 min idle tolerance
  });
  c.on('error', (err) => { console.warn('[imap] socket error:', err && err.message); });
  return c;
}

// ── SMTP TRANSPORT ───────────────────────────────────
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: true,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

// Email signature appended to every outgoing email.
// Use [text](url) for links with custom display text — the HTML renderer
// will turn these into clickable anchors while bare URLs are auto-linked.
const EMAIL_SIGNATURE = `—
Neil Barris
CEO & Founder, Sidecar Advisory
📞 (248) 762-0531
🌐 [sidecaradvisory.com](https://sidecaradvisory.com)
📅 [Book a free clarity session](https://calendly.com/sidecaradvisory/30min)`;

function withSignature(body) {
  const trimmed = (body || '').trimEnd();
  // Don't double-append if signature already present (handles both markdown and rendered forms)
  if (trimmed.includes('CEO & Founder, Sidecar Advisory')) return trimmed;
  return `${trimmed}\n\n${EMAIL_SIGNATURE}`;
}

function buildTrackingPixelHtml(trackingId) {
  if (!trackingId) return '';
  const src = `${APP_BASE_URL}/t/${encodeURIComponent(trackingId)}`;
  return `<img src="${src}" alt="" width="120" style="display:block;margin-top:12px;opacity:0.85;" />`;
}

// Build the raw MIME bytes for a message (for saving to Sent via IMAP)
async function buildRawMessage(options) {
  const composer = new MailComposer(options);
  return new Promise((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

// Copy the just-sent message to the Sent folder via IMAP APPEND.
// Fails silently — the email was already delivered; we just couldn't file it.
// Wrapped in a 20-second hard timeout so a hung IMAP connection never blocks.
async function saveToSentFolder(rawMessage) {
  const task = (async () => {
    const client = makeImapClient();
    try {
      await client.connect();
      let sentFolder = null;
      for (const name of ['Sent', 'Sent Messages', 'Sent Items', 'INBOX.Sent']) {
        try {
          await client.mailboxOpen(name);
          sentFolder = name;
          break;
        } catch {}
      }
      if (!sentFolder) {
        console.warn('[sent-save] Could not find Sent folder; message delivered but not filed.');
        return;
      }
      await client.append(sentFolder, rawMessage, ['\\Seen']);
    } finally {
      await client.logout().catch(() => {});
    }
  })();

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('IMAP APPEND timed out after 20s')), 20000)
  );

  try {
    await Promise.race([task, timeout]);
  } catch (err) {
    console.warn('[sent-save]', err && err.message);
  }
}

// Open a shared IMAP connection + Sent folder once, for reuse across many sends.
// Returns { imap, sentFolder }. Caller must eventually call closeSharedImapClient().
async function openSharedImapClient() {
  const imap = makeImapClient();
  try {
    await imap.connect();
    for (const name of ['Sent', 'Sent Messages', 'Sent Items', 'INBOX.Sent']) {
      try {
        await imap.mailboxOpen(name);
        return { imap, sentFolder: name };
      } catch {}
    }
    // No Sent folder found — still return client so SMTP sends work without APPEND
    return { imap, sentFolder: null };
  } catch (err) {
    try { await imap.logout(); } catch {}
    throw err;
  }
}

async function closeSharedImapClient(shared) {
  if (!shared || !shared.imap) return;
  try { await shared.imap.logout(); } catch {}
}

// Convert a plain-text body (with optional [text](url) markdown links)
// into HTML that auto-linkifies bare URLs + email addresses, and
// preserves paragraph/line breaks.
function textToHtml(text) {
  if (!text) return '';
  // Escape HTML special chars first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 1. Markdown-style [display text](url) — do this first so the URL
  //    inside the parens doesn't get turned into a regular autolink
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" style="color:#2D5A3D;text-decoration:underline;">$1</a>'
  );

  // 2. Bare URLs → clickable links (but skip ones already inside anchors)
  html = html.replace(
    /(^|[^"'>])((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)])/g,
    (match, lead, url) => {
      const href = url.startsWith('www.') ? 'http://' + url : url;
      return `${lead}<a href="${href}" style="color:#2D5A3D;text-decoration:underline;">${url}</a>`;
    }
  );

  // 3. Email addresses → mailto links
  html = html.replace(
    /(^|\s)([\w.+-]+@[\w-]+\.[\w.-]+)/g,
    '$1<a href="mailto:$2" style="color:#2D5A3D;text-decoration:underline;">$2</a>'
  );

  // 4. Preserve line breaks (paragraph gaps → <br><br>, single \n → <br>)
  html = html.replace(/\n/g, '<br>');

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #2C2418;">${html}</div>`;
}

// Rewrite all <a href="..."> links in HTML for click tracking.
// Creates a link_clicks row per link, returns new HTML with /r/:id hrefs.
// Falls back to original HTML on any error — never blocks email delivery.
function rewriteLinks(html, { activityId, campaignId, contactId, stepNumber }) {
  try {
    const linkRe = /<a(\s[^>]*)href="(https?:\/\/[^"]+)"([^>]*)>/gi;
    return html.replace(linkRe, (fullMatch, before, originalHref, after) => {
      // Skip tracking pixel links
      if (originalHref.includes('/t/')) return fullMatch;

      // Build UTM-appended destination URL
      const slug = campaignId ? campaignId.slice(0, 20) : '';
      const step = stepNumber != null ? `step-${stepNumber}` : 'direct';
      const separator = originalHref.includes('?') ? '&' : '?';
      const utmUrl = `${originalHref}${separator}utm_source=sidecar-crm&utm_medium=email&utm_campaign=${encodeURIComponent(slug)}&utm_content=${encodeURIComponent(step)}`;

      // Insert link_clicks row
      const clickId = uuidv4();
      db.prepare(
        'INSERT INTO link_clicks (id, activity_id, campaign_id, contact_id, url) VALUES (?, ?, ?, ?, ?)'
      ).run(clickId, activityId || null, campaignId || null, contactId || null, utmUrl);

      return `<a${before}href="${APP_BASE_URL}/r/${clickId}"${after}>`;
    });
  } catch (err) {
    console.warn('[link-rewrite] failed, sending original HTML:', err && err.message);
    return html;
  }
}

// Send an email.
// Params:
//   to, subject, body  — required
//   contactId          — optional; if null/undefined, skip CRM activity logging
//                        (used for CSV bulk sends to contacts not in CRM)
//   shared             — optional { imap, sentFolder } from openSharedImapClient().
//                        When provided, uses the shared connection for the IMAP APPEND
//                        instead of opening a fresh one each send (huge win for bulk).
//   campaignId         — optional; campaign UUID for link tracking + activity logging
//   stepNumber         — optional; sequence step index for UTM content tagging
async function sendEmail({ to, subject, body, contactId, shared, campaignId = null, stepNumber = null }) {
  const finalBody = withSignature(body);
  const trackingId = uuidv4();
  const activityId = uuidv4();
  const baseHtml = textToHtml(finalBody);
  const trackedHtml = rewriteLinks(baseHtml, { activityId, campaignId, contactId, stepNumber });

  const messageOptions = {
    from: `Neil Barris <${EMAIL_USER}>`,
    to,
    subject,
    text: finalBody,
    html: trackedHtml + buildTrackingPixelHtml(trackingId),
  };

  // 1. Send via SMTP (required)
  await transport.sendMail(messageOptions);

  // 2. Save to Sent folder — best-effort
  try {
    const raw = await buildRawMessage(messageOptions);
    if (shared && shared.imap && shared.sentFolder) {
      // Reuse existing connection; wrap in its own 15s timeout so one bad APPEND
      // doesn't stall a whole bulk run.
      await Promise.race([
        shared.imap.append(shared.sentFolder, raw, ['\\Seen']),
        new Promise((_, reject) => setTimeout(() => reject(new Error('APPEND timed out')), 15000)),
      ]);
    } else {
      await saveToSentFolder(raw);
    }
  } catch (err) {
    console.warn('[send-email] Sent-folder copy failed:', err && err.message);
  }

  // 3. Log as activity in the CRM (only if contactId present)
  if (contactId) {
    try {
      db.prepare(
        'INSERT INTO activities (id, contact_id, type, subject, body, logged_at, tracking_id, campaign_id, step_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(activityId, contactId, 'email_sent', subject, finalBody, new Date().toISOString(), trackingId, campaignId, stepNumber);
      db.prepare("UPDATE contacts SET updated_at=datetime('now') WHERE id=?").run(contactId);
      recomputeReplyStatus(contactId);
    } catch (err) {
      console.warn('[send-email] Activity logging failed:', err && err.message);
    }
  }
}

// ── MERGE FIELD RENDERING ────────────────────────────
// Accepts both {{firstName}} and {{first_name}} styles.
// Derived fields (name, industry label) use special logic; any other
// {{fieldname}} tag looks up the matching property on the contact object.
// This means ANY column in a bulk CSV automatically becomes a merge field.
function renderMergeFields(str, contact) {
  if (!str) return '';
  const parts = (contact.name || contact.first_name || '').split(/\s+/).filter(Boolean);
  const firstName = contact.first_name || parts[0] || contact.name || '';
  const lastName = contact.last_name || (parts.length > 1 ? parts[parts.length - 1] : '');
  const industryLabels = { insurance: 'Insurance Agency', law: 'Law Firm', cpa: 'CPA', realestate: 'Real Estate Office', other: '' };
  const industryPlurals = { insurance: 'insurance agencies', law: 'law firms', cpa: 'accounting firms', realestate: 'real estate offices', other: 'small businesses' };
  const ind = industryLabels[contact.industry] || contact.industry || '';
  const indPlural = industryPlurals[contact.industry] || 'small businesses';

  // Derived fields get computed/transformed values
  const derived = {
    name: contact.name || firstName || '',
    first_name: firstName,
    firstName,
    last_name: lastName,
    lastName,
    firm: contact.firm || contact.name || 'your business',
    industry: ind,
    industryPlural: indPlural,
  };

  return str.replace(/\{\{([a-zA-Z_][\w]*)\}\}/g, (match, field) => {
    if (field in derived) return derived[field];
    // Fall back to any raw field on the contact object — lets arbitrary
    // CSV columns work as merge fields (e.g., {{custom_opener}}, {{city}})
    if (contact[field] != null) return String(contact[field]);
    return match; // unknown — leave the {{tag}} in place so it's visible
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// SAFETY GUARD: detect any {{tags}} that survived merge-field substitution,
// which means we were about to send broken emails. Return the list of unresolved
// tags so the server can refuse.
function findUnrenderedTags(text) {
  const out = new Set();
  const re = /\{\{([a-zA-Z_][\w]*)\}\}/g;
  let m;
  while ((m = re.exec(text || '')) !== null) out.add(m[1]);
  return [...out];
}

// Scan the INBOX for bounce messages over a broad window (default 30 days)
// and flag the contacts whose addresses failed. Fast — only downloads bodies
// for actual bounce messages, ignores everything else.
async function scanForBounces(sinceDays = 30) {
  if (!EMAIL_USER || !EMAIL_PASS) return { error: 'No credentials' };
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const result = { scanned: 0, bounces_detected: 0, contacts_flagged: 0, addresses: [] };

  // Phase 1 — drain all envelopes fast, close the connection. Namecheap
  // drops idle IMAP sockets if we pause for DB work mid-iteration, so we
  // don't do ANY DB work until after the fetch completes.
  const bounceEnvelopes = [];
  {
    const client = makeImapClient();
    try {
      await client.connect();
      await client.mailboxOpen('INBOX');
      for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
        result.scanned++;
        const env = msg.envelope;
        if (!env) continue;
        const from = env.from?.[0]?.address?.toLowerCase() || '';
        const subj = (env.subject || '').toLowerCase();
        const isBounceSender = /(mailer-daemon|postmaster|mail-daemon|bounce)/i.test(from);
        const isBounceSubject = /(undeliver|delivery (status|failure)|returned to sender|failure notice|mail delivery failed|could not be delivered|address not found|rejected|mailbox unavailable)/i.test(subj);
        if (isBounceSender || isBounceSubject) {
          bounceEnvelopes.push({ uid: msg.uid, envelope: env });
        }
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }

  result.bounces_detected = bounceEnvelopes.length;
  // Pre-filter ones we've already logged (DB work now — connection already closed)
  const freshBounces = bounceEnvelopes.filter(b => {
    const mid = b.envelope.messageId;
    if (!mid) return true;
    return !db.prepare('SELECT 1 FROM activities WHERE source_message_id = ?').get(mid);
  });
  if (!freshBounces.length) return result;

  // Phase 2 — open a fresh connection and fetch bodies one-by-one. Between
  // downloads we do DB work, but the smaller number of needed fetches here
  // (only the true bounces) usually finishes before the socket idles.
  const client = makeImapClient();
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    for (const b of freshBounces) {
      try {
        const body = await extractBody(client, b.uid);
        if (!body) continue;
        const failedEmail = extractBouncedRecipient(body);
        if (!failedEmail) continue;
        const contact = db.prepare('SELECT id FROM contacts WHERE LOWER(email) = ?').get(failedEmail);
        if (!contact) continue;
        const env = b.envelope;
        const loggedAt = env.date ? new Date(env.date).toISOString() : new Date().toISOString();
        try {
          db.prepare('INSERT INTO activities (id, contact_id, type, subject, body, logged_at, source_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(uuidv4(), contact.id, 'email_bounce', env.subject || '(bounce)', body, loggedAt, env.messageId);
          db.prepare("UPDATE contacts SET reply_status='Bounced', updated_at=datetime('now') WHERE id=?").run(contact.id);
          result.contacts_flagged++;
          result.addresses.push(failedEmail);
        } catch (err) {
          if (!err.message.includes('UNIQUE')) throw err;
        }
      } catch (err) {
        console.warn('[scan-bounces] skipped one due to:', err && err.message);
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return result;
}

// Send the same templated email to many contacts, throttled.
// Each contact may carry per-recipient overrides:
//   contact._final_subject — if set, used as-is (no merge-field rendering)
//   contact._final_body    — if set, used as-is
// shouldCancel() is polled between sends; if it returns true, the loop
// exits and remaining contacts are reported as 'cancelled'.
async function bulkSend({ contacts, subject, body, delayMs = 3000, onProgress, shouldCancel }) {
  const results = [];
  let shared = null;
  try {
    shared = await openSharedImapClient();
  } catch (err) {
    console.warn('[bulk-send] could not pre-open IMAP:', err && err.message);
  }

  for (let i = 0; i < contacts.length; i++) {
    // Cancellation check — runs before each send
    if (shouldCancel && shouldCancel()) {
      // Report remaining contacts as cancelled
      for (let j = i; j < contacts.length; j++) {
        const c = contacts[j];
        results.push({
          contactId: c.id || null,
          name: c.name || c.first_name || c.email,
          email: c.email,
          status: 'cancelled',
        });
      }
      if (onProgress) { try { onProgress({ current: results.length, total: contacts.length, results, last: results[results.length - 1] }); } catch {} }
      break;
    }

    const contact = contacts[i];
    // Use per-recipient overrides if present, else render the template
    const renderedSubject = contact._final_subject != null
      ? contact._final_subject
      : renderMergeFields(subject, contact);
    const renderedBody = contact._final_body != null
      ? contact._final_body
      : renderMergeFields(body, contact);
    let entry;

    // Safety: if any {{tag}} is still unresolved, refuse to send this one.
    // Protects against a repeat of the "payload dropped custom fields" bug —
    // the server should never actually transmit literal {{tags}} to recipients.
    const unresolved = [
      ...findUnrenderedTags(renderedSubject),
      ...findUnrenderedTags(renderedBody),
    ];
    if (unresolved.length) {
      entry = {
        contactId: contact.id || null,
        name: contact.name || contact.first_name || contact.email,
        email: contact.email,
        status: 'failed',
        error: `Refused to send — unresolved merge tags: ${[...new Set(unresolved)].map(t => '{{' + t + '}}').join(', ')}`,
      };
      results.push(entry);
      if (onProgress) { try { onProgress({ current: i + 1, total: contacts.length, results, last: entry }); } catch {} }
      if (i < contacts.length - 1) await sleep(250); // small pause, no real send happened
      continue;
    }

    try {
      await sendEmail({
        to: contact.email,
        subject: renderedSubject,
        body: renderedBody,
        contactId: contact.id || null,
        shared,
      });
      entry = {
        contactId: contact.id || null,
        name: contact.name || contact.first_name || contact.email,
        email: contact.email,
        status: 'sent',
      };
    } catch (err) {
      entry = {
        contactId: contact.id || null,
        name: contact.name || contact.first_name || contact.email,
        email: contact.email,
        status: 'failed',
        error: err && err.message,
      };
    }
    results.push(entry);
    if (onProgress) {
      try { onProgress({ current: i + 1, total: contacts.length, results, last: entry }); } catch {}
    }
    // Delay between sends (skip after the last one)
    if (i < contacts.length - 1) await sleep(delayMs);
  }

  await closeSharedImapClient(shared);
  return results;
}

// ── AUTO REPLY STATUS ────────────────────────────────
// Recompute reply_status from email activity.
// Rules:
//   • Already 'Booked' or 'Not Interested' → leave alone (terminal/manual states)
//   • Has at least one email_received from this contact → 'Replied'
//   • Has at least one email_sent to this contact → 'Sent'
//   • Neither → 'None'
function recomputeReplyStatus(contactId) {
  const row = db.prepare('SELECT reply_status FROM contacts WHERE id = ?').get(contactId);
  if (!row) return;
  // Terminal states — never overwrite these. 'Bounced' is included because
  // once an address fails, subsequent outbound sends to the same contact
  // (e.g. if we retry before updating the email) shouldn't silently flip
  // it back to 'Sent'.
  const terminalStatuses = ['Booked', 'Not Interested', 'Bounced', 'Replied — Interested', 'Replied — Not Now', 'Replied — Not Interested', 'Unsubscribed'];
  if (terminalStatuses.includes(row.reply_status)) return;

  const activities = db.prepare(
    'SELECT type FROM activities WHERE contact_id = ? AND type IN (?, ?)'
  ).all(contactId, 'email_sent', 'email_received');

  const hasReceived = activities.some(a => a.type === 'email_received');
  const hasSent     = activities.some(a => a.type === 'email_sent');

  let newStatus = 'None';
  if (hasReceived) newStatus = 'Replied';
  else if (hasSent) newStatus = 'Sent';

  if (newStatus !== row.reply_status) {
    db.prepare('UPDATE contacts SET reply_status = ? WHERE id = ?').run(newStatus, contactId);
  }
}

function recomputeAllReplyStatuses() {
  const contacts = db.prepare('SELECT id FROM contacts').all();
  for (const c of contacts) recomputeReplyStatus(c.id);
  return contacts.length;
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

  const lastSync = getSyncState('last_sync_at');
  const since = lastSync
    ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  // ─── PHASE 1 ─── drain envelopes from INBOX + Sent with NO DB work.
  // Namecheap drops idle IMAP sockets if we pause mid-iteration; we keep
  // phase 1 purely network so it finishes before the socket times out.
  const inboxEnvs = [];
  const sentEnvs  = [];
  let sentName = null;

  {
    const client = makeImapClient();
    try {
      await client.connect();

      await client.mailboxOpen('INBOX');
      for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
        if (msg.envelope) inboxEnvs.push({ uid: msg.uid, envelope: msg.envelope });
      }

      for (const name of ['Sent', 'Sent Messages', 'Sent Items', 'INBOX.Sent']) {
        try {
          await client.mailboxOpen(name);
          sentName = name;
          break;
        } catch {}
      }
      if (sentName) {
        for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
          if (msg.envelope) sentEnvs.push({ uid: msg.uid, envelope: msg.envelope });
        }
      }
    } catch (err) {
      console.warn('[email sync] Phase 1 error:', err && err.message);
      try { await client.logout(); } catch {}
      return;
    }
    await client.logout().catch(() => {});
  }

  // ─── PHASE 2 (DB) ─── classify and pick which ones need a body fetch.
  // No IMAP calls here — safe to spend as much time as we need.
  const toLog = []; // { uid, mailbox, envelope, type, contactId, bounceTarget?, needsBody }

  // INBOX: either bounce or normal inbound reply
  for (const e of inboxEnvs) {
    const env = e.envelope;
    const messageId = env.messageId;
    if (!messageId) continue;
    if (db.prepare('SELECT 1 FROM activities WHERE source_message_id = ?').get(messageId)) continue;

    const fromAddr = env.from?.[0]?.address?.toLowerCase() || '';
    const subject  = (env.subject || '').toLowerCase();
    const isBounceSender  = /(mailer-daemon|postmaster|mail-daemon|bounce)/i.test(fromAddr);
    const isBounceSubject = /(undeliver|delivery (status|failure)|returned to sender|failure notice|mail delivery failed|could not be delivered|address not found|rejected|mailbox unavailable)/i.test(subject);

    if (isBounceSender || isBounceSubject) {
      toLog.push({ uid: e.uid, mailbox: 'INBOX', envelope: env, type: 'email_bounce', needsBody: true });
    } else if (fromAddr && fromAddr !== EMAIL_USER.toLowerCase()) {
      const contact = findContactByEmail(fromAddr);
      if (contact) {
        toLog.push({ uid: e.uid, mailbox: 'INBOX', envelope: env, type: 'email_received', contactId: contact.id, needsBody: true });
      }
    }
  }

  // Sent: match recipient to contact; no body fetch needed (you wrote it)
  for (const e of sentEnvs) {
    const env = e.envelope;
    const messageId = env.messageId;
    if (!messageId) continue;
    if (db.prepare('SELECT 1 FROM activities WHERE source_message_id = ?').get(messageId)) continue;

    const toAddrs = (env.to || []).concat(env.cc || []).map(a => a.address?.toLowerCase()).filter(Boolean);
    for (const addr of toAddrs) {
      if (addr && addr !== EMAIL_USER.toLowerCase()) {
        const contact = findContactByEmail(addr);
        if (contact) {
          toLog.push({ uid: e.uid, mailbox: sentName, envelope: env, type: 'email_sent', contactId: contact.id, needsBody: false });
          break;
        }
      }
    }
  }

  // Quickly handle the no-body-needed ones right now (all Sent entries)
  let synced = 0;
  for (const item of toLog) {
    if (item.needsBody) continue;
    synced += writeSyncedActivity(item, null) ? 1 : 0;
  }

  // ─── PHASE 3 ─── short second connection JUST for body fetches.
  const needBodies = toLog.filter(x => x.needsBody);
  if (needBodies.length) {
    const client = makeImapClient();
    try {
      await client.connect();
      let currentMailbox = null;
      for (const item of needBodies) {
        try {
          if (currentMailbox !== item.mailbox) {
            await client.mailboxOpen(item.mailbox);
            currentMailbox = item.mailbox;
          }
          const body = await extractBody(client, item.uid);
          if (item.type === 'email_bounce') {
            if (!body) continue;
            const failedEmail = extractBouncedRecipient(body);
            if (!failedEmail) continue;
            const contact = findContactByEmail(failedEmail);
            if (!contact) continue;
            item.contactId = contact.id;
            item.bounceTarget = failedEmail;
          }
          synced += writeSyncedActivity(item, body) ? 1 : 0;
        } catch (err) {
          console.warn('[email sync] skipped one body fetch:', err && err.message);
        }
      }
    } catch (err) {
      console.warn('[email sync] Phase 3 error:', err && err.message);
    } finally {
      await client.logout().catch(() => {});
    }
  }

  // Reconcile: any contact with an email_bounce activity should be flagged
  // Bounced. This self-heals if a recompute accidentally overwrote the flag.
  try {
    db.prepare(`
      UPDATE contacts
      SET reply_status = 'Bounced'
      WHERE id IN (SELECT DISTINCT contact_id FROM activities WHERE type = 'email_bounce')
      AND reply_status NOT IN ('Booked', 'Not Interested', 'Bounced', 'Replied — Interested', 'Replied — Not Now', 'Replied — Not Interested', 'Unsubscribed')
    `).run();
  } catch {}

  setSyncState('last_sync_at', new Date().toISOString());
  if (synced > 0) console.log(`[email sync] Logged ${synced} new email(s)`);
}

// Helper — does the actual INSERT + status update for a single synced message.
// Returns true if a row was inserted, false otherwise.
function writeSyncedActivity(item, body) {
  try {
    const env = item.envelope;
    const subject = env.subject || '(no subject)';
    const loggedAt = env.date ? new Date(env.date).toISOString() : new Date().toISOString();
    db.prepare('INSERT INTO activities (id, contact_id, type, subject, body, logged_at, source_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), item.contactId, item.type, subject, body || null, loggedAt, env.messageId);
    db.prepare("UPDATE contacts SET updated_at=datetime('now') WHERE id=?").run(item.contactId);
    if (item.type === 'email_bounce') {
      db.prepare("UPDATE contacts SET reply_status = 'Bounced' WHERE id = ?").run(item.contactId);
      if (item.bounceTarget) console.log(`[bounce] ${item.bounceTarget} bounced (contact flagged)`);
    } else {
      recomputeReplyStatus(item.contactId);
    }
    return true;
  } catch (err) {
    if (!err.message.includes('UNIQUE')) console.warn('[email sync] insert failed:', err.message);
    return false;
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
    for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
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
          uid: msg.uid,
          mailbox: mailboxName,
        });
      }
    }
  } catch (err) {
    console.warn(`[import] Could not scan ${mailboxName}:`, err.message);
  }
}

// Backfill email bodies for activities that don't have them yet.
// Looks up each activity by source_message_id in the inbox + sent folders.
async function backfillEmailBodies() {
  if (!EMAIL_USER || !EMAIL_PASS) return { error: 'No credentials' };

  const activities = db.prepare(
    "SELECT id, source_message_id FROM activities WHERE source_message_id IS NOT NULL AND (body IS NULL OR body = '') AND type IN ('email_sent','email_received')"
  ).all();

  if (!activities.length) return { updated: 0, total: 0 };

  const client = makeImapClient();
  let updated = 0;

  try {
    await client.connect();
    // Build a lookup of message_id → {uid, mailbox} by scanning both folders once
    const mailboxesToScan = ['INBOX'];
    for (const sentName of ['Sent', 'Sent Messages', 'Sent Items', 'INBOX.Sent']) {
      try {
        await client.mailboxOpen(sentName);
        mailboxesToScan.push(sentName);
        break;
      } catch {}
    }

    const messageIdToLocation = new Map();
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    for (const mbName of mailboxesToScan) {
      await client.mailboxOpen(mbName);
      for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
        const mid = msg.envelope?.messageId;
        if (mid && !messageIdToLocation.has(mid)) {
          messageIdToLocation.set(mid, { uid: msg.uid, mailbox: mbName });
        }
      }
    }

    // Fetch bodies for activities whose messages we found
    const updateStmt = db.prepare('UPDATE activities SET body = ? WHERE id = ?');
    for (const act of activities) {
      const loc = messageIdToLocation.get(act.source_message_id);
      if (!loc) continue;
      await client.mailboxOpen(loc.mailbox);
      const body = await extractBody(client, loc.uid);
      if (body) {
        updateStmt.run(body, act.id);
        updated++;
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return { updated, total: activities.length };
}

async function importContactsFromInbox() {
  if (!EMAIL_USER || !EMAIL_PASS) {
    return { error: 'No email credentials configured' };
  }

  const client = makeImapClient();

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

    // Log each message as an activity (dedup by source_message_id — unique index prevents duplicates)
    for (const msg of data.messages) {
      if (!msg.messageId) continue;
      const type = msg.direction === 'inbox' ? 'email_received' : 'email_sent';
      const loggedAt = msg.date ? new Date(msg.date).toISOString() : new Date().toISOString();
      try {
        db.prepare('INSERT INTO activities (id, contact_id, type, subject, logged_at, source_message_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), contact.id, type, msg.subject, loggedAt, msg.messageId);
        markMessageSynced(msg.messageId);
        activitiesLogged++;
      } catch (err) {
        // Unique constraint violation means we already logged this message — that's fine
        if (!err.message.includes('UNIQUE')) throw err;
      }
    }
    // Auto-set reply_status based on the activity we just logged
    recomputeReplyStatus(contact.id);
  }

  setSyncState('last_sync_at', new Date().toISOString());

  return {
    scanned: collected.size,
    created,
    already_existed: updated,
    activities_logged: activitiesLogged,
  };
}

// ── AUTO FOLLOW-UPS ──────────────────────────────────
// Settings stored in email_sync_state keyed by:
//   auto_followup_enabled ('1'/'0')  — master switch, default OFF
//   auto_followup_delay_days (number) — default 2
//   auto_followup_template_id (uuid)  — which template to send

function getFollowUpSettings() {
  return {
    enabled: getSyncState('auto_followup_enabled') === '1',
    delayDays: parseInt(getSyncState('auto_followup_delay_days') || '2', 10),
    templateId: getSyncState('auto_followup_template_id') || null,
  };
}

function setFollowUpSettings({ enabled, delayDays, templateId }) {
  if (typeof enabled !== 'undefined')
    setSyncState('auto_followup_enabled', enabled ? '1' : '0');
  if (typeof delayDays !== 'undefined')
    setSyncState('auto_followup_delay_days', String(delayDays));
  if (typeof templateId !== 'undefined')
    setSyncState('auto_followup_template_id', templateId || '');
}

// Identify contacts due for an auto-follow-up.
// Rules:
//   • Has an email_sent activity AT LEAST delayDays ago
//   • No email_received activity AFTER that initial send
//   • reply_status not in ('Replied', 'Booked', 'Not Interested')
//   • follow_up_sent_at IS NULL (never had an auto follow-up)
//   • follow_up_paused = 0 (user didn't disable follow-ups for them)
//   • has a real email address
function findFollowUpCandidates(delayDays) {
  const cutoff = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT c.id, c.name, c.firm, c.email, c.industry, c.pipeline_stage, c.reply_status,
      (SELECT MAX(logged_at) FROM activities WHERE contact_id = c.id AND type = 'email_sent') as last_sent_at,
      (SELECT MAX(logged_at) FROM activities WHERE contact_id = c.id AND type = 'email_received') as last_received_at
    FROM contacts c
    WHERE c.email IS NOT NULL AND c.email != ''
      AND c.follow_up_sent_at IS NULL
      AND c.follow_up_paused = 0
      AND c.reply_status NOT IN ('Replied','Booked','Not Interested','Replied — Interested','Replied — Not Now','Replied — Not Interested','Unsubscribed','Bounced')
      AND EXISTS (SELECT 1 FROM activities WHERE contact_id = c.id AND type = 'email_sent' AND logged_at <= ?)
      AND NOT EXISTS (
        SELECT 1 FROM activities a2 WHERE a2.contact_id = c.id AND a2.type = 'email_received'
        AND a2.logged_at > (SELECT MAX(logged_at) FROM activities WHERE contact_id = c.id AND type = 'email_sent')
      )
  `).all(cutoff);
}

function applyTemplateOnServer(template, contact) {
  const parts = (contact.name || '').split(/\s+/).filter(Boolean);
  const firstName = parts[0] || contact.name || '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  const industryLabels = { insurance: 'Insurance Agency', law: 'Law Firm', cpa: 'CPA', realestate: 'Real Estate Office', other: '' };
  const industryPlurals = { insurance: 'insurance agencies', law: 'law firms', cpa: 'accounting firms', realestate: 'real estate offices', other: 'small businesses' };
  const ind = industryLabels[contact.industry] || '';
  const indPlural = industryPlurals[contact.industry] || 'small businesses';
  const replace = s => (s || '')
    .replace(/\{\{name\}\}/g, contact.name || '')
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{lastName\}\}/g, lastName)
    .replace(/\{\{firm\}\}/g, contact.firm || contact.name || 'your business')
    .replace(/\{\{industry\}\}/g, ind)
    .replace(/\{\{industryPlural\}\}/g, indPlural);
  return { subject: replace(template.subject), body: replace(template.body) };
}

// Eastern Time business hours check: Mon-Fri, 9am-5pm ET
function isWithinBusinessHours(now = new Date()) {
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit', weekday: 'short', hour: 'numeric', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(etFormatter.formatToParts(now).map(p => [p.type, p.value]));
  const weekday = parts.weekday;
  const hour = parseInt(parts.hour, 10);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return hour >= 9 && hour < 17;
}

async function runFollowUpSweep() {
  const settings = getFollowUpSettings();
  if (!settings.enabled) return { skipped: 'disabled', sent: 0 };
  if (!settings.templateId) return { skipped: 'no template configured', sent: 0 };
  if (!isWithinBusinessHours()) return { skipped: 'outside business hours', sent: 0 };

  const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(settings.templateId);
  if (!template) return { skipped: 'template not found', sent: 0 };

  const candidates = findFollowUpCandidates(settings.delayDays);
  let sent = 0;
  const failed = [];

  for (const contact of candidates) {
    try {
      const { subject, body } = applyTemplateOnServer(template, contact);
      await sendEmail({ to: contact.email, subject, body, contactId: contact.id });
      db.prepare('UPDATE contacts SET follow_up_sent_at = datetime(\'now\') WHERE id = ?').run(contact.id);
      sent++;
      // Small pause between sends so we don't hammer SMTP
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      failed.push({ contactId: contact.id, error: err.message });
    }
  }

  if (sent > 0) console.log(`[auto-followup] Sent ${sent} follow-up(s); ${failed.length} failed`);
  return { sent, failed, total_candidates: candidates.length };
}

// Preview — who would we send to if we ran a sweep right now.
// Also returns diagnostic info so the UI can explain an empty queue.
function previewFollowUpQueue() {
  const settings = getFollowUpSettings();
  const candidates = findFollowUpCandidates(settings.delayDays);

  // Diagnostics: count contacts in "Sent" status who aren't old enough yet,
  // and find the most-recent email_sent timestamp across them.
  const waiting = db.prepare(`
    SELECT c.id, c.name, c.firm,
      (SELECT MAX(logged_at) FROM activities WHERE contact_id = c.id AND type = 'email_sent') as last_sent_at
    FROM contacts c
    WHERE c.email IS NOT NULL AND c.email != ''
      AND c.follow_up_sent_at IS NULL
      AND c.follow_up_paused = 0
      AND c.reply_status NOT IN ('Replied','Booked','Not Interested')
      AND EXISTS (SELECT 1 FROM activities WHERE contact_id = c.id AND type = 'email_sent')
      AND NOT EXISTS (
        SELECT 1 FROM activities a2 WHERE a2.contact_id = c.id AND a2.type = 'email_received'
        AND a2.logged_at > (SELECT MAX(logged_at) FROM activities WHERE contact_id = c.id AND type = 'email_sent')
      )
  `).all();

  // Oldest "waiting" contact — the one closest to being eligible
  let nextEligibleAt = null;
  let totalWaiting = 0;
  for (const w of waiting) {
    const isCandidate = candidates.some(c => c.id === w.id);
    if (!isCandidate && w.last_sent_at) {
      totalWaiting++;
      // SQLite datetime() format: "YYYY-MM-DD HH:MM:SS" — normalize to ISO
      const iso = w.last_sent_at.includes('T') ? w.last_sent_at : w.last_sent_at.replace(' ', 'T') + 'Z';
      const parsed = new Date(iso);
      if (isNaN(parsed.getTime())) continue;
      const eligibleAt = new Date(parsed.getTime() + settings.delayDays * 24 * 60 * 60 * 1000);
      if (!nextEligibleAt || eligibleAt < nextEligibleAt) nextEligibleAt = eligibleAt;
    }
  }

  return {
    settings,
    candidates,
    within_business_hours: isWithinBusinessHours(),
    diagnostics: {
      total_no_reply_contacts: waiting.length,
      waiting_to_age: totalWaiting,
      next_eligible_at: nextEligibleAt ? nextEligibleAt.toISOString() : null,
    },
  };
}

function startFollowUpScheduler() {
  // Check every 30 minutes
  setInterval(() => {
    runFollowUpSweep().catch(err => console.error('[auto-followup] sweep error:', err.message));
  }, 30 * 60 * 1000);
  console.log('[auto-followup] Scheduler started — sweeps every 30 min during business hours');
}

// Run sync on a 5-minute interval with a hard timeout per run so a hung
// IMAP connection can't stall the whole system. If one run overlaps the
// next, we skip rather than running two concurrently.
let _syncInFlight = false;
async function syncInboxWithGuard() {
  if (_syncInFlight) {
    console.log('[email sync] Previous sync still running, skipping this tick');
    return;
  }
  _syncInFlight = true;
  try {
    await Promise.race([
      syncInbox(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('sync timed out after 4 min')), 4 * 60 * 1000)),
    ]);
  } catch (err) {
    console.warn('[email sync] Failed:', err && err.message);
  } finally {
    _syncInFlight = false;
  }
}

function startEmailSync() {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.log('[email sync] No credentials configured, skipping.');
    return;
  }
  syncInboxWithGuard();
  setInterval(syncInboxWithGuard, 5 * 60 * 1000);
  console.log('[email sync] Started — polling every 5 minutes (4-min timeout per run)');
}

module.exports = {
  sendEmail, startEmailSync, syncInbox, importContactsFromInbox,
  recomputeAllReplyStatuses, backfillEmailBodies, EMAIL_SIGNATURE,
  getFollowUpSettings, setFollowUpSettings, runFollowUpSweep,
  previewFollowUpQueue, startFollowUpScheduler,
  bulkSend, renderMergeFields, scanForBounces, isWithinBusinessHours,
};
