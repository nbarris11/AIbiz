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

const NON_NAME_WORDS = new Set([
  // Industry terms
  'Insurance', 'Agent', 'Agents', 'Agency', 'Independent', 'Licensed',
  'Certified', 'Professional', 'Financial', 'Planning', 'Group', 'Team',
  'Real', 'Estate', 'Realty', 'Broker', 'Attorney', 'Legal', 'Law',
  'Building', 'Construction', 'Roofing', 'Plumbing', 'Electrical', 'Hvac',
  'Education', 'Department', 'Dealer', 'Member', 'Associates', 'Services',
  'Solutions', 'Consulting', 'Management', 'Development', 'Properties',
  // Geographic
  'California', 'Michigan', 'Ohio', 'Florida', 'Texas', 'Illinois', 'Alabama',
  'Birmingham', 'Detroit', 'Bloomfield', 'Hills', 'Royal', 'Troy', 'Novi',
  'Plymouth', 'Northville', 'Farmington', 'Rochester', 'Metro', 'Greater',
  'West', 'North', 'South', 'East', 'Central', 'Downtown',
  // Generic / boilerplate
  'Consumer', 'Protection', 'Privacy', 'Policy', 'Terms', 'Service',
  'Complete', 'General', 'National', 'American', 'United', 'First', 'Premier',
  'Rights', 'Reserved', 'Copyright', 'Disclaimer', 'Notice',
  // Accounting / finance specific
  'Expat', 'Taxation', 'Global', 'Network', 'Alliance', 'Affiliated',
  'Audit', 'Compliance', 'Advisory', 'Wealth', 'Retirement', 'Business',
  'Needs', 'Kept', 'Crowe', 'Andersen', 'Deloitte', 'Grant', 'Thornton',
  // Common verbs / prepositions that appear capitalized
  'Talk', 'To', 'With', 'For', 'And', 'Our', 'Your', 'The', 'All',
  'Partnering', 'Contact', 'About', 'Home', 'Menu', 'Call', 'Click',
  'Here', 'More', 'Read', 'Learn', 'Get', 'Find', 'View', 'See',
  'Free', 'New', 'Best', 'Top', 'Local',
  // Entity suffixes
  'Inc', 'Llc', 'Pllc', 'Corp', 'Ltd', 'Co', 'Pc', 'Plc',
]);

function isLikelyName(candidate) {
  const parts = candidate.split(' ');
  if (parts.length !== 2) return false;
  if (parts.some(p => NON_NAME_WORDS.has(p))) return false;
  // Both parts must be 3–15 chars (filters "To", "Of", etc.)
  if (parts.some(p => p.length < 3 || p.length > 15)) return false;
  return true;
}

function extractNamesNearKeywords(text) {
  const names = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!OWNER_KEYWORDS.some(kw => lower.includes(kw))) continue;
    const nameMatches = line.match(/\b([A-Z][a-z]{1,})\s+([A-Z][a-z]{1,})\b/g);
    if (nameMatches) names.push(...nameMatches.filter(isLikelyName));
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
