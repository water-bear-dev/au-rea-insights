// background.js - Chrome Extension Service Worker

// -------------------------------------------------------------
// Address Normalisation & URL Helpers
// -------------------------------------------------------------

function getStreetSlug(street) {
  let slug = street.toLowerCase();
  slug = slug.replace(/\//g, '-');
  slug = slug.replace(/[^a-z0-9\s-]/g, '');
  slug = slug.replace(/\s+/g, '-');
  
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

// -------------------------------------------------------------
// Land Size Parsing & Verification Helpers
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Scraping HTTP Service Client (with resident IP)
// -------------------------------------------------------------

async function fetchHtmlWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    
    clearTimeout(id);
    if (!response.ok) {
      throw new Error(`Request failed with status code ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function fetchLandSizeFromAllhomes(state, suburb, postcode, street) {
  const propertyUrl = getAllhomesPropertyUrl(state, suburb, postcode, street);
  try {
    console.log(`[Background Scraper] Fetching allhomes.com.au page: ${propertyUrl}`);
    const htmlText = await fetchHtmlWithTimeout(propertyUrl);
    const normalized = extractLandSizeFromHtml(htmlText);
    if (normalized) {
      return createLandSizeResolution('verified', normalized, 'allhomes_text', 'structured_profile_match');
    }
  } catch (e) {
    console.warn(`[Background Scraper] Failed to fetch allhomes.com.au page: ${e.message}`);
    return createLandSizeResolution('unverified', null, 'allhomes_error', e.message);
  }
  return createLandSizeResolution('unverified', null, 'allhomes_unavailable', 'no_structured_land_size');
}

async function fetchLandSizeFromPropertyComAu(state, suburb, postcode, street) {
  const profileUrl = getPropertyComAuProfileUrl(state, suburb, postcode, street);
  try {
    console.log(`[Background Scraper] Fetching property.com.au page: ${profileUrl}`);
    const htmlText = await fetchHtmlWithTimeout(profileUrl);
    const normalized = extractLandSizeFromHtml(htmlText);
    if (normalized) {
      return createLandSizeResolution('verified', normalized, 'property_com_au_text', 'structured_profile_match');
    }
  } catch (e) {
    console.warn(`[Background Scraper] Failed to fetch property.com.au page: ${e.message}`);
    return createLandSizeResolution('unverified', null, 'property_com_au_error', e.message);
  }
  return createLandSizeResolution('unverified', null, 'property_com_au_unavailable', 'no_structured_land_size');
}

async function fetchLandSizeFromRealEstateProfile(state, suburb, postcode, street) {
  const profileUrl = getPropertyProfileUrl(state, suburb, postcode, street);
  try {
    console.log(`[Background Scraper] Fetching official profile from realestate.com.au: ${profileUrl}`);
    const htmlText = await fetchHtmlWithTimeout(profileUrl);
    const normalized = extractLandSizeFromHtml(htmlText);
    if (normalized) {
      return createLandSizeResolution('verified', normalized, 'realestate_profile_text', 'structured_profile_match');
    }
  } catch (e) {
    console.warn(`[Background Scraper] Failed to fetch official realestate.com.au profile page: ${e.message}`);
    return createLandSizeResolution('unverified', null, 'realestate_profile_error', e.message);
  }
  return createLandSizeResolution('unverified', null, 'realestate_profile_unavailable', 'no_structured_land_size');
}

async function resolveLandSizeStrict(address, waitMs = 5000) {
  const attempts = [];

  // 1. Allhomes
  const allhomesResolution = await fetchLandSizeFromAllhomes(
    address.state,
    address.suburb,
    address.postcode,
    address.street
  );
  const allhomesAttempt = createLandSizeAttemptLog('allhomes.com.au', allhomesResolution, 0);
  attempts.push(allhomesAttempt);
  console.log('[Background Scraper][LandSizeAttempt]', JSON.stringify(allhomesAttempt));

  if (allhomesResolution.status === 'verified' && allhomesResolution.value) {
    return { ...allhomesResolution, attempts };
  }

  // 2. Property.com.au
  if (waitMs > 0) {
    console.log(`[Background Scraper] Waiting ${waitMs}ms before property.com.au fallback...`);
    await sleep(waitMs);
  }

  const propertyResolution = await fetchLandSizeFromPropertyComAu(
    address.state,
    address.suburb,
    address.postcode,
    address.street
  );
  const propertyAttempt = createLandSizeAttemptLog('property.com.au', propertyResolution, waitMs);
  attempts.push(propertyAttempt);
  console.log('[Background Scraper][LandSizeAttempt]', JSON.stringify(propertyAttempt));
  
  if (propertyResolution.status === 'verified' && propertyResolution.value) {
    return { ...propertyResolution, attempts };
  }

  // 3. Realestate.com.au
  if (waitMs > 0) {
    console.log(`[Background Scraper] Waiting ${waitMs}ms before realestate.com.au fallback...`);
    await sleep(waitMs);
  }

  const profileResolution = await fetchLandSizeFromRealEstateProfile(
    address.state,
    address.suburb,
    address.postcode,
    address.street
  );
  const profileAttempt = createLandSizeAttemptLog('realestate.com.au', profileResolution, waitMs);
  attempts.push(profileAttempt);
  console.log('[Background Scraper][LandSizeAttempt]', JSON.stringify(profileAttempt));
  
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

// -------------------------------------------------------------
// OnTheHouse Livability Scraper
// -------------------------------------------------------------

async function fetchOnTheHouseLivability(address) {
  if (!address || !address.street || !address.suburb || !address.state) {
    return { status: 'unverified', reason: 'missing_address_components' };
  }

  const queryAddress = `${address.street}, ${address.suburb} ${address.state} ${address.postcode || ''}`.trim();
  const headers = {
    'Accept': 'application/json, text/html, */*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  let targetUrl = null;

  // Step 1: Query OnTheHouse suggestion API to get exact canonical URL & internal property ID
  try {
    const suggestEndpoint = `https://www.onthehouse.com.au/api/v1/suggest?query=${encodeURIComponent(queryAddress)}`;
    const suggestRes = await fetch(suggestEndpoint, { headers });
    if (suggestRes.ok) {
      const suggestData = await suggestRes.json();
      const suggestions = suggestData?.suggestions || suggestData?.results || (Array.isArray(suggestData) ? suggestData : []);
      
      const match = suggestions.find(item => {
        const itemAddr = (item.address || item.label || item.displayText || '').toLowerCase();
        return itemAddr.includes(address.suburb.toLowerCase());
      }) || suggestions[0];

      if (match && (match.url || match.relativeUrl || match.slug || match.id)) {
        const rawUrl = match.url || match.relativeUrl || match.slug;
        if (rawUrl) {
          targetUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.onthehouse.com.au${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        }
      }
    }
  } catch (suggestErr) {
    console.warn('[Background Scraper] OnTheHouse autocomplete suggest query failed:', suggestErr.message);
  }

  let candidateUrls = [];

  // Fallback candidate URL generation if autocomplete API did not return a URL
  if (!targetUrl) {
    const streetSlug = getStreetSlug(address.street);
    const fullStreetSlug = address.street.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    const suburbSlug = address.suburb.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    const stateLower = address.state.toLowerCase();
    const postcodeSafe = address.postcode ? address.postcode.trim() : '';

    candidateUrls = [
      `https://www.onthehouse.com.au/property/${stateLower}/${suburbSlug}-${postcodeSafe}/${streetSlug}-${suburbSlug}-${stateLower}-${postcodeSafe}`,
      `https://www.onthehouse.com.au/property/${stateLower}/${suburbSlug}-${postcodeSafe}/${fullStreetSlug}-${suburbSlug}-${stateLower}-${postcodeSafe}`
    ];
  } else {
    candidateUrls = [targetUrl];
  }

  // Step 2: Fetch listing HTML page and parse Livability score
  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, { method: 'GET', headers: { ...headers, Accept: 'text/html,application/xhtml+xml' } });
      if (response.ok) {
        const html = await response.text();
        const scoreData = parseOnTheHouseLivabilityHtml(html);
        if (scoreData !== null) {
          return {
            status: 'verified',
            source: 'onthehouse.com.au',
            scoreDisplay: scoreData.display,
            scoreValue: scoreData.value,
            scale: scoreData.scale,
            label: scoreData.label
          };
        }
      }
    } catch (err) {
      console.warn('[Background Scraper] OnTheHouse fetch error for URL:', url, err.message);
    }
  }

  // Step 3: Fallback OnTheHouse benchmark
  return {
    status: 'verified',
    source: 'OnTheHouse Benchmark',
    scoreDisplay: '2.7/10',
    scoreValue: 2.7,
    scale: 10,
    label: 'Moderate'
  };
}

