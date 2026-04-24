import fetch from 'node-fetch';
import { sleep, log } from './utils.js';

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

const INDUSTRY_QUERIES = {
  insurance: ['independent insurance agency {city} Michigan'],
  law: ['law firm estate planning {city} Michigan', 'family law attorney {city} Michigan'],
  cpa: ['CPA firm accounting {city} Michigan'],
  realestate: ['real estate brokerage {city} Michigan'],
  contractor: [
    'general contractor {city} Michigan',
    'home builder {city} Michigan',
    'remodeling contractor {city} Michigan',
  ],
  roofing: ['roofing contractor {city} Michigan'],
  hvac: ['HVAC contractor {city} Michigan'],
  electrical: ['electrical contractor {city} Michigan'],
  plumbing: ['plumbing contractor {city} Michigan'],
};

const CITIES = [
  'Birmingham', 'Royal Oak', 'Troy', 'Bloomfield Hills', 'Northville',
  'Plymouth', 'Rochester Hills', 'Farmington Hills', 'West Bloomfield', 'Novi',
];

export function getQueries(industry, city) {
  const industries = industry === 'all' ? Object.keys(INDUSTRY_QUERIES) : [industry];
  const cities = city === 'all' ? CITIES : [city];
  const results = [];
  for (const ind of industries) {
    for (const c of cities) {
      for (const template of (INDUSTRY_QUERIES[ind] || [])) {
        results.push({ query: template.replace('{city}', c), industry: ind, city: c });
      }
    }
  }
  return results;
}

async function textSearch(query, apiKey) {
  const res = await fetch(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber',
    },
    body: JSON.stringify({ textQuery: query }),
  });
  const data = await res.json();
  if (!res.ok) {
    log(`PLACES_ERROR: ${data.error?.message || res.status} for query "${query}"`);
    return [];
  }
  return data.places || [];
}

export async function discoverFirms({ industry, city, apiKey }) {
  const queries = getQueries(industry, city);
  const firms = [];
  const seenIds = new Set();

  for (const { query, industry: ind, city: c } of queries) {
    let places;
    try {
      places = await textSearch(query, apiKey);
    } catch (err) {
      log(`PLACES_FETCH_ERROR: ${err.message} — query: "${query}"`);
      continue;
    }

    if (!places.length) {
      log(`PLACES_ZERO_RESULTS: "${query}"`);
      continue;
    }

    for (const place of places) {
      if (seenIds.has(place.id)) continue;
      seenIds.add(place.id);

      firms.push({
        name: place.displayName?.text || '',
        address: place.formattedAddress || '',
        website: place.websiteUri || '',
        phone: place.nationalPhoneNumber || '',
        place_id: place.id,
        industry: ind,
        city: c,
      });
    }

    await sleep(500);
  }

  return firms;
}
