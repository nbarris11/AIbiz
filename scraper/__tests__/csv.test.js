import { buildDedupIndex, isDuplicate } from '../lib/csv.js';

const existingRows = [
  { email: 'john@acme.com', firm_name: 'Acme Insurance', city: 'Troy' },
  { email: 'jane@lawfirm.com', firm_name: 'Law Firm LLC', city: 'Birmingham' },
];

describe('isDuplicate', () => {
  const index = buildDedupIndex(existingRows);

  test('detects duplicate email', () => {
    expect(isDuplicate({ email: 'john@acme.com', firm_name: 'Other Inc', city: 'Novi' }, index)).toBe(true);
  });

  test('detects duplicate firm+city', () => {
    expect(isDuplicate({ email: 'other@acme.com', firm_name: 'Acme Insurance', city: 'Troy' }, index)).toBe(true);
  });

  test('allows new unique row', () => {
    expect(isDuplicate({ email: 'new@firm.com', firm_name: 'New Firm', city: 'Novi' }, index)).toBe(false);
  });

  test('firm+city match is case-insensitive', () => {
    expect(isDuplicate({ email: 'x@x.com', firm_name: 'acme insurance', city: 'troy' }, index)).toBe(true);
  });
});
