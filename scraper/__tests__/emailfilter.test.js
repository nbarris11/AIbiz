import { isBlockedEmail } from '../lib/emailfilter.js';

describe('isBlockedEmail', () => {
  // Generic prefix blocks
  test('blocks info@domain.com', () => expect(isBlockedEmail('info@acme.com')).toBe(true));
  test('blocks contact@domain.com', () => expect(isBlockedEmail('contact@acme.com')).toBe(true));
  test('blocks support@domain.com', () => expect(isBlockedEmail('support@acme.com')).toBe(true));
  test('blocks noreply@domain.com', () => expect(isBlockedEmail('noreply@acme.com')).toBe(true));
  test('blocks no-reply@domain.com', () => expect(isBlockedEmail('no-reply@acme.com')).toBe(true));
  test('blocks insurance@domain.com', () => expect(isBlockedEmail('insurance@acme.com')).toBe(true));
  test('blocks sales@domain.com', () => expect(isBlockedEmail('sales@acme.com')).toBe(true));
  test('blocks billing@domain.com', () => expect(isBlockedEmail('billing@acme.com')).toBe(true));
  test('blocks helpdesk123@domain.com via substring', () => expect(isBlockedEmail('helpdesk123@acme.com')).toBe(true));
  test('blocks newsletter2024@domain.com via substring', () => expect(isBlockedEmail('newsletter2024@acme.com')).toBe(true));

  // Personal emails pass
  test('allows john@domain.com', () => expect(isBlockedEmail('john@acme.com')).toBe(false));
  test('allows kelly.smith@domain.com', () => expect(isBlockedEmail('kelly.smith@acme.com')).toBe(false));
  test('allows j.johnson@domain.com', () => expect(isBlockedEmail('j.johnson@acme.com')).toBe(false));
  test('allows ryan123@domain.com', () => expect(isBlockedEmail('ryan123@acme.com')).toBe(false));

  // Edge cases
  test('blocks uppercase INFO@domain.com', () => expect(isBlockedEmail('INFO@acme.com')).toBe(true));
  test('allows consultingfirm@acme.com (not just "firm")', () => {
    // "firm" is a blocked prefix. "consultingfirm" stripped to letters is "consultingfirm" ≠ "firm"
    expect(isBlockedEmail('consultingfirm@acme.com')).toBe(false);
  });
});
