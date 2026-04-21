# Sidecar Advisory

Marketing site + internal CRM + client portal for Sidecar Advisory.

## Stack

**Public site (static)**
- `index.html` — homepage
- `styles.css` — brand styling
- `script.js` — sticky nav, scroll behavior
- `content/site-content.js` — all copy, editable without touching HTML

**Backend**
- `server.js` — Express entry point
- `db.js` — SQLite schema via `node:sqlite`, seeds admin user on first run
- `routes/auth.js` — admin + client login/logout
- `routes/crm.js` — contacts, activities, follow-ups, outreach, portal management
- `routes/portal.js` — client file list
- `routes/files.js` — file upload (admin) + download (client)
- `middleware/requireAdmin.js` — protects `/api/crm/*` and `/internal`
- `middleware/requireClient.js` — protects `/api/portal/*` and `/portal`
- `sidecar.db` — SQLite database (gitignored, created on first run)
- `uploads/` — uploaded files (gitignored)

## Running Locally

```bash
npm install
node server.js
# or for auto-restart on file changes:
npm run dev
```

Visit `http://localhost:3000`

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
SESSION_SECRET=your-long-random-secret
PORT=3000
```

A default dev secret is used if `SESSION_SECRET` is not set — **always set it in production**.

## Routes

| Route | Description |
|-------|-------------|
| `/` | Public homepage |
| `/internal/login` | Admin login page |
| `/internal` | CRM dashboard (requires admin session) |
| `/portal/login` | Client portal login |
| `/portal` | Client document portal (requires client session) |
| `POST /api/auth/admin/login` | Admin login |
| `POST /api/auth/admin/logout` | Admin logout |
| `GET /api/auth/admin/me` | Current admin session |
| `POST /api/auth/client/login` | Client login |
| `POST /api/auth/client/logout` | Client logout |
| `GET /api/auth/client/me` | Current client session |
| `GET /api/crm/stats` | Dashboard counts + pipeline |
| `GET /api/crm/contacts` | List contacts (supports `?q=`, `?industry=`, `?stage=`) |
| `POST /api/crm/contacts` | Create contact |
| `GET /api/crm/contacts/:id` | Contact detail + activities + files |
| `PUT /api/crm/contacts/:id` | Update contact |
| `DELETE /api/crm/contacts/:id` | Delete contact |
| `POST /api/crm/contacts/:id/activities` | Log activity |
| `POST /api/crm/contacts/:id/followup` | Set/clear follow-up date |
| `POST /api/crm/contacts/:id/reply-status` | Set outreach reply status |
| `GET /api/crm/followups` | All contacts with follow-up dates |
| `GET /api/crm/outreach` | Contacts with source/batch set |
| `GET /api/crm/portal-clients` | List portal clients |
| `POST /api/crm/portal-clients` | Create portal client |
| `POST /api/crm/portal-clients/:id/reset-password` | Reset client password |
| `DELETE /api/crm/portal-clients/:id` | Delete portal client |
| `POST /api/files/upload/:clientId` | Upload file for a client (admin) |
| `DELETE /api/files/file/:fileId` | Delete a file (admin) |
| `GET /api/files/download/:fileId` | Download a file (client, own files only) |
| `GET /api/portal/files` | Client's own file list |

## Default Admin Credentials

Seeded on first run: `neil` / `sidecar2026`

Change via the database or add a password-reset endpoint as needed.
