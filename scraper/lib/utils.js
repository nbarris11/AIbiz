import fs from 'fs';

const SKIP_FIRMS = [
  'state farm', 'allstate', 'farmers insurance', 'nationwide', 'liberty mutual',
  'progressive', 'geico', 'american family',
  're/max', 'remax', 'keller williams', 'coldwell banker', 'century 21',
  'exp realty', 'compass', 'berkshire hathaway',
  'h&r block', 'liberty tax', 'jackson hewitt',
  'doeren mayhew', 'plunkett cooney', 'ernst & young', 'deloitte',
  'pwc', 'kpmg', 'grant thornton', 'bdo',
  'home depot', 'lowes', "lowe's", 'menards',
  '1-800', 'mr. rooter', 'mr rooter', 'roto-rooter', 'roto rooter',
  'service master', 'servicemaster', 'servpro', 'angi', 'homeadvisor'
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

export function shouldSkipFirm(name) {
  const lower = name.toLowerCase();
  return SKIP_FIRMS.some(skip => lower.includes(skip));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

let logStream = null;

export function initLogger(logFile = 'scraper-errors.log') {
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
}

export function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.error(line);
  if (logStream) logStream.write(line + '\n');
}
