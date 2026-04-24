import { sleep, randomUserAgent, shouldSkipFirm } from '../lib/utils.js';

describe('shouldSkipFirm', () => {
  test('skips State Farm (case-insensitive)', () => {
    expect(shouldSkipFirm('State Farm Insurance')).toBe(true);
  });
  test('skips RE/MAX variant', () => {
    expect(shouldSkipFirm('RE/MAX Realty Group')).toBe(true);
  });
  test('skips roto-rooter', () => {
    expect(shouldSkipFirm('Roto-Rooter Plumbing')).toBe(true);
  });
  test('allows small local firm', () => {
    expect(shouldSkipFirm('Smith & Associates Insurance')).toBe(false);
  });
  test('allows independent CPA firm', () => {
    expect(shouldSkipFirm('Johnson CPA Group')).toBe(false);
  });
});

describe('sleep', () => {
  test('resolves after at least the given ms', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});

describe('randomUserAgent', () => {
  test('returns a non-empty string', () => {
    const ua = randomUserAgent();
    expect(typeof ua).toBe('string');
    expect(ua.length).toBeGreaterThan(10);
  });
  test('returns different agents across calls (probabilistic)', () => {
    const agents = new Set(Array.from({ length: 20 }, () => randomUserAgent()));
    expect(agents.size).toBeGreaterThan(1);
  });
});
