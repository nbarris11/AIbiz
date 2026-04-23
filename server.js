require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

// ── GLOBAL CRASH GUARDS ──────────────────────────────
// Log unhandled errors instead of crashing. An email send that throws should
// never take the whole server down.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});

const authRouter = require('./routes/auth');
const crmRouter = require('./routes/crm');
const portalRouter = require('./routes/portal');
const filesRouter = require('./routes/files');
const emailRouter = require('./routes/email');
const trackRouter = require('./routes/track');
const redirectRouter = require('./routes/redirect');
const campaignsRouter = require('./routes/campaigns');
const requireAdmin = require('./middleware/requireAdmin');
const requireClient = require('./middleware/requireClient');
const { startEmailSync, startFollowUpScheduler } = require('./services/email');
const { startCampaignRunner } = require('./services/campaign-runner');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'sidecar-dev-secret-change-in-prod';

// Trust Cloudflare Tunnel as a proxy so req.secure and cookies work correctly
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
}));

// ── API ROUTES ────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/crm', crmRouter);
app.use('/api/portal', portalRouter);
app.use('/api/files', filesRouter);
app.use('/api/email', emailRouter);

// ── EMAIL TRACKING ROUTE ────────────────────────────
app.use('/t', trackRouter);
app.use('/r', redirectRouter);
app.use('/api/campaigns', campaignsRouter);

// ── INTERNAL CRM PAGES ───────────────────────────────
app.get('/internal/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'internal', 'login.html'));
});
app.get(['/internal', '/internal/'], requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'internal', 'index.html'));
});

// ── CLIENT PORTAL PAGES ──────────────────────────────
app.get('/portal/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal', 'login.html'));
});
app.get(['/portal', '/portal/'], requireClient, (req, res) => {
  res.sendFile(path.join(__dirname, 'portal', 'index.html'));
});

// ── STATIC SITE (existing files, served last) ────────
app.use(express.static(path.join(__dirname)));

// ── API ERROR HANDLER ────────────────────────────────
// Ensures /api/* routes always return JSON, never HTML, even on crashes.
app.use('/api', (err, req, res, next) => {
  console.error('[api-error]', req.path, err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: (err && err.message) || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Sidecar Advisory running at http://localhost:${PORT}`);
  startEmailSync();
  startFollowUpScheduler();
  startCampaignRunner();
});
