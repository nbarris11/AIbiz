# Campaigns & Analytics Design Spec

**Date:** 2026-04-22
**Priority:** Email tracking first, then campaigns, then dashboards

---

## Goal

Transform the CRM's bulk email system into a full campaign engine with per-batch analytics, email sequence automation, link click tracking, Calendly attribution, and enriched Insights dashboards.

---

## Sub-projects (build in this order)

1. **Campaign infrastructure** — data model, campaign builder UI, enrollment engine
2. **Sequence automation** — multi-step sends with delay, auto-stop on reply/bounce
3. **Link click tracking + UTM** — rewrite links through `/r/:id`, append UTM params
4. **Calendly webhook** — auto-attribute bookings to campaigns
5. **Reply sub-statuses** — granular contact statuses
6. **Analytics dashboards** — Insights sub-pages, industry heatmap, pipeline attribution

---

## Data Model

### New tables

**`campaigns`**
```sql
id TEXT PRIMARY KEY
name TEXT NOT NULL          -- user-entered at send time, e.g. "Insurance Agencies — April 2026"
industry TEXT               -- target segment (for heatmap grouping)
status TEXT NOT NULL DEFAULT 'draft'  -- draft | active | paused | completed
notes TEXT
created_at TEXT NOT NULL DEFAULT (datetime('now'))
started_at TEXT
completed_at TEXT
```

**`campaign_steps`**
```sql
id TEXT PRIMARY KEY
campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE
step_number INTEGER NOT NULL   -- 1, 2, 3...
template_id TEXT REFERENCES email_templates(id)
delay_days INTEGER NOT NULL DEFAULT 0   -- 0 = send immediately on enrollment
subject_override TEXT          -- optional override of template subject
```

**`campaign_enrollments`**
```sql
id TEXT PRIMARY KEY
campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE
contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE
status TEXT NOT NULL DEFAULT 'active'  -- active | completed | stopped | replied | bounced | unsubscribed
current_step INTEGER NOT NULL DEFAULT 1
enrolled_at TEXT NOT NULL DEFAULT (datetime('now'))
last_step_sent_at TEXT         -- timestamp when most recent step was sent; used to calculate next step delay
UNIQUE(campaign_id, contact_id)
```

**`link_clicks`**
```sql
id TEXT PRIMARY KEY
activity_id TEXT REFERENCES activities(id)
campaign_id TEXT REFERENCES campaigns(id)
contact_id TEXT REFERENCES contacts(id)
url TEXT NOT NULL              -- destination URL (with UTM params already appended)
clicked_at TEXT                -- NULL until first click; set on first redirect hit
```

### Changes to existing tables

**`activities`** — add columns via migration:
- `campaign_id TEXT` — which campaign this email belongs to (NULL for one-off sends)
- `step_number INTEGER` — which step in the sequence (NULL for one-off sends)

**`contacts.reply_status`** — expand valid values:
- Keep: `None`, `Sent`, `Booked`, `Bounced`
- Add: `Opened`, `Replied — Interested`, `Replied — Not Now`, `Replied — Not Interested`, `Unsubscribed`
- Remove: `Replied` (replaced by sub-statuses), `Not Interested` (replaced by `Replied — Not Interested`)
- Note: existing `Replied` rows kept as-is; UI shows them, user upgrades manually

---

## Sub-project 1: Campaign Infrastructure

### Campaign builder UI (`internal/index.html`)

New **Campaigns** nav item (top-level, between Follow-ups and Insights).

**Campaign list view:**
- Summary tiles: Active campaigns count, avg open rate, avg reply rate
- Table: Campaign name | Sent | Opened % | Replied % | Booked | Status | Date
- "+ New Campaign" button

**Campaign detail view (click a row):**
- Header: name, status badge, started date, industry tag
- Sequence steps listed vertically with delay between each
- Enrollment table: contacts enrolled, their current step, status, last activity

**New campaign form (single-page builder):**
- Campaign name (text input, required)
- Industry/segment (text input, optional — used for heatmap)
- Sequence steps (add/remove dynamically):
  - Step N: template selector + delay (days) input
  - Step 1 delay always 0 (send immediately)
- Contact source: upload CSV or filter from existing contacts
- "Save as Draft" / "Activate" buttons

