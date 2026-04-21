# CRM + Client Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Node.js/Express/SQLite backend to the existing static sidecaradvisory.com site, providing a password-protected internal CRM at `/internal` and a client-facing file portal at `/portal`.

**Architecture:** Express serves existing static files from the project root unchanged. New API routes live under `/api/*`. Two new HTML pages (`/internal` and `/portal`) are rendered server-side but driven by fetch() calls to the API. SQLite via `better-sqlite3` is the single source of truth; the existing `internal/index.html` localStorage dashboard is replaced by the new backend-powered version.

**Tech Stack:** Node.js, Express 4, better-sqlite3, express-session, bcryptjs (pure JS, avoids native compile issues on Mac ARM — functionally identical to bcrypt), multer (file uploads), uuid, dotenv. No build step.

---

## Pre-flight notes

- Existing `/internal/index.html` will be **replaced** — it currently uses localStorage + passphrase. The new version uses sessions + SQLite. Old localStorage data is not migrated (it's dev-only scratch data).
- `neil-family.jpg` already exists at `/assets/neil-family.jpg`. Only the imageAlt and chips removal in site-content.js need fixing.
- `vercel.json` may need a rewrite rule to proxy `/api/*` — but since this is a local Node server, Vercel deployment is deferred. For now, `node server.js` is the dev entrypoint.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Create | NPM manifest + dependencies |
| `.env.example` | Create | Env var template |
| `server.js` | Create | Express entry point, static serving, route mounting |
| `db.js` | Create | SQLite schema, seeding, exported `db` instance |
| `routes/auth.js` | Create | POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me |
| `routes/crm.js` | Create | Full CRUD for contacts, activities, admin portal mgmt |
| `routes/portal.js` | Create | Client portal: login, file list, logout |
| `routes/files.js` | Create | File upload (admin), file download (client) |
| `middleware/requireAdmin.js` | Create | 401 if no admin session |
| `middleware/requireClient.js` | Create | 401 if no client session |
| `uploads/.gitkeep` | Create | Ensure uploads dir is tracked |
| `internal/index.html` | **Replace** | New CRM SPA; fetches from `/api/crm/*` |
| `portal/login.html` | Create | Client portal login page |
| `portal/index.html` | Create | Client portal document list page |
| `content/site-content.js` | Modify | Fix imageAlt, remove chips array |

---

## Task 1: package.json and dependencies

**Files:**
- Create: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "sidecar-advisory",
  "version": "1.0.0",
  "description": "Sidecar Advisory — CRM + client portal backend",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "bcryptjs": "^2.4.3",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-session": "^1.18.0",
    "multer": "^1.4.5-lts.1",
    "uuid": "^9.0.1"
  }
}
```

- [ ] **Step 2: Create .env.example**

```
SESSION_SECRET=your-secret-here
PORT=3000
```

- [ ] **Step 3: Run npm install**

```bash
cd "/Users/barris/Desktop/AI Business" && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat: add Node.js project scaffold with dependencies"
```

---

## Task 2: Database setup (db.js)

**Files:**
- Create: `db.js`
- Create: `uploads/.gitkeep`

- [ ] **Step 1: Create uploads directory and .gitkeep**

```bash
mkdir -p uploads && touch uploads/.gitkeep
```

- [ ] **Step 2: Create db.js**

```js
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = path.join(__dirname, 'sidecar.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    firm TEXT,
    industry TEXT CHECK(industry IN ('insurance','law','cpa','realestate','other')),
    email TEXT,
    phone TEXT,
    pipeline_stage TEXT NOT NULL DEFAULT 'Lead'
      CHECK(pipeline_stage IN ('Lead','Session Booked','Proposal Sent','Active Client','Dormant')),
    source TEXT,
    notes TEXT,
    follow_up_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT NOT NULL
      CHECK(type IN ('email_sent','email_received','call','clarity_session','proposal','note')),
    subject TEXT NOT NULL,
    body TEXT,
    logged_at TEXT NOT NULL DEFAULT (datetime('now'))
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
`);

// Seed admin user on first run
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('neil');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('sidecar2026', 10);
  db.prepare('INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(uuidv4(), 'neil', hash);
  console.log('Admin user seeded: neil / sidecar2026');
}

module.exports = db;
```

- [ ] **Step 3: Verify db.js runs without error**

```bash
cd "/Users/barris/Desktop/AI Business" && node -e "require('./db'); console.log('DB OK')"
```

Expected output: `Admin user seeded: neil / sidecar2026` then `DB OK`. `sidecar.db` should appear in the project root.

- [ ] **Step 4: Commit**

```bash
git add db.js uploads/.gitkeep
git commit -m "feat: add SQLite schema and admin seed"
```

---

## Task 3: Middleware

**Files:**
- Create: `middleware/requireAdmin.js`
- Create: `middleware/requireClient.js`

- [ ] **Step 1: Create middleware/requireAdmin.js**

```js
module.exports = function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/internal/login');
};
```

- [ ] **Step 2: Create middleware/requireClient.js**

```js
module.exports = function requireClient(req, res, next) {
  if (req.session && req.session.clientId) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/portal/login');
};
```

- [ ] **Step 3: Commit**

```bash
git add middleware/
git commit -m "feat: add requireAdmin and requireClient middleware"
```

---

## Task 4: Auth routes

**Files:**
- Create: `routes/auth.js`

- [ ] **Step 1: Create routes/auth.js**

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

// Admin login
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.json({ ok: true });
});

router.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/admin/me', (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: req.session.adminUsername });
});

// Client login
router.post('/client/login', (req, res) => {
  const { username, password } = req.body;
  const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(username);
  if (!client || !bcrypt.compareSync(password, client.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.clientId = client.id;
  req.session.clientDisplayName = client.display_name;
  res.json({ ok: true, displayName: client.display_name });
});

router.post('/client/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/client/me', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ displayName: req.session.clientDisplayName });
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/auth.js
git commit -m "feat: add auth routes for admin and client login/logout"
```

---

## Task 5: CRM API routes

**Files:**
- Create: `routes/crm.js`

- [ ] **Step 1: Create routes/crm.js**

```js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const router = express.Router();

router.use(requireAdmin);

// ── DASHBOARD STATS ──────────────────────────────────
router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM contacts').get().n;
  const active = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE pipeline_stage = 'Active Client'").get().n;
  const booked = db.prepare("SELECT COUNT(*) as n FROM contacts WHERE pipeline_stage = 'Session Booked'").get().n;
  const today = new Date().toISOString().split('T')[0];
  const followups = db.prepare('SELECT COUNT(*) as n FROM contacts WHERE follow_up_date <= ? AND follow_up_date IS NOT NULL').get(today).n;
  const pipeline = db.prepare("SELECT pipeline_stage, COUNT(*) as count FROM contacts GROUP BY pipeline_stage").all();
  const overdue = db.prepare(
    "SELECT id, name, firm, follow_up_date FROM contacts WHERE follow_up_date <= ? AND follow_up_date IS NOT NULL ORDER BY follow_up_date ASC"
  ).all(today);
  res.json({ total, active, booked, followups, pipeline, overdue });
});

// ── CONTACTS ─────────────────────────────────────────
router.get('/contacts', (req, res) => {
  const { q, industry, stage } = req.query;
  let sql = 'SELECT c.*, (SELECT logged_at FROM activities WHERE contact_id = c.id ORDER BY logged_at DESC LIMIT 1) as last_activity FROM contacts c WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (c.name LIKE ? OR c.firm LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (industry) { sql += ' AND c.industry = ?'; params.push(industry); }
  if (stage) { sql += ' AND c.pipeline_stage = ?'; params.push(stage); }
  sql += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/contacts/:id', (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  const activities = db.prepare('SELECT * FROM activities WHERE contact_id = ? ORDER BY logged_at DESC').all(req.params.id);
  const portalClient = db.prepare('SELECT id, username, display_name FROM clients WHERE contact_id = ?').get(req.params.id);
  const files = portalClient
    ? db.prepare('SELECT * FROM files WHERE client_id = ? ORDER BY uploaded_at DESC').all(portalClient.id)
    : [];
  res.json({ ...contact, activities, portalClient, files });
});

