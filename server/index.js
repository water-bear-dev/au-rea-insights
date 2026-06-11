const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Load school rankings database
const schoolsDbPath = path.join(__dirname, 'schools_db.json');
let schoolsDb = { VIC: [], NSW: [], QLD: [] };
try {
  schoolsDb = JSON.parse(fs.readFileSync(schoolsDbPath, 'utf8'));
} catch (e) {
  console.error('Failed to load schools database:', e);
}

// In-memory cache for dynamically loaded school zone boundary files
const boundaryCache = {};

function getBoundaryGeoJson(state, schoolType) {
  const stateCode = String(state || '').toUpperCase().trim();
  const typeCode = String(schoolType || '').toLowerCase().trim();
  const key = `${stateCode}_${typeCode}`;
  
  if (boundaryCache[key]) {
    return boundaryCache[key];
  }
  
  const filePath = path.join(__dirname, 'data', 'school-zones', `${stateCode.toLowerCase()}_${typeCode}.json`);
  try {
    if (fs.existsSync(filePath)) {
      boundaryCache[key] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return boundaryCache[key];
    }
  } catch (e) {
    console.error(`Failed to load school zones boundary file for ${key}:`, e);
  }
  return { type: 'FeatureCollection', features: [] };
}

// Geocode address using Nominatim (with custom User-Agent)
async function geocodeAddress(addressStr) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addressStr)}&format=json&limit=1`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'MyAppUserAgent/1.0'
      },
      timeout: 5000
    });
    if (response.data && response.data.length > 0) {
      return {
        lat: parseFloat(response.data[0].lat),
        lng: parseFloat(response.data[0].lon)
      };
    }
  } catch (e) {
    console.warn(`[Proxy] Geocoding failed for ${addressStr}: ${e.message}`);
  }
  return null;
}

// Ray-casting Point-in-Polygon helper
function isPointInPolygon(point, polygon) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Spatial lookup to find zoned school name
function findSchoolBySpatialLookup(lat, lng, state, schoolType) {
  const geojson = getBoundaryGeoJson(state, schoolType);
  if (!geojson || !geojson.features) return null;
  const point = [lng, lat];
  for (const feature of geojson.features) {
    if (feature.properties && feature.properties.state.toUpperCase() === String(state).toUpperCase()) {
      const coords = feature.geometry.coordinates;
      if (coords && coords[0]) {
        const exteriorRing = coords[0];
        if (isPointInPolygon(point, exteriorRing)) {
          return feature.properties.schoolName;
        }
      }
    }
  }
  return null;
}

// Haversine distance calculator
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

// Helper to standardise street name for property.com.au URLs
function getStreetSlug(street) {
  let slug = street.toLowerCase();
  // Replace unit slashes with hyphens (e.g. 2/1 -> 2-1)
  slug = slug.replace(/\//g, '-');
  // Replace spaces/special chars
  slug = slug.replace(/[^a-z0-9\s-]/g, '');
  slug = slug.replace(/\s+/g, '-');
  
  // Normalise suffixes
  const suffixes = {
    'drive': 'dr',
    'street': 'st',
    'road': 'rd',
    'avenue': 'ave',
    'court': 'ct',
    'parade': 'pde',
    'place': 'pl',
    'highway': 'hwy',
    'terrace': 'tce',
    'lane': 'ln'
  };
  
  for (const [full, short] of Object.entries(suffixes)) {
    if (slug.endsWith(`-${full}`)) {
      slug = slug.slice(0, -full.length) + short;
      break;
    }
  }
  
  return slug;
}

function getPropertyProfileUrl(state, suburb, postcode, street) {
  let streetLower = street.toLowerCase();
  const suburbLower = suburb.toLowerCase().replace(/\s+/g, '-');
  const stateLower = state.toLowerCase();
  
  const streetReplacements = {
    'avenue': 'ave',
    'street': 'st',
    'road': 'rd',
    'drive': 'dr',
    'court': 'ct',
    'place': 'pl',
    'lane': 'ln',
    'parade': 'pde',
    'highway': 'hwy',
    'terrace': 'tce',
    'boulevard': 'bvd',
    'crescent': 'cres',
    'grove': 'gr',
    'close': 'cl'
  };
  
  let unitPrefix = '';
  const unitRegex = /^(\d+)\/(\d+)\s+(.*)/i;
  const unitMatch = streetLower.match(unitRegex);
  
  if (unitMatch) {
    unitPrefix = `unit-${unitMatch[1]}-${unitMatch[2]}-`;
    streetLower = unitMatch[3];
  }
  
  let streetSlug = streetLower.replace(/[^a-z0-9\s-]/g, '').trim();
  for (const [full, short] of Object.entries(streetReplacements)) {
    const regex = new RegExp(`\\b${full}$`, 'i');
    if (regex.test(streetSlug)) {
      streetSlug = streetSlug.replace(regex, short);
      break;
    }
  }
  
  streetSlug = streetSlug.replace(/\s+/g, '-');
  
  return `https://www.realestate.com.au/property/${unitPrefix}${streetSlug}-${suburbLower}-${stateLower}-${postcode}/`;
}

