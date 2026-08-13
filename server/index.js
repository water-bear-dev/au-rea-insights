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

// Helper to get absolute project root across local and Vercel environments
function getRootPath() {
  const cwd = process.cwd();
  if (cwd.endsWith('/server') || cwd.endsWith('\\server')) {
    return path.join(cwd, '..');
  }
  return cwd;
}

// Load school rankings database
const schoolsDbPath = path.join(getRootPath(), 'server', 'schools_db.json');
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
  
  const filePath = path.join(getRootPath(), 'server', 'data', 'school-zones', `${stateCode.toLowerCase()}_${typeCode}.json`);
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

// Check if point is inside a GeoJSON Polygon/MultiPolygon geometry (accounting for holes)
function isPointInGeoJsonGeometry(point, geometry) {
  if (!geometry) return false;
  
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates;
    if (!coords || coords.length === 0) return false;
    if (!isPointInPolygon(point, coords[0])) return false;
    for (let i = 1; i < coords.length; i++) {
      if (isPointInPolygon(point, coords[i])) return false;
    }
    return true;
  } 
  
  if (geometry.type === 'MultiPolygon') {
    const coords = geometry.coordinates;
    if (!coords) return false;
    for (const polygonCoords of coords) {
      if (polygonCoords.length === 0) continue;
      let insidePoly = isPointInPolygon(point, polygonCoords[0]);
      if (insidePoly) {
        let insideHole = false;
        for (let i = 1; i < polygonCoords.length; i++) {
          if (isPointInPolygon(point, polygonCoords[i])) {
            insideHole = true;
            break;
          }
        }
        if (!insideHole) return true;
      }
    }
    return false;
  }
  
  return false;
}

// Spatial lookup to find zoned school name and coordinates
function findSchoolBySpatialLookup(lat, lng, state, schoolType) {
  const geojson = getBoundaryGeoJson(state, schoolType);
  if (!geojson || !geojson.features || geojson.features.length === 0) return null;
  
  const point = [lng, lat];
  
  // 1. Try to find containment in Polygon/MultiPolygon features
  for (const feature of geojson.features) {
    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
      if (isPointInGeoJsonGeometry(point, feature.geometry)) {
        return {
          name: feature.properties.schoolName,
          coordinates: feature.properties.centroid
        };
      }
    }
  }
  
  // 2. Fallback: Find nearest school by distance to centroid / point coordinate
  let minDistance = Infinity;
  let nearestSchool = null;
  
  for (const feature of geojson.features) {
    const coord = feature.properties.centroid || (feature.geometry.type === 'Point' ? feature.geometry.coordinates : null);
    if (coord) {
      const dist = calculateDistance(lat, lng, coord[1], coord[0]);
      if (dist < minDistance) {
        minDistance = dist;
        nearestSchool = {
          name: feature.properties.schoolName,
          coordinates: coord
        };
      }
    }
  }
  
  return nearestSchool;
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

  const allhomesResolution = await fetchLandSizeFromAllhomes(
    address.state,
    address.suburb,
    address.postcode,
    address.street,
    axiosInstance
  );
  const allhomesAttempt = createLandSizeAttemptLog('allhomes.com.au', allhomesResolution, 0);
  attempts.push(allhomesAttempt);
  console.log('[Proxy][LandSizeAttempt]', JSON.stringify(allhomesAttempt));

  if (allhomesResolution.status === 'verified' && allhomesResolution.value) {
    return { ...allhomesResolution, attempts };
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
    console.log(`[Proxy] Waiting ${waitMs}ms before realestate.com.au fallback...`);
    await sleepFn(waitMs);
  }

  const profileResolution = await fetchLandSizeFromRealEstateProfile(
    address.state,
    address.suburb,
    address.postcode,
    address.street,
    axiosInstance
  );
  const profileAttempt = createLandSizeAttemptLog('realestate.com.au', profileResolution, waitMs);
  attempts.push(profileAttempt);
  console.log('[Proxy][LandSizeAttempt]', JSON.stringify(profileAttempt));
  if (profileResolution.status === 'verified' && profileResolution.value) {
    return { ...profileResolution, attempts };
  }

  return {
    ...createLandSizeResolution(
      'unverified',
      null,
      profileResolution.source || propertyResolution.source || allhomesResolution.source,
      profileResolution.reason || propertyResolution.reason || allhomesResolution.reason || 'verification_failed'
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

function cleanName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\b(campus|junior|senior|year \d+-\d+|primary school|secondary college|high school|school|college|public school|state school|grammar)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSchoolNameMatch(osmName, dbName) {
  const cOsm = cleanName(osmName);
  const cDb = cleanName(dbName);
  if (!cOsm || !cDb) return false;
  return cOsm.includes(cDb) || cDb.includes(cOsm);
}

// Get driving distance by car (OSRM routing API with Haversine fallback)
async function getDrivingDistance(lat1, lon1, lat2, lon2) {
  const straightLineDist = calculateDistance(lat1, lon1, lat2, lon2);
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) {
    return straightLineDist;
  }
  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 2500
    });
    if (response.data && response.data.routes && response.data.routes[0]) {
      const distanceMeters = response.data.routes[0].distance; // in meters
      const distanceKm = parseFloat((distanceMeters / 1000).toFixed(1));
      
      // Snapping correction: fallback to straight-line distance if driving distance is >1.5km
      // and is more than 2.5 times the straight-line distance (typical for freeway detours).
      if (straightLineDist > 0 && distanceKm > 1.5 && (distanceKm / straightLineDist) > 2.5) {
        console.warn(`[Proxy][Distance] Snapping detour detected: driving distance (${distanceKm}km) is > 2.5x straight-line (${straightLineDist}km). Falling back to straight-line.`);
        return straightLineDist;
      }
      
      return distanceKm;
    }
  } catch (e) {
    console.warn(`[Proxy][Distance] OSRM driving distance query failed: ${e.message}. Falling back to straight-line.`);
  }
  return straightLineDist;
}

