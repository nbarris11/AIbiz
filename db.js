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

// Migration: add auto-follow-up tracking columns to contacts
try {
  const cols = db.prepare('PRAGMA table_info(contacts)').all();
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('follow_up_sent_at')) {
    db.exec('ALTER TABLE contacts ADD COLUMN follow_up_sent_at TEXT');
  }
  if (!colNames.includes('follow_up_paused')) {
    db.exec('ALTER TABLE contacts ADD COLUMN follow_up_paused INTEGER NOT NULL DEFAULT 0');
  }
} catch (e) { /* ignore */ }

// Create unique index (always safe — IF NOT EXISTS, and the column now definitely exists)
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_source_msg ON activities(source_message_id) WHERE source_message_id IS NOT NULL');
} catch (e) { /* ignore if index creation fails (e.g. existing duplicates) */ }

// Seed default templates on first run (only if table is empty).
// For users with existing templates, newly-added seed entries are added below via a
// separate idempotent insert keyed by name.
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

// Additional templates — idempotent, only inserted if a template with that name doesn't exist yet
const additionalTemplates = [
  {
    name: 'Cold Outreach — Admin Load',
    subject: '{{firm}} — quick question about your admin load',
    body: `Hi {{firstName}},

I run a small advisory firm called Sidecar that helps professional service firms in Metro Detroit cut the time they spend on admin, follow-up, and repetitive tasks — usually by 5 to 10 hours a week.

Most [insurance agencies / law firms / CPA offices] at your size are still doing renewal follow-up, client intake, and status updates by hand. It adds up fast, and it usually means the owner is the one plugging the holes.

I offer a free 45-minute Clarity Session where I map out exactly where the bottlenecks are and give you a written estimate of what you could save. No pitch deck, no retainer ask on the call. You walk away with a real number. Most firms see a path to at least $5,000 in recovered time annually.

Worth a quick look? sidecaradvisory.com`,
  },
  {
    name: 'Research Question — Client Intake',
    subject: 'Quick question about how {{firm}} handles client intake',
    body: `Hi {{firstName}},

I've been doing some research on [CPA / estate planning / financial advisory] firms in the [city] area, and I have a genuine question for you — how are you currently handling [client document collection / new client intake / recurring client communication]? Still mostly manual, or have you gotten something automated?

I ask because I work with a handful of firms your size on exactly this, and the answer varies a lot more than I expected. Some are surprisingly ahead of the curve; most are doing it the way they always have.

Either way, I'd love to hear what's working and what isn't. I'm not trying to sell you anything on this email. If there's alignment after a quick conversation, great. If not, I'll at least have learned something.

Worth a 20-minute chat sometime? I'm flexible.`,
  },
  {
    name: 'Sidecar Advisory — Quick Intro',
    subject: 'Sidecar Advisory — quick intro',
    body: `Hi {{firstName}},

My name is Neil Barris. I run a firm called Sidecar Advisory out of Metro Detroit. We help small professional service businesses figure out where they're spending too much time on admin and repetitive work, and then build simple systems to get some of it back.

I came across {{firm}} and wanted to reach out because [something specific — e.g., "you've clearly built a strong reputation in the Birmingham market" / "your team looks like it's grown a lot in the last couple years"].

I don't have a specific ask here. Just wanted to introduce myself and see if there's any overlap between what you're working on and what we do. If there is, I'd love to find 20 minutes to compare notes.

No pressure either way.`,
  },
  {
    name: 'Case Study — Similar Firm',
    subject: '{{firm}} — something a [CPA / insurance agency / law firm] just told me',
    body: `Hi {{firstName}},

I was just wrapping up a project with a [CPA firm / insurance agency / law office] in [city] — three-person team, similar size to {{firm}}. They'd been spending close to 6 hours a week chasing client documents and sending follow-up emails by hand.

We built a simple intake and follow-up workflow for them. It took about a day to set up. They got those 6 hours back the first week.

I'm not saying your situation is the same. But I'm noticing that most [CPAs / agency owners / attorneys] at your stage are dealing with a version of the same thing, and most haven't had a chance to look at it clearly.

I offer a free 45-minute Clarity Session to do exactly that. No charge, no commitment. Just a real look at where the time is going and what a fix might look like. Interested? sidecaradvisory.com`,
  },
  {
    name: 'Referral Partnership Ask',
    subject: '{{firm}} — your clients are probably asking about AI',
    body: `Hi {{firstName}},

I run Sidecar Advisory, a small firm in Metro Detroit that helps business owners figure out where AI and automation can actually save them time. Not the theoretical stuff — the practical, do-it-this-week kind.

I'm reaching out to you specifically because your clients are probably already asking you about this. And right now, most [CPAs / advisors / attorneys] don't have a great answer to send them to.

That's actually the reason I'm writing. I'm looking for a handful of [CPA / financial planning / legal] firms to build a referral relationship with — where if a client asks you about streamlining their operations, you have somewhere credible to send them. In return, if I'm working with a business and they need [tax help / financial planning / legal counsel], I send them to you.

No fee arrangement, no formal contract. Just two people who work with small business owners pointing each other's way when it makes sense.

Worth a conversation? Happy to keep it to 20 minutes.`,
  },
];

