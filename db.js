const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = path.join(__dirname, 'sidecar.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    firm TEXT,
    industry TEXT,
    email TEXT,
    phone TEXT,
    pipeline_stage TEXT NOT NULL DEFAULT 'Lead',
    source TEXT,
    notes TEXT,
    follow_up_date TEXT,
    reply_status TEXT NOT NULL DEFAULT 'None',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT,
    logged_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_by TEXT NOT NULL DEFAULT 'admin'
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS synced_message_ids (
    message_id TEXT PRIMARY KEY,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: add source_message_id column to activities if it doesn't exist
try {
  const cols = db.prepare('PRAGMA table_info(activities)').all();
  if (!cols.some(c => c.name === 'source_message_id')) {
    db.exec('ALTER TABLE activities ADD COLUMN source_message_id TEXT');
    console.log('Migrated: added source_message_id to activities');
  }
} catch (e) { /* ignore */ }

// Create unique index (always safe — IF NOT EXISTS, and the column now definitely exists)
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_source_msg ON activities(source_message_id) WHERE source_message_id IS NOT NULL');
} catch (e) { /* ignore if index creation fails (e.g. existing duplicates) */ }

// Seed default templates on first run
const templateCount = db.prepare('SELECT COUNT(*) as n FROM email_templates').get().n;
if (templateCount === 0) {
  const seedTemplates = [
    {
      name: 'Cold Outreach — Clarity Session',
      subject: 'Quick idea for {{firm}}',
      body: `Hi {{firstName}},

I work with Metro Detroit {{industryPlural}} to implement AI that actually moves the needle — not the generic demos that sit unused.

The way I start is with a free 45-minute Clarity Session. I look at how {{firm}} actually runs today, find the recurring admin bottlenecks, and leave you with a written workflow review. If I can't find at least $5,000 in annual savings, you walk away with the review anyway — no pitch.

Worth a quick call to see if there's something here?

— Neil Barris
Sidecar Advisory
hello@sidecaradvisory.com`,
    },
    {
      name: 'Follow-up — After No Response',
      subject: 'Re: Quick idea for {{firm}}',
      body: `Hi {{firstName}},

Circling back on this in case it got buried. Totally understand if now isn't the right time — just wanted to make sure the offer for a free Clarity Session didn't slip past you.

If you'd rather I stop following up, just reply "not now" and I'll leave you alone.

— Neil`,
    },
    {
      name: 'Post-Clarity Session Thank You',
      subject: 'Notes from our session — {{firm}}',
      body: `Hi {{firstName}},

Thanks for the time today. Here's a quick recap of what we talked about and the priorities we identified:

1. [First workflow / pain point]
2. [Second workflow / pain point]
3. [Third workflow / pain point]

Based on what you shared, the Starter Pack would be the right next step — roughly 30 days to get the first automations live, $2,500–$3,500 depending on scope. I'll send over a proposal in the next day or two.

Any questions in the meantime, just reply here.

— Neil`,
    },
    {
      name: 'Proposal Follow-up',
      subject: 'Following up on the proposal',
      body: `Hi {{firstName}},

Just checking in on the proposal I sent for {{firm}}. Happy to walk through any of it on a quick call if that's easier, or answer questions over email.

No rush either way — just want to make sure I'm not leaving you hanging.

— Neil`,
    },
    {
      name: 'Referral Request — Happy Client',
      subject: 'A quick ask',
      body: `Hi {{firstName}},

Hope things are still running smoothly since we wrapped up — let me know if anything's drifting.

Quick ask: is there anyone else in your network running a {{industry}} firm or similar small business in Metro Detroit who might get value out of a Clarity Session? I pay a $500 referral fee when a referred client engages, and I'll send the same kind of offer to them directly — no pitch, just the free workflow review.

If someone comes to mind, happy to make it easy for you.

— Neil`,
    },
    {
      name: 'Client Monthly Check-in',
      subject: '{{firm}} — monthly check-in',
      body: `Hi {{firstName}},

Quick check-in for the month:

• What's working well with the workflows we set up?
• Anything feeling rough or generating noise?
• Any new bottleneck that's popped up you'd like me to look at?

Happy to jump on a 20-minute call this week or next if easier. Otherwise, just reply here and I'll take it from there.

— Neil`,
    },
  ];
  const insert = db.prepare('INSERT INTO email_templates (id, name, subject, body) VALUES (?, ?, ?, ?)');
  for (const t of seedTemplates) insert.run(uuidv4(), t.name, t.subject, t.body);
  console.log(`Seeded ${seedTemplates.length} email templates`);
}

// Seed admin user on first run
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('neil');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('sidecar2026', 10);
  db.prepare('INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)').run(uuidv4(), 'neil', hash);
  console.log('Admin user seeded: neil / sidecar2026');
}

module.exports = db;