function getPropertyComAuProfileUrl(state, suburb, postcode, street) {
  const stateLower = String(state || '').toLowerCase();
  const suburbSlug = String(suburb || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  const streetSlug = getStreetSlug(String(street || ''));
  const postcodeSafe = String(postcode || '').trim();
  return `https://www.property.com.au/${stateLower}/${suburbSlug}-${postcodeSafe}/${streetSlug}/`;
}

function getAllhomesPropertyUrl(state, suburb, postcode, street) {
  let streetLower = String(street || '').toLowerCase().trim();
  let unitPrefix = '';
  
  // Convert unit prefix format, e.g. "75/310" to "unit-75-310-"
  const unitRegex = /^(\d+)\/(\d+)\s+(.*)/i;
  const unitMatch = streetLower.match(unitRegex);
  if (unitMatch) {
    unitPrefix = `unit-${unitMatch[1]}-${unitMatch[2]}-`;
    streetLower = unitMatch[3];
  }
  
  const streetSlug = streetLower
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
    
  const suburbSlug = String(suburb || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
  const stateSlug = String(state || '').toLowerCase().trim();
  const postcodeSafe = String(postcode || '').trim();

  return `https://www.allhomes.com.au/${unitPrefix}${streetSlug}-${suburbSlug}-${stateSlug}-${postcodeSafe}`;
}

function parseAddressFromRealEstatePropertyUrl(inputUrl) {
  if (!inputUrl) return null;

  try {
    const parsedUrl = new URL(inputUrl);
    const pathname = parsedUrl.pathname.toLowerCase();
    const match = pathname.match(/\/property\/(.+)-([a-z-]+)-(vic|nsw|qld|wa|sa|tas|act|nt)-(\d{4})\/?$/i);
    if (!match) return null;

    let streetSlug = match[1];
    const suburb = match[2].replace(/-/g, ' ').trim();
    const state = match[3].toUpperCase();
    const postcode = match[4];

    // Convert unit prefix back into "x/y " format where possible
    streetSlug = streetSlug.replace(/^unit-(\d+)-(\d+)-/, '$1/$2 ');

    const suffixes = {
      ave: 'Avenue',
      st: 'Street',
      rd: 'Road',
      dr: 'Drive',
      ct: 'Court',
      pl: 'Place',
      ln: 'Lane',
      pde: 'Parade',
      hwy: 'Highway',
      tce: 'Terrace',
      bvd: 'Boulevard',
      cres: 'Crescent',
      gr: 'Grove',
      cl: 'Close'
    };

    const parts = streetSlug.split('-').filter(Boolean);
    if (parts.length > 0) {
      const last = parts[parts.length - 1];
      if (suffixes[last]) {
        parts[parts.length - 1] = suffixes[last];
      }
    }

    const street = parts.join(' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    if (!street || !suburb || !state || !postcode) return null;

    return { street, suburb, state, postcode };
  } catch {
    return null;
  }
}

function normalizeLandSize(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;
  const cleaned = rawValue
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(m²|sqm|m2|square\s*meters|sq\s*meters|sq\s*m)$/i);
  const approxMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(m²|sqm|m2|square\s*meters|sq\s*meters|sq\s*m)\s*(?:approx(?:\.|imately)?|about|circa)?$/i);
  const resolvedMatch = match || approxMatch;
  if (!resolvedMatch) return null;
  const value = Math.round(parseFloat(resolvedMatch[1]));
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value}m²`;
}

function createLandSizeResolution(status, value, source, reason) {
  return { status, value, source, reason };
}

function createLandSizeAttemptLog(step, resolution, waitBeforeMs = 0) {
  return {
    step,
    source: resolution.source || 'unknown',
    status: resolution.status || 'unverified',
    reason: resolution.reason || 'unknown',
    landSize: resolution.value || null,
    waitBeforeMs
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



function extractLandSizeFromHtml(htmlText) {
  if (!htmlText || typeof htmlText !== 'string') return null;
  const flattenedHtml = htmlText.replace(/<\/?[^>]+>/g, ' ');

  // 1. Common free-text patterns
  const textRegex = /(?:land\s+size|land\s+area|block\s+size)(?:\s+of)?[\s:]*([\d,]+(?:\.\d+)?\s*(?:m²|m2|sqm|sq\.?\s*m|square\s+meters?|sq\s*meters?))/i;
  const textMatch = flattenedHtml.match(textRegex);
  if (textMatch) {
    return normalizeLandSize(textMatch[1]);
  }

  // 2. JSON-ish numeric field patterns
  const jsonRegex = /"landSize"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/i;
  const jsonMatch = htmlText.match(jsonRegex);
  if (jsonMatch) {
    return normalizeLandSize(`${Math.round(parseFloat(jsonMatch[1]))}m²`);
  }

  // 3. Alternate key patterns that appear on some property pages
  const altRegex = /"(?:land_area|landArea|blockSize)"\s*:\s*"?(?:([\d,]+(?:\.\d+)?)\s*(?:m²|m2|sqm))"?/i;
  const altMatch = htmlText.match(altRegex);
  if (altMatch) {
    return normalizeLandSize(`${altMatch[1]}m²`);
  }

  return null;
}

async function fetchLandSizeFromRealEstateProfile(state, suburb, postcode, street, axiosInstance = axios) {
  const profileUrl = getPropertyProfileUrl(state, suburb, postcode, street);
  try {
    console.log(`[Proxy] Fetching official profile from realestate.com.au: ${profileUrl}`);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    const response = await axiosInstance.get(profileUrl, { headers, timeout: 5000 });
    const htmlText = response.data;

    const normalized = extractLandSizeFromHtml(htmlText);
    if (normalized) {
      console.log(`[Proxy] Resolved verified land size from realestate.com.au: ${normalized}`);
      return createLandSizeResolution('verified', normalized, 'realestate_profile_text', 'structured_profile_match');
    }
  } catch (e) {
    console.warn(`[Proxy] Failed to fetch official realestate.com.au profile page: ${e.message}`);
    return createLandSizeResolution('unverified', null, 'realestate_profile_error', e.message);
  }
  return createLandSizeResolution('unverified', null, 'realestate_profile_unavailable', 'no_structured_land_size');
}

async function fetchLandSizeFromPropertyComAu(state, suburb, postcode, street, axiosInstance = axios) {
  const profileUrl = getPropertyComAuProfileUrl(state, suburb, postcode, street);
  try {
    console.log(`[Proxy] Fetching property.com.au page: ${profileUrl}`);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    const response = await axiosInstance.get(profileUrl, { headers, timeout: 5000 });
    const normalized = extractLandSizeFromHtml(response.data);
    if (normalized) {
      console.log(`[Proxy] Resolved verified land size from property.com.au: ${normalized}`);
      return createLandSizeResolution('verified', normalized, 'property_com_au_text', 'structured_profile_match');
    }
  } catch (e) {
    console.warn(`[Proxy] Failed to fetch property.com.au page: ${e.message}`);
    return createLandSizeResolution('unverified', null, 'property_com_au_error', e.message);
  }
  return createLandSizeResolution('unverified', null, 'property_com_au_unavailable', 'no_structured_land_size');
}

async function fetchLandSizeFromAllhomes(state, suburb, postcode, street, axiosInstance = axios) {
  const propertyUrl = getAllhomesPropertyUrl(state, suburb, postcode, street);
  try {
    console.log(`[Proxy] Fetching allhomes.com.au page: ${propertyUrl}`);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    const response = await axiosInstance.get(propertyUrl, { headers, timeout: 5000 });
    const normalized = extractLandSizeFromHtml(response.data);
    if (normalized) {
      console.log(`[Proxy] Resolved verified land size from allhomes.com.au: ${normalized}`);
      return createLandSizeResolution('verified', normalized, 'allhomes_text', 'structured_profile_match');
    }
  } catch (e) {
    console.warn(`[Proxy] Failed to fetch allhomes.com.au page: ${e.message}`);
    return createLandSizeResolution('unverified', null, 'allhomes_error', e.message);
  }
  return createLandSizeResolution('unverified', null, 'allhomes_unavailable', 'no_structured_land_size');
}



async function resolveLandSizeStrict(address, options = {}) {
  const axiosInstance = options.axiosInstance || axios;
  const waitMs = Number.isFinite(options.waitMs) ? Math.max(0, options.waitMs) : 5000;
  const sleepFn = options.sleepFn || sleep;
  const attempts = [];

  const profileResolution = await fetchLandSizeFromRealEstateProfile(
    address.state,
    address.suburb,
    address.postcode,
    address.street,
    axiosInstance
  );
  const profileAttempt = createLandSizeAttemptLog('realestate.com.au', profileResolution, 0);
  attempts.push(profileAttempt);
  console.log('[Proxy][LandSizeAttempt]', JSON.stringify(profileAttempt));

  if (profileResolution.status === 'verified' && profileResolution.value) {
    return { ...profileResolution, attempts };
  }

  if (waitMs > 0) {
    console.log(`[Proxy] Waiting ${waitMs}ms before property.com.au fallback...`);
    await sleepFn(waitMs);
  }

  const propertyResolution = await fetchLandSizeFromPropertyComAu(
    address.state,
    address.suburb,
    address.postcode,
    address.street,
    axiosInstance
  );
  const propertyAttempt = createLandSizeAttemptLog('property.com.au', propertyResolution, waitMs);
  attempts.push(propertyAttempt);
  console.log('[Proxy][LandSizeAttempt]', JSON.stringify(propertyAttempt));
  if (propertyResolution.status === 'verified' && propertyResolution.value) {
    return { ...propertyResolution, attempts };
  }

  if (waitMs > 0) {
    console.log(`[Proxy] Waiting ${waitMs}ms before allhomes.com.au fallback...`);
    await sleepFn(waitMs);
  }

  const allhomesResolution = await fetchLandSizeFromAllhomes(
    address.state,
    address.suburb,
    address.postcode,
    address.street,
    axiosInstance
  );
  const allhomesAttempt = createLandSizeAttemptLog('allhomes.com.au', allhomesResolution, waitMs);
  attempts.push(allhomesAttempt);
  console.log('[Proxy][LandSizeAttempt]', JSON.stringify(allhomesAttempt));
  if (allhomesResolution.status === 'verified' && allhomesResolution.value) {
    return { ...allhomesResolution, attempts };
  }

  return {
    ...createLandSizeResolution(
    'unverified',
    null,
    allhomesResolution.source || propertyResolution.source || profileResolution.source,
    allhomesResolution.reason || propertyResolution.reason || profileResolution.reason || 'verification_failed'
    ),
    attempts
  };
}

// Find the best entry for a school, looking back at historical years if the current year is unranked
function findBestSchoolMatch(stateSchools, matchedSchoolName, schoolType) {
  const matches = stateSchools.filter(s => s.name.toLowerCase() === matchedSchoolName.toLowerCase());
  if (matches.length === 0) return null;
  
  // Sort by assessedYear descending so we check most recent first
  matches.sort((a, b) => b.assessedYear - a.assessedYear);
  
  const hasRank = (s) => {
    if (schoolType === 'Secondary') {
      return s.ranking !== null && s.ranking !== undefined;
    } else {
      return s.score !== null && s.score !== undefined;
    }
  };
  
  const rankedMatch = matches.find(hasRank);
  return rankedMatch || matches[0];
}

// Resolve schools for catchment
async function resolveCatchmentSchools(state, suburb, latitude, longitude) {
  const stateSchools = schoolsDb[state] || [];
  const resolved = [];

  // Try spatial lookup first
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    const schoolTypes = ['Primary', 'Secondary'];
    let foundPrimary = false;
    for (const type of schoolTypes) {
      const matchedSchoolName = findSchoolBySpatialLookup(latitude, longitude, state, type);
      if (matchedSchoolName) {
        const dbSchool = findBestSchoolMatch(stateSchools, matchedSchoolName, type);
        if (dbSchool) {
          if (type === 'Primary') foundPrimary = true;
          let distance = 0.5;
          if (typeof dbSchool.lat === 'number' && typeof dbSchool.lng === 'number') {
            distance = calculateDistance(latitude, longitude, dbSchool.lat, dbSchool.lng);
          }
          resolved.push({
            name: dbSchool.name,
            type: dbSchool.type,
            ranking: dbSchool.ranking,
            score: dbSchool.score,
            assessedYear: dbSchool.assessedYear,
            sector: dbSchool.sector,
            distance: distance
          });
        }
      }
    }

    // If no primary school is found via spatial boundary, fallback to 2 closest primary schools in the suburb
    if (!foundPrimary && suburb) {
      console.log(`[School Lookup] No spatial catchment primary school found. Finding closest primary schools in ${suburb}...`);
      
      const primarySchools = [];
      const seen = new Set();
      for (const school of stateSchools) {
        if (school.type === 'Primary' && school.suburb && school.suburb.toLowerCase() === suburb.toLowerCase()) {
          if (!seen.has(school.name.toLowerCase())) {
            seen.add(school.name.toLowerCase());
            const bestMatch = findBestSchoolMatch(stateSchools, school.name, 'Primary');
            if (bestMatch) {
              primarySchools.push(bestMatch);
            }
          }
        }
      }

      const schoolsWithDistance = [];
      for (const school of primarySchools) {
        let latVal = school.lat;
        let lngVal = school.lng;
        if (typeof latVal !== 'number' || typeof lngVal !== 'number') {
          const query = `${school.name}, ${suburb} ${state}`;
          console.log(`[School Lookup] Geocoding fallback school: "${query}"`);
          const coords = await geocodeAddress(query);
          if (coords) {
            latVal = coords.lat;
            lngVal = coords.lng;
          }
        }

        if (typeof latVal === 'number' && typeof lngVal === 'number') {
          const dist = calculateDistance(latitude, longitude, latVal, lngVal);
          schoolsWithDistance.push({
            name: school.name,
            type: school.type,
            ranking: school.ranking,
            score: school.score,
            assessedYear: school.assessedYear,
            sector: school.sector,
            distance: dist
          });
        }
      }

      // Sort by distance and pick the 2 closest primary schools
      schoolsWithDistance.sort((a, b) => a.distance - b.distance);
      const closestPrimary = schoolsWithDistance.slice(0, 2);
      resolved.push(...closestPrimary);
    }
  }

  resolved.forEach(school => {
    if (school.type === 'Primary') {
      console.log(`[School Lookup] Resolved Primary School: ${school.name}, State Overall Score: ${school.score}, Distance: ${school.distance}km`);
    } else if (school.type === 'Secondary') {
      console.log(`[School Lookup] Resolved Secondary College: ${school.name}, Ranking: ${school.ranking}, Distance: ${school.distance}km`);
    } else {
      console.log(`[School Lookup] Resolved School: ${school.name}, Type: ${school.type}, Score: ${school.score}, Ranking: ${school.ranking}, Distance: ${school.distance}km`);
    }
  });

  return resolved;
}

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// API endpoint for property insights
app.get('/api/insights', async (req, res) => {
  const { street, suburb, state, postcode, q, url } = req.query;
  
  let resolvedAddress = {
    street: street || '',
    suburb: suburb || '',
    state: state || 'VIC',
    postcode: postcode || ''
  };
  
  // Parse query string if generic search query is provided
  if (q && !street) {
    const regex = /(.*?),\s*(.*?)\s+(VIC|NSW|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})/i;
    const match = q.match(regex);
    if (match) {
      resolvedAddress = {
        street: match[1].trim(),
        suburb: match[2].trim(),
        state: match[3].toUpperCase().trim(),
        postcode: match[4].trim()
      };
    }
  }

  // Parse from full realestate URL when provided.
  if (!resolvedAddress.street && url) {
    const parsedFromUrl = parseAddressFromRealEstatePropertyUrl(String(url));
    if (parsedFromUrl) {
      resolvedAddress = parsedFromUrl;
    }
  }
  
  console.log(`[Proxy] Insights request received for:`, resolvedAddress);
  
  if (resolvedAddress.suburb) {
    while (resolvedAddress.suburb.endsWith(',')) {
      resolvedAddress.suburb = resolvedAddress.suburb.slice(0, -1).trim();
    }
  }
  if (resolvedAddress.street) {
    while (resolvedAddress.street.endsWith(',')) {
      resolvedAddress.street = resolvedAddress.street.slice(0, -1).trim();
    }
  }
  
  if (!resolvedAddress.suburb) {
    return res.status(400).json({ error: 'Missing address components' });
  }

  // Fetch land size (strict verified-only policy)
  const landSizeResolution = await resolveLandSizeStrict(resolvedAddress);
  
  res.json({
    address: resolvedAddress,
    landSize: landSizeResolution.status === 'verified' && landSizeResolution.value ? landSizeResolution.value : 'Not available',
    landSizeMeta: landSizeResolution,
    landSizeLogs: Array.isArray(landSizeResolution.attempts) ? landSizeResolution.attempts : []
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Proxy Server] Running on http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  normalizeLandSize,
  getStreetSlug,
  getPropertyProfileUrl,
  getPropertyComAuProfileUrl,
  getAllhomesPropertyUrl,
  extractLandSizeFromHtml,
  createLandSizeAttemptLog,
  fetchLandSizeFromRealEstateProfile,
  fetchLandSizeFromPropertyComAu,
  fetchLandSizeFromAllhomes,
  sleep,
  resolveLandSizeStrict,
  geocodeAddress,
  isPointInPolygon,
  getBoundaryGeoJson,
  findSchoolBySpatialLookup,
  calculateDistance,
  findBestSchoolMatch,
  resolveCatchmentSchools
};
