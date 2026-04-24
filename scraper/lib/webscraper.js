import { chromium } from 'playwright';
import { isBlockedEmail } from './emailfilter.js';
import { parseName } from './nameparser.js';
import { sleep, randomUserAgent, log } from './utils.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const OWNER_KEYWORDS = [
  'owner', 'founder', 'principal', 'president', 'partner',
  'attorney', 'agent', 'cpa', 'broker', 'contractor', 'operator', 'licensed',
];

const CONTACT_PATHS = [
  '/about', '/about-us', '/team', '/our-team', '/staff', '/people',
  '/attorneys', '/our-attorneys', '/contact', '/contact-us', '/meet-the-team',
  '/leadership', '/owners', '/principals', '/partners', '/agents',
  '/who-we-are',
];

function extractEmails(text) {
  return [...new Set((text.match(EMAIL_REGEX) || []).map(e => e.toLowerCase()))];
}

function extractNamesNearKeywords(text) {
  const names = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!OWNER_KEYWORDS.some(kw => lower.includes(kw))) continue;
    const nameMatches = line.match(/\b([A-Z][a-z]{1,})\s+([A-Z][a-z]{1,})\b/g);
    if (nameMatches) names.push(...nameMatches);
  }
  return [...new Set(names)];
}

function inferEmail(firstName, domain) {
  const clean = firstName.toLowerCase().replace(/[^a-z]/g, '');
  return `${clean}@${domain}`;
}

function getDomain(website) {
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function detectEmailPattern(emails, domain) {
  for (const email of emails) {
    if (!email.endsWith(`@${domain}`)) continue;
    const prefix = email.split('@')[0];
    if (/^[a-z]+$/.test(prefix) && prefix.length > 2) {
      return 'firstname';
    }
    if (/^[a-z]+\.[a-z]+$/.test(prefix)) {
      return 'first.last';
    }
  }
  return null;
}

export async function scrapeWebsite(website) {
  const domain = getDomain(website);
  if (!domain) return null;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: randomUserAgent(),
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    const baseUrl = website.replace(/\/$/, '');
    let allEmails = [];
    let allNames = [];

    for (const path of CONTACT_PATHS) {
      const url = `${baseUrl}${path}`;
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { timeout: 12000, waitUntil: 'domcontentloaded' });
        if (!response || !response.ok()) {
          await page.close();
          continue;
        }
        const text = await page.innerText('body').catch(() => '');
        const emails = extractEmails(text).filter(e => !isBlockedEmail(e));
        const names = extractNamesNearKeywords(text);
        allEmails.push(...emails);
        allNames.push(...names);
      } catch {
        // timeout or nav error — skip this path
      } finally {
        await page.close();
      }

      if (allEmails.length > 0 || allNames.length > 0) break;

      await sleep(2000 + Math.random() * 1500);
    }

    await context.close();

    const uniqueEmails = [...new Set(allEmails)];
    const uniqueNames = [...new Set(allNames)];

    if (uniqueEmails.length > 0) {
      const parsed = uniqueNames.length > 0 ? parseName(uniqueNames[0]) : null;
      const pattern = detectEmailPattern(uniqueEmails, domain);

      if (parsed && uniqueNames.length > 1 && pattern === 'firstname') {
        const derived = inferEmail(parsed.first, domain);
        if (!isBlockedEmail(derived)) {
          return {
            email: derived,
            email_confidence: 'Derived',
            first_name: parsed.first,
            last_name: parsed.last,
            notes: parsed.notes,
          };
        }
      }

      return {
        email: uniqueEmails[0],
        email_confidence: 'Confirmed',
        first_name: parsed?.first || '',
        last_name: parsed?.last || '',
        notes: parsed?.notes || '',
      };
    }

    if (uniqueNames.length > 0) {
      const parsed = parseName(uniqueNames[0]);
      if (parsed.first) {
        const estimated = inferEmail(parsed.first, domain);
        if (!isBlockedEmail(estimated)) {
          return {
            email: estimated,
            email_confidence: 'Estimated',
            first_name: parsed.first,
            last_name: parsed.last,
            notes: parsed.notes,
          };
        }
      }
    }

    log(`NO_CONTACT_FOUND: ${website}`);
    return null;
  } catch (err) {
    log(`SCRAPE_ERROR: ${website} — ${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}
