import { createObjectCsvWriter } from 'csv-writer';
import { parse } from 'csv-parse/sync';
import fs from 'fs';

const CSV_COLUMNS = [
  { id: 'firm_name', title: 'firm_name' },
  { id: 'first_name', title: 'first_name' },
  { id: 'last_name', title: 'last_name' },
  { id: 'email', title: 'email' },
  { id: 'email_confidence', title: 'email_confidence' },
  { id: 'website', title: 'website' },
  { id: 'industry', title: 'industry' },
  { id: 'city', title: 'city' },
  { id: 'phone', title: 'phone' },
  { id: 'notes', title: 'notes' },
];

export function buildDedupIndex(rows) {
  return {
    emails: new Set(rows.map(r => r.email?.toLowerCase()).filter(Boolean)),
    firmCities: new Set(rows.map(r => `${r.firm_name?.toLowerCase()}|${r.city?.toLowerCase()}`).filter(r => r !== '|')),
  };
}

export function isDuplicate(row, index) {
  if (row.email && index.emails.has(row.email.toLowerCase())) return true;
  const key = `${row.firm_name?.toLowerCase()}|${row.city?.toLowerCase()}`;
  if (index.firmCities.has(key)) return true;
  return false;
}

export function readExistingCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.trim()) return [];
  return parse(content, { columns: true, skip_empty_lines: true });
}

export function createCsvWriter(filePath, append) {
  return createObjectCsvWriter({
    path: filePath,
    header: CSV_COLUMNS,
    append,
  });
}