### Backend

`POST /api/campaigns` — create campaign + steps
`GET /api/campaigns` — list with per-campaign stats (joined from activities + enrollments)
`GET /api/campaigns/:id` — campaign detail + enrollments
`PATCH /api/campaigns/:id` — update status (pause/resume/complete)
`POST /api/campaigns/:id/enroll` — add contacts (array of contact objects or IDs)

---

## Sub-project 2: Sequence Automation Engine

### Background job

Runs every 15 minutes (alongside existing follow-up scanner). Checks:

```sql
SELECT e.*, s.template_id, s.subject_override, s.delay_days, c.*
FROM campaign_enrollments e
JOIN campaign_steps s ON s.campaign_id = e.campaign_id AND s.step_number = e.current_step
JOIN contacts c ON c.id = e.contact_id
WHERE e.status = 'active'
  AND datetime(
    COALESCE(e.last_step_sent_at, e.enrolled_at),
    '+' || (s.delay_days * 24) || ' hours'
  ) <= datetime('now')
```

Step 1: delay is from `enrolled_at` (last_step_sent_at is NULL).
Step 2+: delay is from `last_step_sent_at` (set when previous step was sent).
After sending a step, always update `last_step_sent_at = now()`.

For each due enrollment:
1. Render merge fields from template + contact
2. Call `sendEmail()` with campaign_id + step_number
3. Advance `current_step` or mark enrollment `completed` if last step
4. Respect business hours (Mon–Fri 9am–5pm ET) — same rule as existing follow-ups

**Auto-stop triggers:**
- Contact receives a reply → enrollment status = `replied`, no further steps
- Bounce detected → enrollment status = `bounced`
- Contact manually set to Booked/Unsubscribed → enrollment status = `stopped`
- Campaign paused → all active enrollments pause (resume when campaign resumes)

---

## Sub-project 3: Link Click Tracking + UTM

### Link rewriting

In `sendEmail()`, after building `html`, rewrite all `<a href="...">` links:
1. For each link, create a `link_clicks` row (id, activity_id, campaign_id, contact_id, url)
2. Replace href with `https://app.sidecaradvisory.com/r/{clickId}`
3. Append UTM params to the stored destination URL:
   - `utm_source=sidecar-crm`
   - `utm_campaign={campaign-slug}` (slugified campaign name, empty for one-offs)
   - `utm_medium=email`
   - `utm_content=step-{N}` (or `direct` for one-offs)

**Exception:** Do not rewrite the tracking pixel `<img src="/t/...">` — that's already handled.

### Redirect route

`GET /r/:clickId` — public, no auth:
1. Look up `link_clicks` row by id
2. Update `clicked_at` if first click (already set = repeat click, still redirect)
3. 302 redirect to the stored URL (with UTM params already appended)
4. Falls back to homepage if clickId not found

---

## Sub-project 4: Calendly Webhook

### Endpoint

`POST /webhooks/calendly` — public, no session auth. Verify Calendly's HMAC-SHA256 signature: Calendly sends a `Calendly-Webhook-Signature` header containing `t=<timestamp>,v1=<signature>`. Compute `HMAC-SHA256(CALENDLY_WEBHOOK_SECRET, t + '.' + rawBody)` and compare. Reject with 403 if mismatch.
1. Parse `invitee.email` from Calendly payload
2. Look up contact by email in contacts table
3. If found:
   - Set `reply_status = 'Booked'`
   - Find most recent active/recent `campaign_enrollment` for this contact → get `campaign_id`
   - Insert `activities` row: `type = 'session_booked'`, `campaign_id`, `subject = 'Clarity Session Booked'`