router.post('/contacts', (req, res) => {
  const { name, firm, industry, email, phone, pipeline_stage, source, notes, follow_up_date } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO contacts (id, name, firm, industry, email, phone, pipeline_stage, source, notes, follow_up_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, firm || null, industry || null, email || null, phone || null,
         pipeline_stage || 'Lead', source || null, notes || null, follow_up_date || null);
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});

router.put('/contacts/:id', (req, res) => {
  const { name, firm, industry, email, phone, pipeline_stage, source, notes, follow_up_date } = req.body;
  const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE contacts SET name=?, firm=?, industry=?, email=?, phone=?, pipeline_stage=?,
    source=?, notes=?, follow_up_date=?, updated_at=datetime('now') WHERE id=?
  `).run(name, firm || null, industry || null, email || null, phone || null,
         pipeline_stage || 'Lead', source || null, notes || null, follow_up_date || null, req.params.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id));
});

router.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── ACTIVITIES ────────────────────────────────────────
router.post('/contacts/:id/activities', (req, res) => {
  const { type, subject, body, logged_at } = req.body;
  if (!type || !subject) return res.status(400).json({ error: 'type and subject required' });
  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO activities (id, contact_id, type, subject, body, logged_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, type, subject, body || null, logged_at || new Date().toISOString());
  // Update contact updated_at
  db.prepare("UPDATE contacts SET updated_at=datetime('now') WHERE id=?").run(req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM activities WHERE id = ?').get(id));
});

// ── FOLLOW-UPS ────────────────────────────────────────
router.get('/followups', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const rows = db.prepare(
    "SELECT * FROM contacts WHERE follow_up_date IS NOT NULL ORDER BY follow_up_date ASC"
  ).all();
  res.json(rows.map(r => ({ ...r, overdue: r.follow_up_date <= today })));
});

router.post('/contacts/:id/followup', (req, res) => {
  const { follow_up_date } = req.body;
  db.prepare("UPDATE contacts SET follow_up_date=?, updated_at=datetime('now') WHERE id=?")
    .run(follow_up_date || null, req.params.id);
  res.json({ ok: true });
});

// ── OUTREACH ──────────────────────────────────────────
router.get('/outreach', (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM contacts WHERE source IS NOT NULL AND source != '' ORDER BY created_at DESC"
  ).all();
  res.json(rows);
});

router.post('/contacts/:id/reply-status', (req, res) => {
  const { reply_status } = req.body;
  db.prepare("UPDATE contacts SET notes = json_set(COALESCE(notes,'{}'), '$.reply_status', ?) WHERE id=?")
    .run(reply_status, req.params.id);
  // Store reply status in source field note — simpler: add column via migration or store in notes JSON
  // Instead: store in a dedicated way by updating source with a tag
  // Actually: we'll use a simple approach and store reply_status in a way the UI can read
  // Re-think: add reply_status as text directly in the contacts row by using notes JSON or a separate field.
  // The schema doesn't have reply_status. We'll store it in the source field suffix or use an activity.
  // CORRECT APPROACH: Add it to the update cleanly using an activity type, but that changes the schema.
  // For now: the contacts table notes field is free text. Store reply_status in a JSON prefix in notes
  // so we can read it back. This is a schema limitation we work around without a migration.
  res.json({ ok: true });
});

// ── PORTAL CLIENT MANAGEMENT ──────────────────────────
router.get('/portal-clients', (req, res) => {
  const clients = db.prepare(`
    SELECT cl.*, co.name as contact_name,
      (SELECT COUNT(*) FROM files WHERE client_id = cl.id) as file_count
    FROM clients cl
    LEFT JOIN contacts co ON cl.contact_id = co.id
    ORDER BY cl.created_at DESC
  `).all();
  res.json(clients);
});

router.post('/portal-clients', (req, res) => {
  const { display_name, username, password, contact_id } = req.body;
  if (!display_name || !username || !password) {
    return res.status(400).json({ error: 'display_name, username, and password are required' });
  }
  const existing = db.prepare('SELECT id FROM clients WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username already taken' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO clients (id, contact_id, username, password_hash, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(id, contact_id || null, username, hash, display_name);
  res.status(201).json(db.prepare('SELECT id, username, display_name, contact_id, created_at FROM clients WHERE id = ?').get(id));
});

router.post('/portal-clients/:id/reset-password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

router.delete('/portal-clients/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
```

**Important note on reply_status:** The outreach reply status needs a small schema addition. Modify the `db.js` contacts table to add `reply_status TEXT DEFAULT 'None'` and update the `router.post('/contacts/:id/reply-status'` handler in crm.js to use `UPDATE contacts SET reply_status=? WHERE id=?`.

- [ ] **Step 2: Add reply_status to contacts schema in db.js**

In `db.js`, change the contacts CREATE TABLE to add `reply_status TEXT DEFAULT 'None'` after `follow_up_date`:

```sql
reply_status TEXT NOT NULL DEFAULT 'None'
  CHECK(reply_status IN ('None','Replied','Booked','Not Interested')),
```

And fix the reply-status route in crm.js:

```js
router.post('/contacts/:id/reply-status', (req, res) => {
  const { reply_status } = req.body;
  const valid = ['None', 'Replied', 'Booked', 'Not Interested'];
  if (!valid.includes(reply_status)) return res.status(400).json({ error: 'Invalid reply_status' });
  db.prepare("UPDATE contacts SET reply_status=?, updated_at=datetime('now') WHERE id=?")
    .run(reply_status, req.params.id);
  res.json({ ok: true });
});
```

- [ ] **Step 3: Commit**

```bash
git add routes/crm.js db.js
git commit -m "feat: add CRM API routes for contacts, activities, follow-ups, outreach, portal mgmt"
```

---

## Task 6: Files route

**Files:**
- Create: `routes/files.js`

- [ ] **Step 1: Create routes/files.js**

```js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const requireClient = require('../middleware/requireClient');
const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Admin: upload file for a client
router.post('/upload/:clientId', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO files (id, client_id, filename, stored_filename) VALUES (?, ?, ?, ?)')
    .run(id, req.params.clientId, req.file.originalname, req.file.filename);
  res.status(201).json(db.prepare('SELECT * FROM files WHERE id = ?').get(id));
});

// Admin: delete file
router.delete('/file/:fileId', requireAdmin, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(UPLOADS_DIR, file.stored_filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);
  res.json({ ok: true });
});

// Client: download file (only their own files)
router.get('/download/:fileId', requireClient, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Not found' });
  if (file.client_id !== req.session.clientId) return res.status(403).json({ error: 'Forbidden' });
  const filePath = path.join(UPLOADS_DIR, file.stored_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.download(filePath, file.filename);
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/files.js
git commit -m "feat: add file upload/download routes"
```

---

## Task 7: Portal API route

**Files:**
- Create: `routes/portal.js`

- [ ] **Step 1: Create routes/portal.js**

```js
const express = require('express');
const db = require('../db');
const requireClient = require('../middleware/requireClient');
const router = express.Router();

// Client's file list
router.get('/files', requireClient, (req, res) => {
  const files = db.prepare(
    'SELECT id, filename, uploaded_at FROM files WHERE client_id = ? ORDER BY uploaded_at DESC'
  ).all(req.session.clientId);
  res.json(files);
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/portal.js
git commit -m "feat: add portal API route for client file list"
```

---

## Task 8: server.js

**Files:**
- Create: `server.js`

- [ ] **Step 1: Create server.js**

```js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRouter = require('./routes/auth');
const crmRouter = require('./routes/crm');
const portalRouter = require('./routes/portal');
const filesRouter = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'sidecar-dev-secret-change-in-prod';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }, // 8-hour session
}));

// ── NEW ROUTES ────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/crm', crmRouter);
app.use('/api/portal', portalRouter);
app.use('/api/files', filesRouter);

// ── INTERNAL CRM PAGES ───────────────────────────────
const requireAdmin = require('./middleware/requireAdmin');
app.get('/internal/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'internal', 'login.html'));
});
app.get('/internal', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'internal', 'index.html'));
});
app.get('/internal/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'internal', 'index.html'));
});

// ── CLIENT PORTAL PAGES ──────────────────────────────
const requireClient = require('./middleware/requireClient');
app.get('/portal/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal', 'login.html'));
});
app.get('/portal', requireClient, (req, res) => {
  res.sendFile(path.join(__dirname, 'portal', 'index.html'));
});
app.get('/portal/', requireClient, (req, res) => {
  res.sendFile(path.join(__dirname, 'portal', 'index.html'));
});

// ── STATIC SITE (must come AFTER specific routes) ────
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Sidecar Advisory running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Start server and verify**

```bash
cd "/Users/barris/Desktop/AI Business" && node server.js &
sleep 2 && curl -s http://localhost:3000/ | head -5
```

Expected: HTML from index.html. Kill with `kill %1` after.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add Express server with static serving and route mounting"
```

---

## Task 9: Internal CRM login page

**Files:**
- Create: `internal/login.html`

- [ ] **Step 1: Create internal/login.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sidecar Advisory — Internal Login</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Epilogue:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root { --navy:#2C2418; --forest:#2D5A3D; --forest-light:#4A7A5C; --parch:#F5F0E8; --light:#D4C4A8; --tan:#9C8B6E; --ember:#C0392B; --white:#FDFBF7; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { min-height: 100vh; background: var(--navy); display: flex; align-items: center; justify-content: center; font-family: 'Epilogue', sans-serif; }
  .card { background: var(--parch); border-radius: 4px; padding: 48px 56px; width: 380px; text-align: center; }
  .wordmark { font-family: 'Cormorant Garamond', serif; font-size: 28px; color: var(--navy); letter-spacing: .04em; }
  .sub { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--tan); margin: 6px 0 36px; }
  input { width: 100%; padding: 12px 16px; border: 1px solid var(--light); background: var(--white); border-radius: 3px; font-family: 'Epilogue', sans-serif; font-size: 14px; color: var(--navy); margin-bottom: 14px; outline: none; transition: border-color .2s; }
  input:focus { border-color: var(--forest); }
  button { width: 100%; padding: 12px; background: var(--forest); color: var(--white); border: none; border-radius: 3px; font-family: 'Epilogue', sans-serif; font-size: 13px; font-weight: 500; letter-spacing: .06em; cursor: pointer; transition: background .2s; }
  button:hover { background: var(--forest-light); }
  .error { color: var(--ember); font-size: 12px; margin-top: 12px; min-height: 18px; }
</style>
</head>
<body>
<div class="card">
  <div class="wordmark">Sidecar Advisory</div>
  <div class="sub">Internal Dashboard</div>
  <input type="text" id="username" placeholder="Username" autocomplete="username">
  <input type="password" id="password" placeholder="Password" autocomplete="current-password"
    onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Sign In</button>
  <div class="error" id="err"></div>
</div>
<script>
async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const err = document.getElementById('err');
  err.textContent = '';
  try {
    const r = await fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (r.ok) { window.location.href = '/internal'; }
    else { err.textContent = 'Invalid credentials. Try again.'; }
  } catch { err.textContent = 'Connection error.'; }
}
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add internal/login.html
git commit -m "feat: add internal CRM login page"
```

---

## Task 10: Internal CRM dashboard (index.html)

**Files:**
- Replace: `internal/index.html`

This replaces the existing localStorage-based dashboard. The existing file can be reviewed at git history if needed.

- [ ] **Step 1: Replace internal/index.html**

The new file is a large SPA with 5 tabs driven by fetch() calls to /api/crm/*. Full HTML below:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sidecar Advisory — CRM</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Epilogue:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --navy: #2C2418; --forest: #2D5A3D; --forest-light: #4A7A5C;
  --tan: #9C8B6E; --tan-light: #C8B99A; --parch: #F5F0E8;
  --cream: #EDE6DA; --ember: #C0392B; --white: #FDFBF7;
  --mid: #5C4E38; --light: #D4C4A8; --sidebar-w: 220px;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: 'Epilogue', sans-serif; background: var(--white); color: var(--navy); }
/* SIDEBAR */
.sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: var(--sidebar-w); background: var(--navy); display: flex; flex-direction: column; z-index: 100; }
.sidebar-logo { padding: 28px 24px 20px; border-bottom: 1px solid rgba(255,255,255,.08); }
.sidebar-logo .name { font-family: 'Cormorant Garamond', serif; font-size: 20px; color: var(--parch); letter-spacing: .03em; }
.sidebar-logo .label { font-size: 9px; letter-spacing: .18em; text-transform: uppercase; color: var(--tan); margin-top: 2px; }
.nav { flex: 1; padding: 16px 0; }
.nav-item { display: flex; align-items: center; gap: 12px; padding: 11px 24px; font-size: 13px; color: rgba(245,240,232,.55); cursor: pointer; transition: all .15s; border-left: 3px solid transparent; letter-spacing: .02em; }
.nav-item:hover { color: var(--parch); background: rgba(255,255,255,.04); }
.nav-item.active { color: var(--parch); border-left-color: var(--forest-light); background: rgba(61,107,94,.15); }
.nav-item svg { width: 15px; height: 15px; flex-shrink: 0; opacity: .7; }
.nav-item.active svg { opacity: 1; }
.sidebar-footer { padding: 16px 24px; border-top: 1px solid rgba(255,255,255,.08); font-size: 11px; color: rgba(245,240,232,.3); }
.logout-btn { background: none; border: none; color: rgba(245,240,232,.4); font-size: 11px; cursor: pointer; padding: 0; font-family: 'Epilogue'; letter-spacing: .04em; }
.logout-btn:hover { color: var(--ember); }
/* MAIN */
.main { margin-left: var(--sidebar-w); height: 100vh; overflow-y: auto; }
.page { display: none; padding: 40px 48px; max-width: 1100px; }
.page.active { display: block; }
.page-header { margin-bottom: 32px; display: flex; justify-content: space-between; align-items: flex-end; }
.page-title { font-family: 'Cormorant Garamond', serif; font-size: 36px; font-weight: 600; color: var(--navy); }
.page-sub { font-size: 13px; color: var(--tan); margin-top: 4px; }
/* CARDS */
.card { background: var(--white); border: 1px solid var(--light); border-radius: 4px; padding: 28px 32px; margin-bottom: 20px; }
.card-title { font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--forest); margin-bottom: 20px; }
.metric-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
.metric { background: var(--parch); border-radius: 3px; padding: 20px 22px; }
.metric-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--tan); margin-bottom: 6px; }
.metric-value { font-family: 'Cormorant Garamond', serif; font-size: 32px; font-weight: 600; color: var(--navy); }
.metric-value.amber { color: var(--ember); }
/* TABLES */
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--tan); font-weight: 500; padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--light); }
.data-table td { padding: 12px 14px; border-bottom: 1px solid var(--cream); vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--parch); cursor: pointer; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 2px; font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.badge-Lead { background: #E8F0FF; color: #2952A3; }
.badge-Session { background: #FFF3E0; color: #B45309; }
.badge-Proposal { background: #EDE6DA; color: #5C4E38; }
.badge-Active { background: #E1F5EE; color: #0F6E56; }
.badge-Dormant { background: #F0F0F0; color: #666; }
/* FORMS */
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.form-group { margin-bottom: 16px; }
.form-label { font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--mid); margin-bottom: 6px; display: block; }
input[type=text], input[type=date], input[type=password], select, textarea {
  width: 100%; padding: 10px 13px; border: 1px solid var(--light); background: var(--parch); border-radius: 3px;
  font-family: 'Epilogue', sans-serif; font-size: 13px; color: var(--navy); outline: none; transition: border-color .2s;
}
input:focus, select:focus, textarea:focus { border-color: var(--forest); background: var(--white); }
textarea { resize: vertical; min-height: 80px; }
.btn { padding: 9px 20px; border-radius: 3px; font-family: 'Epilogue', sans-serif; font-size: 12px; font-weight: 500; letter-spacing: .06em; cursor: pointer; transition: all .2s; border: none; }
.btn-primary { background: var(--forest); color: var(--white); }
.btn-primary:hover { background: var(--forest-light); }
.btn-secondary { background: var(--parch); color: var(--navy); border: 1px solid var(--light); }
.btn-secondary:hover { background: var(--cream); }
.btn-danger { background: transparent; color: var(--ember); border: 1px solid var(--ember); font-size: 11px; padding: 5px 11px; }
.btn-danger:hover { background: var(--ember); color: var(--white); }
.btn-sm { padding: 5px 12px; font-size: 11px; }
/* MODAL */
.overlay { position: fixed; inset: 0; background: rgba(44,36,24,.5); z-index: 500; display: none; align-items: center; justify-content: center; overflow-y: auto; padding: 20px; }
.overlay.open { display: flex; }
.modal { background: var(--white); border-radius: 4px; padding: 36px 40px; width: 640px; max-width: 100%; position: relative; }
.modal-title { font-family: 'Cormorant Garamond', serif; font-size: 26px; font-weight: 600; margin-bottom: 24px; }
.modal-close { position: absolute; top: 16px; right: 20px; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--tan); }
.divider { border: none; border-top: 1px solid var(--light); margin: 20px 0; }
/* ACTIVITY TIMELINE */
.activity-item { padding: 12px 0; border-bottom: 1px solid var(--cream); font-size: 13px; }
.activity-item:last-child { border-bottom: none; }
.activity-meta { font-size: 11px; color: var(--tan); margin-top: 3px; }
.activity-type-badge { display: inline-block; padding: 2px 8px; border-radius: 2px; font-size: 10px; font-weight: 600; background: var(--cream); color: var(--mid); margin-right: 6px; text-transform: uppercase; letter-spacing: .05em; }
/* PANEL */
.slide-panel { position: fixed; top: 0; right: -700px; width: 660px; height: 100vh; background: var(--white); box-shadow: -4px 0 24px rgba(0,0,0,.12); transition: right .25s ease; z-index: 200; overflow-y: auto; padding: 36px 40px; }
.slide-panel.open { right: 0; }
.panel-close { float: right; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--tan); }
/* FILTERS */
.filter-bar { padding: 14px 20px; border-bottom: 1px solid var(--light); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.filter-bar input, .filter-bar select { width: auto; min-width: 160px; }
/* GMAIL NOTE */
.gmail-note { font-size: 11px; color: var(--tan); padding: 8px 12px; background: var(--parch); border-radius: 3px; border-left: 3px solid var(--light); margin-top: 8px; }
/* PIPELINE FUNNEL */
.funnel { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 20px; }
.funnel-col { background: var(--parch); border-radius: 3px; padding: 14px 16px; text-align: center; }
.funnel-label { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--tan); margin-bottom: 4px; }
.funnel-count { font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 600; color: var(--navy); }
/* OVERDUE */
.overdue-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--cream); font-size: 13px; }
.overdue-item:last-child { border-bottom: none; }
.overdue-date { font-size: 11px; color: var(--ember); font-weight: 600; }
@media (max-width: 900px) { .metric-row, .funnel, .form-row, .form-row-3 { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-logo">
    <div class="name">Sidecar Advisory</div>
    <div class="label">Internal CRM</div>
  </div>
  <nav class="nav">
    <div class="nav-item active" data-page="dashboard" onclick="nav(this,'dashboard')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      Dashboard
    </div>
    <div class="nav-item" data-page="contacts" onclick="nav(this,'contacts')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Contacts
    </div>
    <div class="nav-item" data-page="outreach" onclick="nav(this,'outreach')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      Outreach
    </div>
    <div class="nav-item" data-page="followups" onclick="nav(this,'followups')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Follow-ups
    </div>
    <div class="nav-item" data-page="portal-mgr" onclick="nav(this,'portal-mgr')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      Client Portal
    </div>
  </nav>
  <div class="sidebar-footer">
    <button class="logout-btn" onclick="logout()">Sign out</button>
  </div>
</div>

<div class="main">

  <!-- DASHBOARD -->
  <div class="page active" id="page-dashboard">
    <div class="page-header"><div><div class="page-title" id="dash-greeting">Good morning.</div><div class="page-sub" id="dash-date"></div></div></div>
    <div class="metric-row">
      <div class="metric"><div class="metric-label">Total Contacts</div><div class="metric-value" id="m-total">—</div></div>
      <div class="metric"><div class="metric-label">Active Clients</div><div class="metric-value" id="m-active">—</div></div>
      <div class="metric"><div class="metric-label">Sessions Booked</div><div class="metric-value" id="m-booked">—</div></div>
      <div class="metric"><div class="metric-label">Follow-ups Due</div><div class="metric-value amber" id="m-followups">—</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <div class="card">
        <div class="card-title">Pipeline</div>
        <div class="funnel" id="dash-funnel"></div>
      </div>
      <div class="card">
        <div class="card-title">Overdue Follow-ups</div>
        <div id="dash-overdue"></div>
      </div>
    </div>
  </div>

  <!-- CONTACTS -->
  <div class="page" id="page-contacts">
    <div class="page-header">
      <div><div class="page-title">Contacts</div><div class="page-sub">All leads and clients</div></div>
      <button class="btn btn-primary" onclick="openContactModal()">+ Add Contact</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="filter-bar">
        <input type="text" id="contact-q" placeholder="Search name or firm…" oninput="loadContacts()" style="max-width:260px;">
        <select id="contact-industry" onchange="loadContacts()" style="width:160px;">
          <option value="">All Industries</option>
          <option value="insurance">Insurance</option>
          <option value="law">Law</option>
          <option value="cpa">CPA</option>
          <option value="realestate">Real Estate</option>
          <option value="other">Other</option>
        </select>
        <select id="contact-stage" onchange="loadContacts()" style="width:180px;">
          <option value="">All Stages</option>
          <option>Lead</option>
          <option>Session Booked</option>
          <option>Proposal Sent</option>
          <option>Active Client</option>
          <option>Dormant</option>
        </select>
      </div>
      <table class="data-table">
        <thead><tr><th>Name / Firm</th><th>Industry</th><th>Stage</th><th>Last Activity</th><th>Follow-up</th><th></th></tr></thead>
        <tbody id="contacts-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- OUTREACH -->
  <div class="page" id="page-outreach">
    <div class="page-header"><div><div class="page-title">Outreach Tracker</div><div class="page-sub">Which batch, what happened</div></div></div>
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Firm</th><th>Source / Batch</th><th>Date Added</th><th>Reply Status</th></tr></thead>
        <tbody id="outreach-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- FOLLOW-UPS -->
  <div class="page" id="page-followups">
    <div class="page-header"><div><div class="page-title">Follow-up Queue</div><div class="page-sub">Sorted soonest first — amber = overdue</div></div></div>
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Firm</th><th>Stage</th><th>Follow-up Date</th><th></th></tr></thead>
        <tbody id="followups-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- PORTAL MANAGER -->
  <div class="page" id="page-portal-mgr">
    <div class="page-header">
      <div><div class="page-title">Client Portal Manager</div><div class="page-sub">Portal accounts and file sharing</div></div>
      <button class="btn btn-primary" onclick="openPortalClientModal()">+ New Portal Client</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="data-table">
        <thead><tr><th>Display Name</th><th>Username</th><th>Linked Contact</th><th>Files</th><th></th></tr></thead>
        <tbody id="portal-clients-tbody"></tbody>
      </table>
    </div>
  </div>

</div>

<!-- CONTACT DETAIL PANEL -->
<div class="slide-panel" id="contact-panel">
  <button class="panel-close" onclick="closePanel()">×</button>
  <div id="panel-content"></div>
</div>
<div id="panel-overlay" onclick="closePanel()" style="display:none;position:fixed;inset:0;z-index:199;background:rgba(0,0,0,.2);"></div>

<!-- CONTACT MODAL -->
<div class="overlay" id="contact-modal">
  <div class="modal">
    <button class="modal-close" onclick="closeModal('contact-modal')">×</button>
    <div class="modal-title" id="contact-modal-title">Add Contact</div>
    <input type="hidden" id="cm-id">
    <div class="form-row">
      <div class="form-group"><label class="form-label">Name *</label><input type="text" id="cm-name"></div>
      <div class="form-group"><label class="form-label">Firm</label><input type="text" id="cm-firm"></div>
      <div class="form-group">
        <label class="form-label">Industry</label>
        <select id="cm-industry">
          <option value="">—</option>
          <option value="insurance">Insurance</option>
          <option value="law">Law</option>
          <option value="cpa">CPA</option>
          <option value="realestate">Real Estate</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Pipeline Stage</label>
        <select id="cm-stage">
          <option>Lead</option>
          <option>Session Booked</option>
          <option>Proposal Sent</option>
          <option>Active Client</option>
          <option>Dormant</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Email</label><input type="text" id="cm-email"></div>
      <div class="form-group"><label class="form-label">Phone</label><input type="text" id="cm-phone"></div>
      <div class="form-group"><label class="form-label">Source</label><input type="text" id="cm-source" placeholder="e.g. LinkedIn Batch April 2026"></div>
      <div class="form-group"><label class="form-label">Follow-up Date</label><input type="date" id="cm-followup"></div>
    </div>
    <div class="form-group"><label class="form-label">Notes</label><textarea id="cm-notes"></textarea></div>
    <hr class="divider">
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal('contact-modal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveContact()">Save</button>
    </div>
  </div>
</div>

<!-- ACTIVITY MODAL -->
<div class="overlay" id="activity-modal">
  <div class="modal">
    <button class="modal-close" onclick="closeModal('activity-modal')">×</button>
    <div class="modal-title">Log Activity</div>
    <input type="hidden" id="am-contact-id">
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Type</label>
        <select id="am-type">
          <option value="email_sent">Email Sent</option>
          <option value="email_received">Email Received</option>
          <option value="call">Call</option>
          <option value="clarity_session">Clarity Session</option>
          <option value="proposal">Proposal</option>
          <option value="note">Note</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Date</label><input type="date" id="am-date"></div>
    </div>
    <div class="form-group"><label class="form-label">Subject *</label><input type="text" id="am-subject"></div>
    <div class="form-group"><label class="form-label">Body / Notes</label><textarea id="am-body" style="min-height:120px;"></textarea></div>
    <div class="gmail-note">Automatic Gmail sync coming soon — log emails manually for now.</div>
    <hr class="divider">
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal('activity-modal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveActivity()">Log Activity</button>
    </div>
  </div>
</div>

<!-- PORTAL CLIENT MODAL -->
<div class="overlay" id="portal-client-modal">
  <div class="modal">
    <button class="modal-close" onclick="closeModal('portal-client-modal')">×</button>
    <div class="modal-title">New Portal Client</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Display Name *</label><input type="text" id="pcm-name"></div>
      <div class="form-group"><label class="form-label">Username *</label><input type="text" id="pcm-username"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Password *</label><input type="password" id="pcm-password"></div>
      <div class="form-group"><label class="form-label">Link to Contact (optional)</label><select id="pcm-contact"><option value="">— none —</option></select></div>
    </div>
    <hr class="divider">
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal('portal-client-modal')">Cancel</button>
      <button class="btn btn-primary" onclick="savePortalClient()">Create</button>
    </div>
  </div>
</div>

<!-- RESET PASSWORD MODAL -->
<div class="overlay" id="reset-pw-modal">
  <div class="modal" style="width:400px;">
    <button class="modal-close" onclick="closeModal('reset-pw-modal')">×</button>
    <div class="modal-title">Reset Password</div>
    <input type="hidden" id="rp-client-id">
    <div class="form-group"><label class="form-label">New Password *</label><input type="password" id="rp-password"></div>
    <hr class="divider">
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal('reset-pw-modal')">Cancel</button>
      <button class="btn btn-primary" onclick="doResetPassword()">Reset</button>
    </div>
  </div>
</div>

<!-- FOLLOW-UP MODAL -->
<div class="overlay" id="followup-modal">
  <div class="modal" style="width:400px;">
    <button class="modal-close" onclick="closeModal('followup-modal')">×</button>
    <div class="modal-title">Set Follow-up Date</div>
    <input type="hidden" id="fu-contact-id">
    <div class="form-group"><label class="form-label">Date</label><input type="date" id="fu-date"></div>
    <hr class="divider">
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal('followup-modal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveFollowup()">Set</button>
    </div>
  </div>
</div>

<script>
// ── UTILS ─────────────────────────────────────────────
const api = (url, opts={}) => fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => {
  if (r.status === 401) { window.location.href = '/internal/login'; throw new Error('Unauthorized'); }
  return r.json();
});
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
const put  = (url, body) => api(url, { method: 'PUT',  body: JSON.stringify(body) });
const del  = (url)       => api(url, { method: 'DELETE' });

const fmtDate = iso => iso ? new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const industryLabel = { insurance:'Insurance', law:'Law', cpa:'CPA', realestate:'Real Estate', other:'Other' };
const stageKey = s => s.replace(/\s+/g,'').replace('Booked','Session').replace('Sent','Proposal');
const stageBadge = s => {
  const m = { Lead:'Lead', 'Session Booked':'Session', 'Proposal Sent':'Proposal', 'Active Client':'Active', Dormant:'Dormant' };
  return `<span class="badge badge-${m[s]||'Lead'}">${s}</span>`;
};

// ── NAVIGATION ────────────────────────────────────────
function nav(el, page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('page-' + page).classList.add('active');
  if (page === 'dashboard') loadDashboard();
  if (page === 'contacts') loadContacts();
  if (page === 'outreach') loadOutreach();
  if (page === 'followups') loadFollowups();
  if (page === 'portal-mgr') loadPortalClients();
}

async function logout() {
  await post('/api/auth/admin/logout', {});
  window.location.href = '/internal/login';
}

// ── DASHBOARD ─────────────────────────────────────────
async function loadDashboard() {
  const data = await api('/api/crm/stats');
  document.getElementById('m-total').textContent = data.total;
  document.getElementById('m-active').textContent = data.active;
  document.getElementById('m-booked').textContent = data.booked;
  document.getElementById('m-followups').textContent = data.followups;
  const funnel = document.getElementById('dash-funnel');
  const stages = ['Lead','Session Booked','Proposal Sent','Active Client','Dormant'];
  funnel.innerHTML = stages.map(s => {
    const found = data.pipeline.find(p => p.pipeline_stage === s);
    return `<div class="funnel-col"><div class="funnel-label">${s}</div><div class="funnel-count">${found ? found.count : 0}</div></div>`;
  }).join('');
  const overdue = document.getElementById('dash-overdue');
  if (!data.overdue.length) {
    overdue.innerHTML = '<div style="color:var(--tan);font-size:13px;">No overdue follow-ups.</div>';
  } else {
    overdue.innerHTML = data.overdue.map(c =>
      `<div class="overdue-item"><div><div style="font-weight:500;">${c.name}</div><div style="font-size:11px;color:var(--tan);">${c.firm||''}</div></div><div class="overdue-date">${fmtDate(c.follow_up_date)}</div></div>`
    ).join('');
  }
}

// ── CONTACTS ──────────────────────────────────────────
async function loadContacts() {
  const q = document.getElementById('contact-q').value;
  const industry = document.getElementById('contact-industry').value;
  const stage = document.getElementById('contact-stage').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (industry) params.set('industry', industry);
  if (stage) params.set('stage', stage);
  const data = await api('/api/crm/contacts?' + params);
  const tbody = document.getElementById('contacts-tbody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--tan);padding:32px;">No contacts yet.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(c => `
    <tr onclick="openPanel('${c.id}')">
      <td><div style="font-weight:500;">${c.name}</div><div style="font-size:11px;color:var(--tan);">${c.firm||''}</div></td>
      <td style="font-size:12px;color:var(--mid);">${industryLabel[c.industry]||'—'}</td>
      <td>${stageBadge(c.pipeline_stage)}</td>
      <td style="font-size:12px;color:var(--tan);">${c.last_activity ? fmtDate(c.last_activity) : '—'}</td>
      <td style="font-size:12px;${c.follow_up_date && c.follow_up_date <= new Date().toISOString().split('T')[0] ? 'color:var(--ember);font-weight:600;' : 'color:var(--tan);'}">${c.follow_up_date ? fmtDate(c.follow_up_date) : '—'}</td>
      <td onclick="event.stopPropagation()">
        <button class="btn btn-secondary btn-sm" onclick="openContactModal('${c.id}')">Edit</button>
      </td>
    </tr>`).join('');
}

// ── CONTACT PANEL ─────────────────────────────────────
async function openPanel(id) {
  const data = await api('/api/crm/contacts/' + id);
  const panel = document.getElementById('contact-panel');
  const today = new Date().toISOString().split('T')[0];
  const typeLabels = { email_sent:'Email Sent', email_received:'Email Received', call:'Call', clarity_session:'Clarity Session', proposal:'Proposal', note:'Note' };
  document.getElementById('panel-content').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;margin-right:32px;">
      <div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:600;">${data.name}</div>
        <div style="font-size:13px;color:var(--tan);margin-top:4px;">${data.firm||''} ${data.industry ? '· '+industryLabel[data.industry] : ''}</div>
      </div>
      ${stageBadge(data.pipeline_stage)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;font-size:13px;">
      <div><span style="color:var(--tan);">Email: </span>${data.email||'—'}</div>
      <div><span style="color:var(--tan);">Phone: </span>${data.phone||'—'}</div>
      <div><span style="color:var(--tan);">Source: </span>${data.source||'—'}</div>
      <div><span style="color:var(--tan);">Follow-up: </span><span style="${data.follow_up_date && data.follow_up_date <= today ? 'color:var(--ember);font-weight:600;' : ''}">${data.follow_up_date ? fmtDate(data.follow_up_date) : '—'}</span></div>
    </div>
    ${data.notes ? `<div style="font-size:13px;color:var(--mid);margin-bottom:20px;padding:12px;background:var(--parch);border-radius:3px;">${data.notes}</div>` : ''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:28px;">
      <button class="btn btn-primary btn-sm" onclick="openActivityModal('${data.id}')">+ Log Activity</button>
      <button class="btn btn-secondary btn-sm" onclick="openFollowupModal('${data.id}','${data.follow_up_date||''}')">Set Follow-up</button>
      ${data.follow_up_date ? `<button class="btn btn-secondary btn-sm" onclick="clearFollowup('${data.id}')">Clear Follow-up</button>` : ''}
      <button class="btn btn-secondary btn-sm" onclick="openContactModal('${data.id}');closePanel()">Edit Contact</button>
    </div>
    <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--forest);margin-bottom:12px;">Activity Timeline</div>
    <div id="panel-activities">
      ${!data.activities.length ? '<div style="color:var(--tan);font-size:13px;">No activities logged yet.</div>' :
        data.activities.map(a => `
          <div class="activity-item">
            <span class="activity-type-badge">${typeLabels[a.type]||a.type}</span>
            <strong>${a.subject}</strong>
            ${a.body ? `<div style="margin-top:6px;font-size:12px;color:var(--mid);">${a.body}</div>` : ''}
            <div class="activity-meta">${fmtDate(a.logged_at)}</div>
          </div>`).join('')}
    </div>
    ${data.files.length ? `
      <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--forest);margin:24px 0 12px;">Portal Files</div>
      ${data.files.map(f => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--cream);font-size:13px;"><span>${f.filename}</span><span style="font-size:11px;color:var(--tan);">${fmtDate(f.uploaded_at)}</span></div>`).join('')}
    ` : ''}
  `;
  panel.classList.add('open');
  document.getElementById('panel-overlay').style.display = 'block';
}

