import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isBlockedEmail } from './emailfilter.js';
import { log } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = path.join(__dirname, '../data/hunter-usage.json');
const MONTHLY_CAP = 20;

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function readUsage() {
  try {
    const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.month !== currentMonth()) return { month: currentMonth(), count: 0 };
    return data;
  } catch {
    return { month: currentMonth(), count: 0 };
  }
}

function writeUsage(data) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

function incrementUsage() {
  const data = readUsage();
  data.count += 1;
  writeUsage(data);
  return data.count;
}

export function hunterUsageRemaining() {
  const { count } = readUsage();
  return Math.max(0, MONTHLY_CAP - count);
}

async function domainSearch(domain, apiKey) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`;
  const res = await fetch(url);
  return res.json();
}

async function verifyEmail(email, apiKey) {
  const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
  const res = await fetch(url);
  return res.json();
}

export async function enrichWithHunter(row, apiKey) {
  if (hunterUsageRemaining() <= 0) {
    log('HUNTER_CAP_REACHED: skipping enrichment');
    return row;
  }

  const domain = row.email?.split('@')[1];
  if (!domain) return row;

  let domainData;
  try {
    domainData = await domainSearch(domain, apiKey);
    incrementUsage();
  } catch (err) {
    log(`HUNTER_DOMAIN_ERROR: ${err.message}`);
    return row;
  }

  if (domainData.data?.emails?.length > 0) {
    const personalEmails = domainData.data.emails
      .map(e => e.value)
      .filter(e => e && !isBlockedEmail(e));

    if (personalEmails.length > 0) {
      const pattern = domainData.data.pattern;
      if (pattern && row.first_name) {
        const derived = pattern
          .replace('{first}', row.first_name.toLowerCase())
          .replace('{last}', (row.last_name || '').toLowerCase())
          .replace('{f}', (row.first_name[0] || '').toLowerCase())
          + `@${domain}`;
        if (!isBlockedEmail(derived)) {
          return { ...row, email: derived, email_confidence: 'Derived' };
        }
      }
    }
  }

  if (hunterUsageRemaining() <= 0) return row;

  let verifyData;
  try {
    verifyData = await verifyEmail(row.email, apiKey);
    incrementUsage();
  } catch (err) {
    log(`HUNTER_VERIFY_ERROR: ${err.message}`);
    return row;
  }

  const result = verifyData.data?.result;
  if (result === 'deliverable') {
    return { ...row, email_confidence: 'Derived' };
  }
  if (result === 'undeliverable') {
    log(`UNDELIVERABLE: ${row.email}`);
    return null;
  }
  return { ...row, notes: (row.notes ? row.notes + ' | ' : '') + 'unverified — check before sending' };
}