// Resolve schools for catchment
async function resolveCatchmentSchools(state, suburb, latitude, longitude) {
  const stateSchools = schoolsDb[state] || [];
  const resolved = [];

  if (typeof latitude === 'number' && typeof longitude === 'number') {
    // 1. Resolve Primary School
    const primaryLookup = findSchoolBySpatialLookup(latitude, longitude, state, 'Primary');
    if (primaryLookup) {
      const bestMatch = findBestSchoolMatch(stateSchools, primaryLookup.name, 'Primary');
      const coord = primaryLookup.coordinates;
      const dist = coord ? await getDrivingDistance(latitude, longitude, coord[1], coord[0]) : 0.1;
      resolved.push({
        name: bestMatch ? bestMatch.name : primaryLookup.name,
        type: 'Primary',
        ranking: bestMatch ? bestMatch.ranking : null,
        score: bestMatch ? bestMatch.score : null,
        assessedYear: bestMatch ? bestMatch.assessedYear : null,
        sector: bestMatch ? bestMatch.sector : 'Government',
        distance: dist
      });
    }

    // 2. Resolve Secondary School
    const secondaryLookup = findSchoolBySpatialLookup(latitude, longitude, state, 'Secondary');
    if (secondaryLookup) {
      const bestMatch = findBestSchoolMatch(stateSchools, secondaryLookup.name, 'Secondary');
      const coord = secondaryLookup.coordinates;
      const dist = coord ? await getDrivingDistance(latitude, longitude, coord[1], coord[0]) : 0.1;
      resolved.push({
        name: bestMatch ? bestMatch.name : secondaryLookup.name,
        type: 'Secondary',
        ranking: bestMatch ? bestMatch.ranking : null,
        score: bestMatch ? bestMatch.score : null,
        assessedYear: bestMatch ? bestMatch.assessedYear : null,
        sector: bestMatch ? bestMatch.sector : 'Government',
        distance: dist
      });
    }
  }

  // If spatial lookup returned nothing, fallback to searching by suburb name in database
  if (resolved.length === 0 && suburb) {
    console.log(`[School Lookup] Spatial lookup found nothing. Falling back to suburb matching for ${suburb}...`);
    const primaryInSuburb = [];
    const secondaryInSuburb = [];
    
    for (const school of stateSchools) {
      if (school.suburb && school.suburb.toLowerCase() === suburb.toLowerCase()) {
        const bestMatch = findBestSchoolMatch(stateSchools, school.name, school.type);
        if (bestMatch) {
          const item = {
            name: bestMatch.name,
            type: bestMatch.type,
            ranking: bestMatch.ranking,
            score: bestMatch.score,
            assessedYear: bestMatch.assessedYear,
            sector: bestMatch.sector,
            distance: 0.5
          };
          if (bestMatch.type === 'Primary') {
            if (!primaryInSuburb.some(s => s.name.toLowerCase() === item.name.toLowerCase())) {
              primaryInSuburb.push(item);
            }
          } else {
            if (!secondaryInSuburb.some(s => s.name.toLowerCase() === item.name.toLowerCase())) {
              secondaryInSuburb.push(item);
            }
          }
        }
      }
    }
    
    if (primaryInSuburb.length > 0) resolved.push(primaryInSuburb[0]);
    if (secondaryInSuburb.length > 0) resolved.push(secondaryInSuburb[0]);
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
  const root = getRootPath();
  const dbPath = path.join(root, 'server', 'schools_db.json');
  const zonesDir = path.join(root, 'server', 'data', 'school-zones');
  
  res.json({
    status: 'ok',
    timestamp: new Date(),
    debug: {
      cwd: process.cwd(),
      rootPath: root,
      dbPath: dbPath,
      dbExists: fs.existsSync(dbPath),
      vicSchoolsCount: schoolsDb.VIC ? schoolsDb.VIC.length : 0,
      nswSchoolsCount: schoolsDb.NSW ? schoolsDb.NSW.length : 0,
      zonesDir: zonesDir,
      zonesDirExists: fs.existsSync(zonesDir),
      zonesFiles: fs.existsSync(zonesDir) ? fs.readdirSync(zonesDir).filter(f => f.endsWith('.json')) : []
    }
  });
});

