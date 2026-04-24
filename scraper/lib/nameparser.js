const PREFIXES = /^(dr|mr|mrs|ms|atty|prof)\.?\s+/i;
const SUFFIXES = /,?\s+(cpa|esq\.?|jd|cfp|cpcu|llc|pc|pllc|jr\.?|sr\.?|ii|iii)\.?$/i;

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function parseName(raw) {
  let name = raw.trim();

  // Strip suffixes first (before comma logic)
  name = name.replace(SUFFIXES, '');

  // "Smith, John" → "John Smith"
  if (/^[A-Z][a-z]+,\s/.test(name)) {
    const [last, first] = name.split(/,\s+/);
    name = `${first.trim()} ${last.trim()}`;
  }

  // Strip prefixes
  name = name.replace(PREFIXES, '');

  const parts = name.trim().split(/\s+/);

  if (parts.length === 1) {
    return { first: capitalize(parts[0]), last: '', notes: 'last name unknown' };
  }

  // Drop middle initial: ["John", "A.", "Smith"] → ["John", "Smith"]
  const filtered = parts.filter(p => !/^[A-Z]\.$/.test(p));

  return {
    first: capitalize(filtered[0] || ''),
    last: capitalize(filtered[filtered.length - 1] || ''),
    notes: ''
  };
}

export function nameFromEmail(email) {
  const prefix = email.split('@')[0].toLowerCase();

  // john.smith → first: John, last: Smith
  if (prefix.includes('.')) {
    const [a, b] = prefix.split('.');
    if (a.length > 1 && b.length > 1) {
      return { first: capitalize(a), last: capitalize(b), notes: '' };
    }
    // j.smith
    if (a.length === 1 && b.length > 1) {
      return { first: '', last: capitalize(b), notes: 'first name unknown — review before sending' };
    }
  }

  // Single word: if looks like a first name (3-7 chars, all alpha, not followed by consonant clusters)
  // Avoid matching patterns like "jsmith" (initial + surname pattern)
  // Check if it matches typical first name length: common first names are 4-7 chars
  // But also account for 3-letter names, while excluding jXXXXX patterns
  // Heuristic: if starts with consonant + more consonants, likely initial + surname
  if (/^[a-z]{3,7}$/.test(prefix) && !/^[bcdfghjklmnpqrstvwxz]{2,}/.test(prefix)) {
    return { first: capitalize(prefix), last: '', notes: 'last name unknown' };
  }

  return { first: '', last: '', notes: 'first name unknown — review before sending' };
}