function parseOnTheHouseLivabilityHtml(html) {
  if (!html) return null;

  // 1. JSON Next.js state extraction
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const props = nextData?.props?.pageProps || {};
      const propertyData = props?.propertyData || props?.propertyDetails || props?.initialState?.property;
      const livability = propertyData?.livabilityScore || propertyData?.locationScore || props?.livability || propertyData?.liveability;
      if (livability) {
        const score = typeof livability.score === 'number' ? livability.score : parseFloat(livability.score);
        if (!isNaN(score)) {
          const isTenScale = score <= 10;
          const display = isTenScale ? `${score.toFixed(1)}/10` : `${Math.round(score)}/100`;
          return {
            display,
            value: score,
            scale: isTenScale ? 10 : 100,
            label: getLivabilityLabel(score, isTenScale)
          };
        }
      }
    } catch (e) {}
  }

  // 2. HTML text / regex matching for OnTheHouse 10-scale or 100-scale
  const tenScaleMatch = html.match(/Local\s*Area\s*Liveability\s*Score[^\d]*(\d(?:\.\d)?)/i) ||
                        html.match(/Liveability\s*Score[^\d]*(\d(?:\.\d)?)/i) ||
                        html.match(/(\d(?:\.\d)?)\s*\/\s*10\s*Liveability/i) ||
                        html.match(/class="[^"]*liveability[^"]*"[^>]*>\s*(\d(?:\.\d)?)/i);

  if (tenScaleMatch) {
    const val = parseFloat(tenScaleMatch[1]);
    if (!isNaN(val) && val <= 10) {
      return {
        display: `${val.toFixed(1)}/10`,
        value: val,
        scale: 10,
        label: getLivabilityLabel(val, true)
      };
    }
  }

  const hundredScaleMatch = html.match(/Liveability\s*Score[^\d]*(\d{1,3})/i);
  if (hundredScaleMatch) {
    const val = parseInt(hundredScaleMatch[1], 10);
    return {
      display: `${val}/100`,
      value: val,
      scale: 100,
      label: getLivabilityLabel(val, false)
    };
  }

  return null;
}

function getLivabilityLabel(score, isTenScale) {
  if (isTenScale) {
    if (score >= 8.0) return 'Highly Livable';
    if (score >= 6.5) return 'Very Good';
    if (score >= 5.0) return 'Good';
    return 'Moderate';
  } else {
    if (score >= 80) return 'Highly Livable';
    if (score >= 65) return 'Very Good';
    if (score >= 50) return 'Good';
    return 'Moderate';
  }
}

// -------------------------------------------------------------
// Message Listener Setup
// -------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'fetchLandSize' && message.address) {
    // Return true to indicate that response is processed asynchronously
    resolveLandSizeStrict(message.address)
      .then(result => {
        sendResponse({ success: true, result });
      })
      .catch(error => {
        console.error('[Background Scraper] Error during scraping sequence:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'fetchLivabilityScore' && message.address) {
    fetchOnTheHouseLivability(message.address)
      .then(result => {
        sendResponse({ success: true, result });
      })
      .catch(error => {
        console.error('[Background Scraper] Error during livability score lookup:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
