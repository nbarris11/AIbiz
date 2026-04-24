#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { discoverFirms } from './lib/places.js';
import { scrapeWebsite } from './lib/webscraper.js';
import { enrichWithHunter } from './lib/hunter.js';
import { readExistingCsv, createCsvWriter, buildDedupIndex, isDuplicate } from './lib/csv.js';
import { shouldSkipFirm, log, initLogger, sleep } from './lib/utils.js';

const VALID_INDUSTRIES = ['insurance', 'law', 'cpa', 'realestate', 'contractor', 'roofing', 'hvac', 'electrical', 'plumbing', 'all'];
const VALID_CITIES = ['Birmingham', 'Royal Oak', 'Troy', 'Bloomfield Hills', 'Northville', 'Plymouth', 'Rochester Hills', 'Farmington Hills', 'West Bloomfield', 'Novi', 'all'];

program
  .requiredOption('--industry <industry>', `Industry: ${VALID_INDUSTRIES.join(', ')}`)
  .option('--city <city>', 'City name or "all"', 'all')
  .option('--limit <n>', 'Max rows to write', '50')
  .option('--output <file>', 'Output CSV filename', 'contacts-output.csv')
  .option('--append', 'Append to existing CSV instead of overwriting')
  .parse();

const opts = program.opts();

if (!VALID_INDUSTRIES.includes(opts.industry)) {
  console.error(`Invalid --industry: ${opts.industry}. Valid values: ${VALID_INDUSTRIES.join(', ')}`);
  process.exit(1);
}

const cityLower = opts.city.toLowerCase();
const normalizedCity = cityLower === 'all'
  ? 'all'
  : VALID_CITIES.find(c => c.toLowerCase() === cityLower);

if (!normalizedCity) {
  console.error(`Invalid --city: ${opts.city}. Valid values: ${VALID_CITIES.join(', ')}`);
  process.exit(1);
}

initLogger('scraper-errors.log');

const stats = {
  discovered: 0,
  scraped: 0,
  confirmed: 0,
  derived: 0,
  estimated: 0,
  dropped: 0,
  duplicates: 0,
  errors: 0,
};

const limit = parseInt(opts.limit, 10);
const apiKey = process.env.GOOGLE_PLACES_API_KEY;

if (!apiKey) {
  console.error('Missing GOOGLE_PLACES_API_KEY in .env');
  process.exit(1);
}

const existing = readExistingCsv(opts.output);
const dedupIndex = buildDedupIndex(existing);
const csvWriter = createCsvWriter(opts.output, opts.append || false);
const rows = [];

console.log(`Discovering firms: industry=${opts.industry}, city=${normalizedCity}`);

let firms;
try {
  firms = await discoverFirms({ industry: opts.industry, city: normalizedCity, apiKey });
} catch (err) {
  console.error('Fatal: Google Places discovery failed:', err.message);
  process.exit(1);
}

firms = firms.filter(f => {
  if (shouldSkipFirm(f.name)) {
    log(`SKIPPED_FIRM: ${f.name}`);
    return false;
  }
  return true;
});

stats.discovered = firms.length;
console.log(`Discovered ${firms.length} firms after filtering. Scraping websites...`);

for (const firm of firms) {
  if (rows.length >= limit) break;

  if (!firm.website) {
    log(`NO_WEBSITE: ${firm.name}`);
    stats.dropped++;
    continue;
  }

  let contact;
  try {
    contact = await scrapeWebsite(firm.website);
  } catch (err) {
    log(`SCRAPE_FATAL: ${firm.website} — ${err.message}`);
    stats.errors++;
    continue;
  }

  if (!contact) {
    stats.dropped++;
    continue;
  }

  stats.scraped++;

  if (contact.email_confidence === 'Estimated' && process.env.HUNTER_API_KEY) {
    const enriched = await enrichWithHunter(contact, process.env.HUNTER_API_KEY);
    if (!enriched) {
      stats.dropped++;
      continue;
    }
    Object.assign(contact, enriched);
  }

  const row = {
    firm_name: firm.name,
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    email: contact.email,
    email_confidence: contact.email_confidence,
    website: firm.website,
    industry: firm.industry,
    city: firm.city,
    phone: firm.phone || '',
    notes: contact.notes || '',
  };

  if (isDuplicate(row, dedupIndex)) {
    log(`DUPLICATE: ${row.firm_name} | ${row.email}`);
    stats.duplicates++;
    continue;
  }

  dedupIndex.emails.add(row.email.toLowerCase());
  dedupIndex.firmCities.add(`${row.firm_name.toLowerCase()}|${row.city.toLowerCase()}`);

  rows.push(row);

  if (contact.email_confidence === 'Confirmed') stats.confirmed++;
  else if (contact.email_confidence === 'Derived') stats.derived++;
  else stats.estimated++;

  await sleep(2000 + Math.random() * 1500);
}

if (rows.length > 0) {
  await csvWriter.writeRecords(rows);
}

console.log(`
✓ Run complete
  Firms discovered:     ${stats.discovered}
  Contacts scraped:     ${stats.scraped}
  Emails confirmed:     ${stats.confirmed}
  Emails derived:       ${stats.derived}
  Emails estimated:     ${stats.estimated}
  Rows dropped (generic/no email): ${stats.dropped}
  Duplicates skipped:   ${stats.duplicates}
  Errors logged:        ${stats.errors}  (see scraper-errors.log)
  Output file:          ${opts.output}
`);
