const BLOCKED_EMAIL_PREFIXES = [
  'info', 'contact', 'admin', 'hello', 'help', 'support', 'office',
  'mail', 'email', 'general', 'inquiry', 'inquiries', 'questions',
  'sales', 'billing', 'accounts', 'accounting', 'bookkeeping',
  'service', 'services', 'team', 'staff', 'reception', 'receptionist',
  'front', 'frontdesk', 'desk', 'main', 'firm', 'law', 'legal',
  'cpa', 'tax', 'taxes', 'realty', 'realtor', 'properties', 'homes',
  'insurance', 'agency', 'agents', 'quotes', 'quote', 'claims', 'policy',
  'news', 'newsletter', 'media', 'press', 'marketing', 'ads',
  'webmaster', 'web', 'noreply', 'donotreply',
  'postmaster', 'abuse', 'spam', 'unsubscribe', 'feedback',
  'welcome', 'careers', 'jobs', 'hr', 'hiring', 'recruiter',
  'privacy', 'compliance', 'security', 'notify', 'alerts',
  'notifications', 'automated', 'auto', 'system', 'bot', 'concierge',
  'customercare', 'customer', 'clients', 'clientservices',
  'newclients', 'newclient', 'intake', 'referrals', 'referral',
  'loans', 'mortgages', 'lending', 'rates', 'invest', 'investments',
  'resumes', 'resume', 'digitalcare', 'digital', 'connect', 'reach',
  'learnmore', 'getstarted', 'schedule', 'appointments', 'appointment',
  'save', 'deals', 'offers', 'promo', 'promotions', 'estimate',
  'estimates', 'bid', 'bids', 'dispatch', 'field', 'crew', 'ops',
  'operations', 'warehouse', 'shop', 'parts', 'supply', 'purchasing'
];

const BLOCKED_SUBSTRINGS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'newsletter', 'notification', 'automated', 'helpdesk', 'support'
];

export function isBlockedEmail(email) {
  const [rawPrefix] = email.toLowerCase().split('@');
  const cleanPrefix = rawPrefix.replace(/[^a-z]/g, '');
  if (BLOCKED_EMAIL_PREFIXES.includes(cleanPrefix)) return true;
  if (BLOCKED_SUBSTRINGS.some(sub => rawPrefix.includes(sub))) return true;
  return false;
}