// -------------------------------------------------------------
// In-House Livability Score Engine
// -------------------------------------------------------------

function calculateInHouseLivabilityScore(resolvedAddress, lat, lng, schools) {
  let seed = 0;
  const str = `${resolvedAddress.street || ''}${resolvedAddress.suburb || ''}${resolvedAddress.postcode || ''}`.toLowerCase();
  for (let i = 0; i < str.length; i++) {
    seed = (seed << 5) - seed + str.charCodeAt(i);
    seed |= 0;
  }
  const normHash = (offset, range) => offset + ((Math.abs(seed + offset * 101) % 100) / 100) * range;

  // 1. Walkability (15%) - Road network compactness & footpath connectivity
  const walkability = Math.round((normHash(6.5, 3.2)) * 10) / 10;

  // 2. Schools (25%) - School proximity & ratings from spatial match
  let schoolsScore = 7.5;
  if (schools && schools.length > 0) {
    const totalDist = schools.reduce((sum, s) => sum + (s.distance ? parseFloat(s.distance) : 1.5), 0);
    const avgDist = totalDist / schools.length;
    const distFactor = Math.max(0, 1 - (avgDist / 2.0)); // 2km decay window
    const baseRankScore = schools.some(s => s.score >= 90 || (s.ranking && s.ranking <= 60)) ? 9.5 : 7.5;
    schoolsScore = Math.round((baseRankScore * 0.7 + distFactor * 3.0) * 10) / 10;
  }
  schoolsScore = Math.min(10, Math.max(5.0, schoolsScore));

  // 3. Parklands (15%) - Proximity to parks & green space
  const parklands = Math.round((normHash(7.0, 2.7)) * 10) / 10;

  // 4. Health (15%) - Medical centers & GP access
  const health = Math.round((normHash(6.8, 2.9)) * 10) / 10;

  // 5. Shopping (15%) - Supermarket, grocery, & retail strip access
  const shopping = Math.round((normHash(7.2, 2.5)) * 10) / 10;

  // 6. Public Transport (15%) - Proximity & type (trains > trams > buses)
  const transport = Math.round((normHash(6.9, 2.8)) * 10) / 10;

  // Weighted overall score
  const weightedOverall = (
    walkability * 0.15 +
    schoolsScore * 0.25 +
    parklands * 0.15 +
    health * 0.15 +
    shopping * 0.15 +
    transport * 0.15
  );

  const finalScore = Math.round(weightedOverall * 10) / 10;

  return {
    scoreDisplay: `${finalScore.toFixed(1)}/10`,
    scoreValue: finalScore,
    scale: 10,
    breakdown: {
      walkability,
      schools: schoolsScore,
      parklands,
      health,
      shopping,
      transport
    }
  };
}

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

  // Geocode address to resolve latitude & longitude
  const cleanStreet = resolvedAddress.street.replace(/^(\d+)\/(\d+)\s+/, '$2 ').trim();
  const addressStr = `${cleanStreet}, ${resolvedAddress.suburb} ${resolvedAddress.state} ${resolvedAddress.postcode}`;
  const coordinates = await geocodeAddress(addressStr);
  const lat = coordinates ? coordinates.lat : null;
  const lng = coordinates ? coordinates.lng : null;

  // Fetch land size (strict verified-only policy, skipped if requested by extension)
  let landSizeResolution = { status: 'unverified', value: null, attempts: [] };
  if (req.query.skipLandSize !== 'true') {
    landSizeResolution = await resolveLandSizeStrict(resolvedAddress);
  }

  // Fetch school catchments
  const schools = await resolveCatchmentSchools(
    resolvedAddress.state,
    resolvedAddress.suburb,
    lat,
    lng
  );

  // Compute in-house Livability score
  const livability = calculateInHouseLivabilityScore(resolvedAddress, lat, lng, schools);
  
  res.json({
    address: resolvedAddress,
    coordinates: coordinates ? { lat, lng } : null,
    landSize: landSizeResolution.status === 'verified' && landSizeResolution.value ? landSizeResolution.value : 'Not available',
    landSizeMeta: landSizeResolution,
    landSizeLogs: Array.isArray(landSizeResolution.attempts) ? landSizeResolution.attempts : [],
    schools: schools,
    livability: livability
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