function closePanel() {
  document.getElementById('contact-panel').classList.remove('open');
  document.getElementById('panel-overlay').style.display = 'none';
}

// ── CONTACT MODAL ─────────────────────────────────────
async function openContactModal(id = null) {
  document.getElementById('cm-id').value = id || '';
  document.getElementById('contact-modal-title').textContent = id ? 'Edit Contact' : 'Add Contact';
  if (id) {
    const data = await api('/api/crm/contacts/' + id);
    document.getElementById('cm-name').value = data.name || '';
    document.getElementById('cm-firm').value = data.firm || '';
    document.getElementById('cm-industry').value = data.industry || '';
    document.getElementById('cm-stage').value = data.pipeline_stage || 'Lead';
    document.getElementById('cm-email').value = data.email || '';
    document.getElementById('cm-phone').value = data.phone || '';
    document.getElementById('cm-source').value = data.source || '';
    document.getElementById('cm-followup').value = data.follow_up_date || '';
    document.getElementById('cm-notes').value = data.notes || '';
  } else {
    ['cm-name','cm-firm','cm-email','cm-phone','cm-source','cm-notes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cm-industry').value = '';
    document.getElementById('cm-stage').value = 'Lead';
    document.getElementById('cm-followup').value = '';
  }
  document.getElementById('contact-modal').classList.add('open');
}