for (const t of additionalTemplates) {
  const exists = db.prepare('SELECT id FROM email_templates WHERE name = ?').get(t.name);
  if (!exists) {
    db.prepare('INSERT INTO email_templates (id, name, subject, body) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), t.name, t.subject, t.body);
  }
}

// Industry-specific hyper-personalization templates (cold outreach)
const industryTemplates = [
  {
    name: 'Insurance Agency — Renewal Follow-up',
    subject: '{{firm}} — quick question about your renewal follow-up',
    body: `Hi {{firstName}},

I noticed {{firm}} has built a reputation around being responsive — your reviews make that pretty clear. That kind of follow-up doesn't maintain itself at your volume, and for most independent agencies your size, renewal season is where the cracks start to show.

I just built a renewal follow-up and intake workflow for an agency in [nearby city] that was spending about 5 hours a week on manual touchpoints. They got most of that back in the first two weeks.

I offer a free 45-minute Clarity Session where I map out exactly where the time is going and give you a written estimate of what's recoverable. No pitch on the call — just a real number.

Worth a quick reply? sidecaradvisory.com`,
  },
  {
    name: 'CPA Firm — Document Workflow',
    subject: '{{firm}} — question about your tax season document workflow',
    body: `Hi {{firstName}},

I was looking at {{firm}}'s site and noticed you don't appear to have a client document portal — for a firm with [X] staff, that typically means someone is spending 4 to 6 hours a week just chasing documents during busy season.

I just worked through this with a CPA firm in [nearby city] — three partners, similar client base. We built an automated document request and follow-up workflow. Their admins got 5 hours a week back starting the first month.

I do a free 45-minute Clarity Session where I look at your current setup and give you a written estimate of what's recoverable. Most CPA firms your size find a path to at least $5,000 in recovered time annually. You can run a quick estimate first at sidecaradvisory.com/savings-calculator.

Worth a look?`,
  },
  {
    name: 'Law Firm — Intake Workflow',
    subject: '{{firm}} — a question about intake',
    body: `Hi {{firstName}},

I came across {{firm}} while looking at estate planning practices in [city]. Quick observation: your intake still appears to be [PDF-based / by phone]. For a solo practice focused on estate planning, every hour spent on intake logistics or document prep is an hour that isn't billed.

I just helped a solo estate planning attorney in [nearby city] build an intake and document assembly workflow that freed up about 6 billable hours a month. It took less than a day to set up and she's been running it without touching it since.

I offer a free 45-minute Clarity Session where I look at your current workflows and give you a written estimate of what's recoverable. No sales pitch — just a real number.

Worth a conversation?`,
  },
  {
    name: 'Real Estate Brokerage — Lead Follow-up',
    subject: '{{firm}} — question about your lead follow-up',
    body: `Hi {{firstName}},

I was looking at {{firm}} and noticed you're running [X] agents without an automated lead follow-up system. At that volume, lead response speed and transaction admin are usually where the hours disappear.

I just built a lead nurture and transaction checklist workflow for a boutique brokerage in [nearby city] — 8 agents, independent shop. Their response time on new leads dropped from hours to minutes. The broker stopped personally managing transaction paperwork.

I offer a free 45-minute Clarity Session to map out what's recoverable. I give you a written estimate at the end. No obligation.

Worth a quick reply? sidecaradvisory.com`,
  },
  {
    name: 'Dental Practice — Patient Recall',
    subject: '{{firm}} — question about patient recall',
    body: `Hi Dr. {{lastName}},

I was looking at {{firm}}'s site and noticed your new patient intake is still a printable PDF. For a practice with multiple hygienists running full days, patient recall and intake follow-up tend to be the two biggest admin bottlenecks.

I just helped a dental practice in [nearby city] automate their recall outreach and new patient intake. Their front desk went from spending 3 hours a day on outbound calls to about 30 minutes. Reappointment rate went up in the first month.

I offer a free 45-minute Clarity Session where I map out your current patient communication workflows and give you a written estimate of what's recoverable. No obligation.

Worth a quick reply? sidecaradvisory.com`,
  },
  {
    name: 'Staffing / HR Firm — Candidate Follow-up',
    subject: '{{firm}} — question about candidate follow-up',
    body: `Hi {{firstName}},

I came across {{firm}} while looking at independent staffing firms in [city]. Quick question: how are you currently handling candidate follow-up after initial contact? In my experience with firms your size, that's usually still manual — and it's typically where the most hours disappear.

I just built a candidate pipeline and client check-in workflow for a staffing firm in [nearby city] that was placing candidates in the [industry] space. They were spending about 8 hours a week on follow-up touchpoints that are now automated. Their recruiter capacity went up without adding headcount.

I offer a free 45-minute Clarity Session to map out what's recoverable at your volume. You walk away with a written estimate. No obligation.

Worth a reply to see if it makes sense? sidecaradvisory.com`,
  },
];

for (const t of industryTemplates) {
  const exists = db.prepare('SELECT id FROM email_templates WHERE name = ?').get(t.name);
  if (!exists) {
    db.prepare('INSERT INTO email_templates (id, name, subject, body) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), t.name, t.subject, t.body);
  }
}

// Seed admin user on first run
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('neil');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('sidecar2026', 10);
  db.prepare('INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)').run(uuidv4(), 'neil', hash);
  console.log('Admin user seeded: neil / sidecar2026');
}

module.exports = db;