4. If not found: log warning, return 200 (don't error — Calendly retries)

### Setup instructions (for user)

In Calendly: Account → Integrations → Webhooks → Add webhook → URL: `https://app.sidecaradvisory.com/webhooks/calendly` → Events: `invitee.created`

Store Calendly webhook signing key in `.env` as `CALENDLY_WEBHOOK_SECRET`.

---

## Sub-project 5: Reply Sub-Statuses

### Contact status dropdown (UI)

Replace current reply_status values with:
- `None` — never contacted
- `Sent` — email sent, awaiting reply
- `Opened` — opened email, no reply yet
- `Replied — Interested` — positive signal
- `Replied — Not Now` — check back later
- `Replied — Not Interested` — hard no
- `Booked` — Clarity Session scheduled
- `Unsubscribed` — asked to stop
- `Bounced` — bad email

Auto-detection (via IMAP sync) still sets `Replied` generically → shown in UI as plain "Replied" until user upgrades it. Auto-detection never downgrades from a manual sub-status.

When status set to `Unsubscribed`: auto-stop any active campaign enrollments for this contact.

---

## Sub-project 6: Analytics Dashboards

### Insights nav becomes a section with three sub-views

**Overview** (existing content, keep as-is, add open tracking tiles already built)

**By Industry** (`/insights/industry`)
Table: Industry | Sent | Open % | Reply % | Replied Interested % | Booked | color-coded cells (green = above avg, yellow = below avg)
Data source: join activities + contacts grouped by `contacts.industry`

**Attribution** (`/insights/attribution`)
Two sections:
1. Per-campaign table: Campaign | Sent | Opens | Open % | Replies | Reply % | Booked | Step that generated reply (most common)
2. Pipeline table: Contact name | Campaign | Step replied on | Days to reply | Booked?

---

## Backward Compatibility — Bulk Email Must Not Break

The existing bulk email feature (`POST /api/email/bulk-send`, progress streaming, CSV import, in-memory job tracking) **must continue to work exactly as before**. Every change to shared code must be additive and opt-in. Specific rules:

1. **`sendEmail()` signature** — new `campaign_id` and `step_number` params are optional and default to `null`. All existing call sites pass neither and must keep working unchanged.

2. **Activity INSERT** — `campaign_id` and `step_number` columns are nullable. Bulk email logs activities with both as `null`. No existing query that reads activities should break.

3. **Link rewriting** — applies to all outgoing emails (bulk and campaign). It is purely additive: links still go to the same destination, they just pass through `/r/:id` first. If link rewriting fails for any reason, fall back to sending the original unmodified HTML — never block email delivery.

4. **`recomputeReplyStatus()`** — the new reply sub-statuses are set manually only. Auto-recompute only touches `None → Sent → Replied` transitions. It never overwrites `Replied — Interested`, `Replied — Not Now`, `Replied — Not Interested`, `Unsubscribed`, `Booked`, or `Bounced`.

5. **Follow-up scanner** — checks `reply_status NOT IN ('Replied', 'Booked', 'Not Interested', 'Bounced')`. Must be updated to also exclude all new sub-statuses: `'Replied — Interested'`, `'Replied — Not Now'`, `'Replied — Not Interested'`, `'Unsubscribed'`.

6. **New DB columns on `activities`** — migrations use `ALTER TABLE ... ADD COLUMN` with NULL default. All existing `SELECT *` queries return the new columns as null for old rows — no breakage.

7. **No breaking schema changes** — no columns removed, no NOT NULL added to existing columns, no table renames.

---

## Sequence of builds (priority order)

Given the user's priority ("email tracking first"), implement in this order:

1. DB migrations (campaigns, campaign_steps, campaign_enrollments, link_clicks, activities columns)
2. Link click tracking + UTM (immediate value, no campaign needed)
3. Campaign data model + builder UI + enrollment API
4. Sequence automation engine (background job)
5. Calendly webhook
6. Reply sub-statuses (UI + logic update)
7. Analytics dashboards (Insights sub-pages, industry heatmap, attribution)

---

## Files to create or modify

| File | Change |
|------|--------|
| `db.js` | Migrations for all new tables + activity columns |
| `routes/campaigns.js` | New — all campaign CRUD + enrollment endpoints |
| `routes/webhooks.js` | New — Calendly webhook handler |
| `routes/redirect.js` | New — `/r/:clickId` link tracking redirect |
| `server.js` | Mount 3 new routers |
| `services/email.js` | Link rewriting + UTM, pass campaign_id/step_number to send/log |
| `services/campaign-runner.js` | New — sequence automation background job |
| `routes/crm.js` | Insights sub-views (by_industry enhanced, attribution queries) |
| `internal/index.html` | Campaigns nav + views, campaign builder, Insights sub-nav, reply sub-status dropdown |
