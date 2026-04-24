# Metro Detroit Contact Scraper

Discovers small professional service firms in Metro Detroit (insurance, law, CPA, real estate, contractors) via the Google Places API, scrapes their websites with Playwright to find real personal contacts, and outputs a clean CSV ready to import into a spreadsheet or cold email tool.

**Output columns:** `firm_name, first_name, last_name, email, email_confidence, website, industry, city, phone, notes`

---

## Setup

### 1. Get a Google Places API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **Places API (New)** and click **Enable**
5. Go to **APIs & Services → Credentials → Create Credentials → API Key**
6. Copy the key — Google gives you $200 free credit per month, which covers hundreds of searches

### 2. Get a Hunter.io API Key (optional — 25 free searches/month)

1. Go to [hunter.io](https://hunter.io) and sign up for a free account
2. Navigate to **Account → API**
3. Copy your API key
4. Hunter enrichment is only used for `Estimated` emails and is skipped if the key is not set

### 3. Install dependencies

```bash
cd scraper
npm install
npx playwright install chromium
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your keys:

```
GOOGLE_PLACES_API_KEY=AIza...
HUNTER_API_KEY=abc123...   # optional
```

---

## CLI Usage

```bash
# Single industry, single city
node scraper.js --industry insurance --city Birmingham --limit 20

# Single industry, all cities
node scraper.js --industry law --city all --limit 50

# All industries, all cities
node scraper.js --industry all --city all --limit 100

# Custom output file
node scraper.js --industry contractor --city Troy --limit 30 --output troy-contractors.csv

# Append to existing file (dedup still runs)
node scraper.js --industry cpa --city Novi --limit 20 --append
```

Valid `--industry` values: `insurance`, `law`, `cpa`, `realestate`, `contractor`, `roofing`, `hvac`, `electrical`, `plumbing`, `all`

Valid `--city` values: `Birmingham`, `Royal Oak`, `Troy`, `Bloomfield Hills`, `Northville`, `Plymouth`, `Rochester Hills`, `Farmington Hills`, `West Bloomfield`, `Novi`, or `all`

---

## Email Confidence Labels

| Label | Meaning | Action before sending |
|---|---|---|
| `Confirmed` | Email address found directly on the firm's website | Safe to send |
| `Derived` | Email pattern inferred from a teammate's confirmed email on the same domain, or verified by Hunter.io as deliverable | Safe to send — review name spelling |
| `Estimated` | Best guess: `firstname@domain.com` — not verified | **Review before sending** — verify manually or with a tool like NeverBounce before using in a campaign |

Rows with `Estimated` confidence and a note of `"unverified — check before sending"` were checked by Hunter.io but returned an inconclusive result. These have the highest risk of bouncing.

---

## Files

- `contacts-output.csv` — default output file (gitignored)
- `scraper-errors.log` — skipped firms, blocked emails, scrape errors (gitignored)
- `data/hunter-usage.json` — tracks monthly Hunter.io API call count (resets automatically each month)