async function saveContact() {
  const id = document.getElementById('cm-id').value;
  const body = {
    name: document.getElementById('cm-name').value.trim(),
    firm: document.getElementById('cm-firm').value.trim(),
    industry: document.getElementById('cm-industry').value,
    pipeline_stage: document.getElementById('cm-stage').value,
    email: document.getElementById('cm-email').value.trim(),
    phone: document.getElementById('cm-phone').value.trim(),
    source: document.getElementById('cm-source').value.trim(),
    follow_up_date: document.getElementById('cm-followup').value || null,
    notes: document.getElementById('cm-notes').value.trim(),
  };
  if (!body.name) return alert('Name is required.');
  if (id) { await put('/api/crm/contacts/' + id, body); }
  else { await post('/api/crm/contacts', body); }
  closeModal('contact-modal');
  loadContacts();
  loadDashboard();
}

// ── ACTIVITY MODAL ────────────────────────────────────
function openActivityModal(contactId) {
  document.getElementById('am-contact-id').value = contactId;
  document.getElementById('am-type').value = 'email_sent';
  document.getElementById('am-subject').value = '';
  document.getElementById('am-body').value = '';
  document.getElementById('am-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('activity-modal').classList.add('open');
}

async function saveActivity() {
  const contactId = document.getElementById('am-contact-id').value;
  const type = document.getElementById('am-type').value;
  const subject = document.getElementById('am-subject').value.trim();
  const body = document.getElementById('am-body').value.trim();
  const date = document.getElementById('am-date').value;
  if (!subject) return alert('Subject is required.');
  await post(`/api/crm/contacts/${contactId}/activities`, { type, subject, body, logged_at: date ? date + 'T12:00:00' : undefined });
  closeModal('activity-modal');
  openPanel(contactId);
}

// ── FOLLOW-UP MODAL ───────────────────────────────────
function openFollowupModal(contactId, existing) {
  document.getElementById('fu-contact-id').value = contactId;
  document.getElementById('fu-date').value = existing || new Date().toISOString().split('T')[0];
  document.getElementById('followup-modal').classList.add('open');
}

async function saveFollowup() {
  const contactId = document.getElementById('fu-contact-id').value;
  const date = document.getElementById('fu-date').value;
  await post(`/api/crm/contacts/${contactId}/followup`, { follow_up_date: date });
  closeModal('followup-modal');
  closePanel();
  loadFollowups();
  loadDashboard();
}

async function clearFollowup(contactId) {
  await post(`/api/crm/contacts/${contactId}/followup`, { follow_up_date: null });
  closePanel();
  loadFollowups();
  loadDashboard();
}

// ── OUTREACH ──────────────────────────────────────────
async function loadOutreach() {
  const data = await api('/api/crm/outreach');
  const tbody = document.getElementById('outreach-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--tan);padding:32px;">No outreach contacts yet. Add a contact with a source batch name.</td></tr>'; return; }
  const statuses = ['None','Replied','Booked','Not Interested'];
  tbody.innerHTML = data.map(c => `
    <tr>
      <td style="font-weight:500;cursor:pointer;" onclick="openPanel('${c.id}')">${c.name}</td>
      <td style="font-size:12px;color:var(--mid);">${c.firm||'—'}</td>
      <td style="font-size:12px;">${c.source||'—'}</td>
      <td style="font-size:12px;color:var(--tan);">${fmtDate(c.created_at)}</td>
      <td>
        <select style="width:160px;font-size:12px;padding:5px 8px;" onchange="setReplyStatus('${c.id}',this.value)">
          ${statuses.map(s => `<option value="${s}" ${c.reply_status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('');
}

async function setReplyStatus(id, status) {
  await post(`/api/crm/contacts/${id}/reply-status`, { reply_status: status });
}

// ── FOLLOW-UPS PAGE ───────────────────────────────────
async function loadFollowups() {
  const data = await api('/api/crm/followups');
  const tbody = document.getElementById('followups-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--tan);padding:32px;">No follow-ups scheduled.</td></tr>'; return; }
  tbody.innerHTML = data.map(c => `
    <tr style="${c.overdue ? 'background:rgba(192,57,43,.04);' : ''}">
      <td style="font-weight:500;cursor:pointer;" onclick="openPanel('${c.id}')">${c.name}</td>
      <td style="font-size:12px;color:var(--mid);">${c.firm||'—'}</td>
      <td>${stageBadge(c.pipeline_stage)}</td>
      <td style="font-size:12px;${c.overdue ? 'color:var(--ember);font-weight:600;' : 'color:var(--tan);'}">${fmtDate(c.follow_up_date)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" style="margin-right:6px;" onclick="openFollowupModal('${c.id}','${c.follow_up_date||''}')">Change</button>
        <button class="btn btn-danger" onclick="clearFollowup('${c.id}');loadFollowups()">Done ✓</button>
      </td>
    </tr>`).join('');
}

// ── PORTAL CLIENTS ────────────────────────────────────
async function loadPortalClients() {
  const data = await api('/api/crm/portal-clients');
  const tbody = document.getElementById('portal-clients-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--tan);padding:32px;">No portal clients yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(c => `
    <tr>
      <td style="font-weight:500;">${c.display_name}</td>
      <td style="font-size:12px;color:var(--mid);">${c.username}</td>
      <td style="font-size:12px;color:var(--tan);">${c.contact_name||'—'}</td>
      <td style="font-size:12px;">${c.file_count} file${c.file_count!==1?'s':''}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-secondary btn-sm" style="margin-right:6px;" onclick="openUploadModal('${c.id}')">Upload File</button>
        <button class="btn btn-secondary btn-sm" style="margin-right:6px;" onclick="openResetPwModal('${c.id}')">Reset PW</button>
        <button class="btn btn-danger" onclick="deletePortalClient('${c.id}')">×</button>
      </td>
    </tr>
    ${c.file_count > 0 ? '<tr id="files-row-' + c.id + '" style="display:none;"><td colspan="5" style="padding:0 14px 14px;"></td></tr>' : ''}`
  ).join('');
}

async function openPortalClientModal() {
  const contacts = await api('/api/crm/contacts');
  const sel = document.getElementById('pcm-contact');
  sel.innerHTML = '<option value="">— none —</option>' + contacts.map(c => `<option value="${c.id}">${c.name}${c.firm ? ' · '+c.firm : ''}</option>`).join('');
  ['pcm-name','pcm-username','pcm-password'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('portal-client-modal').classList.add('open');
}

async function savePortalClient() {
  const body = {
    display_name: document.getElementById('pcm-name').value.trim(),
    username: document.getElementById('pcm-username').value.trim(),
    password: document.getElementById('pcm-password').value,
    contact_id: document.getElementById('pcm-contact').value || null,
  };
  if (!body.display_name || !body.username || !body.password) return alert('All fields required.');
  const r = await post('/api/crm/portal-clients', body);
  if (r.error) return alert(r.error);
  closeModal('portal-client-modal');
  loadPortalClients();
}

function openResetPwModal(clientId) {
  document.getElementById('rp-client-id').value = clientId;
  document.getElementById('rp-password').value = '';
  document.getElementById('reset-pw-modal').classList.add('open');
}

async function doResetPassword() {
  const clientId = document.getElementById('rp-client-id').value;
  const password = document.getElementById('rp-password').value;
  if (!password) return alert('Enter a new password.');
  await post(`/api/crm/portal-clients/${clientId}/reset-password`, { password });
  closeModal('reset-pw-modal');
  alert('Password reset.');
}

async function deletePortalClient(id) {
  if (!confirm('Delete this portal client and all their files?')) return;
  await del('/api/crm/portal-clients/' + id);
  loadPortalClients();
}

// File upload for portal client
let _uploadClientId = null;
function openUploadModal(clientId) {
  _uploadClientId = clientId;
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const r = await fetch(`/api/files/upload/${clientId}`, { method: 'POST', body: form });
    if (r.ok) { alert('File uploaded.'); loadPortalClients(); }
    else { const j = await r.json(); alert(j.error || 'Upload failed.'); }
  };
  input.click();
}

// ── MODALS ────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// ── INIT ──────────────────────────────────────────────
const now = new Date();
const hour = now.getHours();
const greeting = hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : 'Good evening.';
document.getElementById('dash-greeting').textContent = greeting;
document.getElementById('dash-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
loadDashboard();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify /internal redirects to /internal/login when not logged in**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:3000/internal
```

Expected: `302 http://localhost:3000/internal/login`

- [ ] **Step 3: Commit**

```bash
git add internal/index.html internal/login.html
git commit -m "feat: replace internal dashboard with backend-powered CRM SPA"
```

---

## Task 11: Client portal pages

**Files:**
- Create: `portal/login.html`
- Create: `portal/index.html`

- [ ] **Step 1: Create portal/login.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sidecar Advisory — Client Portal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Epilogue:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root { --forest:#2D5A3D; --forest-light:#4A7A5C; --parch:#F5F0E8; --navy:#2C2418; --light:#D4C4A8; --tan:#9C8B6E; --ember:#C0392B; --white:#FDFBF7; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { min-height: 100vh; background: var(--parch); display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: 'Epilogue', sans-serif; }
  .logo-mark { font-family: 'Cormorant Garamond', serif; font-size: 22px; letter-spacing: .08em; color: var(--navy); margin-bottom: 48px; text-align: center; }
  .logo-mark span { font-size: 10px; display: block; letter-spacing: .2em; text-transform: uppercase; color: var(--tan); margin-top: 4px; }
  .card { background: var(--white); border: 1px solid var(--light); border-radius: 4px; padding: 48px 52px; width: 400px; }
  h1 { font-family: 'Cormorant Garamond', serif; font-size: 26px; font-weight: 600; color: var(--navy); margin-bottom: 6px; }
  .sub { font-size: 13px; color: var(--tan); margin-bottom: 32px; }
  label { font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--navy); display: block; margin-bottom: 6px; }
  input { width: 100%; padding: 11px 14px; border: 1px solid var(--light); background: var(--parch); border-radius: 3px; font-family: 'Epilogue', sans-serif; font-size: 14px; color: var(--navy); outline: none; margin-bottom: 20px; transition: border-color .2s; }
  input:focus { border-color: var(--forest); background: var(--white); }
  button { width: 100%; padding: 13px; background: var(--forest); color: var(--white); border: none; border-radius: 3px; font-family: 'Epilogue', sans-serif; font-size: 13px; font-weight: 500; letter-spacing: .06em; cursor: pointer; transition: background .2s; }
  button:hover { background: var(--forest-light); }
  .error { color: var(--ember); font-size: 12px; margin-top: 12px; min-height: 18px; }
  .footer-note { font-size: 11px; color: var(--tan); text-align: center; margin-top: 24px; }
</style>
</head>
<body>
<div class="logo-mark">Sidecar Advisory<span>Client Portal</span></div>
<div class="card">
  <h1>Sign in</h1>
  <p class="sub">Access your shared documents and deliverables.</p>
  <label for="username">Username</label>
  <input type="text" id="username" autocomplete="username">
  <label for="password">Password</label>
  <input type="password" id="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Sign In</button>
  <div class="error" id="err"></div>
</div>
<p class="footer-note">Forgot your password? Contact Neil at hello@sidecaradvisory.com</p>
<script>
async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const err = document.getElementById('err');
  err.textContent = '';
  try {
    const r = await fetch('/api/auth/client/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (r.ok) { window.location.href = '/portal'; }
    else { err.textContent = 'Incorrect username or password.'; }
  } catch { err.textContent = 'Connection error.'; }
}
</script>
</body>
</html>
```

- [ ] **Step 2: Create portal/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sidecar Advisory — Your Documents</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Epilogue:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --forest:#2D5A3D; --forest-light:#4A7A5C; --parch:#F5F0E8; --navy:#2C2418; --light:#D4C4A8; --tan:#9C8B6E; --white:#FDFBF7; --cream:#EDE6DA; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { min-height: 100vh; background: var(--parch); font-family: 'Epilogue', sans-serif; color: var(--navy); }
  header { background: var(--white); border-bottom: 1px solid var(--light); padding: 0 48px; display: flex; align-items: center; justify-content: space-between; height: 64px; }
  .logo { font-family: 'Cormorant Garamond', serif; font-size: 20px; letter-spacing: .04em; color: var(--navy); }
  .header-right { display: flex; align-items: center; gap: 20px; font-size: 13px; }
  .client-name { color: var(--tan); }
  .logout-link { color: var(--forest); text-decoration: none; cursor: pointer; }
  .logout-link:hover { text-decoration: underline; }
  main { max-width: 760px; margin: 60px auto; padding: 0 24px; }
  h1 { font-family: 'Cormorant Garamond', serif; font-size: 38px; font-weight: 600; margin-bottom: 8px; }
  .sub { font-size: 14px; color: var(--tan); margin-bottom: 40px; }
  .file-list { background: var(--white); border: 1px solid var(--light); border-radius: 4px; overflow: hidden; }
  .file-row { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; border-bottom: 1px solid var(--cream); }
  .file-row:last-child { border-bottom: none; }
  .file-name { font-weight: 500; font-size: 14px; }
  .file-date { font-size: 12px; color: var(--tan); margin-top: 3px; }
  .download-btn { padding: 8px 18px; background: var(--forest); color: var(--white); border: none; border-radius: 3px; font-family: 'Epilogue', sans-serif; font-size: 12px; font-weight: 500; letter-spacing: .06em; cursor: pointer; text-decoration: none; }
  .download-btn:hover { background: var(--forest-light); }
  .empty { text-align: center; padding: 64px 24px; background: var(--white); border: 1px solid var(--light); border-radius: 4px; }
  .empty p { font-size: 14px; color: var(--tan); line-height: 1.7; max-width: 360px; margin: 0 auto; }
</style>
</head>
<body>
<header>
  <div class="logo">Sidecar Advisory</div>
  <div class="header-right">
    <span class="client-name" id="client-name"></span>
    <a class="logout-link" onclick="logout()">Sign out</a>
  </div>
</header>
<main>
  <h1>Your Documents</h1>
  <p class="sub">Files shared by Neil as the engagement progresses.</p>
  <div id="file-container"></div>
</main>
<script>
async function init() {
  const me = await fetch('/api/auth/client/me').then(r => r.json());
  if (me.error) { window.location.href = '/portal/login'; return; }
  document.getElementById('client-name').textContent = me.displayName;
  const files = await fetch('/api/portal/files').then(r => r.json());
  const container = document.getElementById('file-container');
  if (!files.length) {
    container.innerHTML = `<div class="empty"><p>No files have been shared yet. Neil will drop files here as the engagement progresses.</p></div>`;
    return;
  }
  container.innerHTML = `<div class="file-list">${files.map(f => `
    <div class="file-row">
      <div>
        <div class="file-name">${f.filename}</div>
        <div class="file-date">${new Date(f.uploaded_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
      </div>
      <a class="download-btn" href="/api/files/download/${f.id}">Download</a>
    </div>`).join('')}</div>`;
}

async function logout() {
  await fetch('/api/auth/client/logout', { method: 'POST' });
  window.location.href = '/portal/login';
}

init();
</script>
</body>
</html>
```

- [ ] **Step 3: Create the portal directory and verify paths**

```bash
mkdir -p "/Users/barris/Desktop/AI Business/portal"
```

- [ ] **Step 4: Commit**

```bash
git add portal/
git commit -m "feat: add client portal login and document pages"
```

---

## Task 12: Update site-content.js

**Files:**
- Modify: `content/site-content.js`

Only two changes needed — the imageAlt text and removing the chips array from the about section. The rest of the about section is already correct.

- [ ] **Step 1: Change imageAlt in site-content.js**

Find:
```js
imageAlt: "Neil Barris with his family in Metro Detroit",
```
Replace with:
```js
imageAlt: "Neil Barris, founder of Sidecar Advisory, with his family",
```

- [ ] **Step 2: Remove chips array from about section**

Find:
```js
chips: [],
imageUrl: "/assets/neil-family.jpg",
```
Replace with:
```js
imageUrl: "/assets/neil-family.jpg",
```

- [ ] **Step 3: Commit**

```bash
git add content/site-content.js
git commit -m "fix: update about imageAlt and remove chips array"
```

---

## Task 13: README and .gitignore

**Files:**
- Replace: `README.md`
- Modify/Create: `.gitignore`

- [ ] **Step 1: Add .gitignore entries for sidecar.db and uploads/**

Check if `.gitignore` exists and add:
```
sidecar.db
uploads/*
!uploads/.gitkeep
.env
node_modules/
```

- [ ] **Step 2: Update README.md with local dev instructions**

Content should document: npm install, node server.js, env vars, route map.

- [ ] **Step 3: Commit**

```bash
git add .gitignore README.md
git commit -m "docs: update README with backend setup instructions and add .gitignore"
```

---

## Task 14: End-to-end verification

- [ ] **Step 1: Start the server**

```bash
cd "/Users/barris/Desktop/AI Business" && node server.js
```

- [ ] **Step 2: Verify all routes**

```bash
# Public site still works
curl -s http://localhost:3000/ | grep -i sidecar | head -3

# /internal redirects to login
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/internal

# /internal/login serves HTML
curl -s http://localhost:3000/internal/login | grep -i "Sign In" | head -2

# Admin login works
curl -s -X POST http://localhost:3000/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"neil","password":"sidecar2026"}' \
  -c /tmp/admin-cookie.txt

# CRM stats (authenticated)
curl -s http://localhost:3000/api/crm/stats -b /tmp/admin-cookie.txt

# /portal/login serves HTML
curl -s http://localhost:3000/portal/login | grep -i "Sign in" | head -2
```

All checks should return expected HTML/JSON. Fix any failures before marking complete.

- [ ] **Step 3: Commit any fixes**

---

## Self-Review

**Spec coverage check:**

| Spec item | Task |
|-----------|------|
| package.json with all deps | Task 1 |
| db.js with all 5 tables | Task 2 |
| Seed admin user neil/sidecar2026 | Task 2 |
| routes/auth.js | Task 4 |
| routes/crm.js | Task 5 |
| routes/portal.js | Task 7 |
| routes/files.js | Task 6 |
| middleware/requireAdmin.js | Task 3 |
| middleware/requireClient.js | Task 3 |
| uploads/.gitkeep | Task 2 |
| /internal CRM with 5 tabs | Task 10 |
| /portal client portal | Task 11 |
| site-content.js about update | Task 12 |
| .env.example | Task 1 |
| README | Task 13 |
| Tab 1 — Dashboard with stats/pipeline/overdue | Task 10 |
| Tab 2 — Contacts with filters + detail panel | Task 10 |
| Tab 3 — Outreach Tracker with reply status | Task 10 |
| Tab 4 — Follow-up Queue | Task 10 |
| Tab 5 — Client Portal Manager | Task 10 |
| Gmail email logging (manual) | Task 10 (activity modal with email types + gmail note) |
| Portal: parchment/forest palette + Cormorant/Epilogue fonts | Task 11 |
| Portal: download only, no upload by clients | Task 11 |
| Client can't see other clients' files | Task 6 (requireClient + client_id check) |

**Type consistency check:**
- `client_id` used consistently in files table and routes/files.js ✓
- `contact_id` FK in clients table matches CRM query `WHERE contact_id = ?` ✓  
- `reply_status` column added in db.js schema and route correctly updates it ✓
- Session keys `adminId`/`clientId` match in middleware and auth routes ✓

**Placeholder scan:** No TBD/TODO/placeholder patterns found. ✓
