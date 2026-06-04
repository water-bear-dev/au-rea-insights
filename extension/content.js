// Configuration
let geminiApiKey = '';
const CACHE_PREFIX = 'insights_cache_v2_';
const LEGACY_CACHE_PREFIX = 'insights_cache_';

// Retrieve settings from storage
chrome.storage.local.get(['showLandSize', 'showSchools', 'geminiApiKey'], (result) => {
  if (result.geminiApiKey) geminiApiKey = result.geminiApiKey;
  
  const showLandSize = result.showLandSize !== false;
  const showSchools = result.showSchools !== false;
  
  if (showLandSize || showSchools) {
    init(showLandSize, showSchools);
  }
});

function init(showLandSize, showSchools) {
  let lastUrl = location.href;
  
  // Initial check
  checkPage(showLandSize, showSchools);
  
  // URL change observer (due to Single Page App transitions on REA/Domain)
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Wait briefly for new content to render
      setTimeout(() => checkPage(showLandSize, showSchools), 1000);
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
}

function checkPage(showLandSize, showSchools) {
  const isREA = document.querySelector('.property-info-address, h1.property-info-address, [data-testid="listing-address"]');
  const isDomain = document.querySelector('h1[data-testid="address-wrapper"], h1.css-72ndy');
  const isMock = window.location.pathname.includes('mock_pages.html');
  
  if (!isREA && !isDomain && !isMock) return;
  
  const addressInfo = getAddress();
  if (!addressInfo) return;
  
  console.log('[AU Insights] Address detected:', addressInfo);
  
  // Check if we already injected our content
  if (document.getElementById('au-insights-schools-section') || document.getElementById('au-insights-api-warning')) return;

  fetchPropertyInsights(addressInfo, showLandSize, showSchools);
}

function injectApiKeyWarning() {
  const container = document.createElement('div');
  container.id = 'au-insights-api-warning';
  container.style.marginTop = '16px';
  container.style.marginBottom = '16px';
  container.style.padding = '12px 16px';
  container.style.backgroundColor = '#fef2f2';
  container.style.border = '1px solid #fee2e2';
  container.style.borderRadius = '8px';
  container.style.color = '#991b1b';
  container.style.fontFamily = 'sans-serif';
  container.style.fontSize = '13px';
  container.style.fontWeight = '500';
  container.innerHTML = '🔑 Please configure your Gemini API Key in the extension popup to view land size & school catchments.';
  
  const featureGroup = findMainFeaturesContainer();
  if (featureGroup) {
    featureGroup.parentNode.insertBefore(container, featureGroup.nextSibling);
  }
}

function getMainListingDetailsContainer() {
  const col = document.querySelector('[data-testid="listing-details-col-1"], .property-info__content, .property-info-element, .css-1h998q, .css-b1s6i8, [data-testid="listing-details"], main');
  return col || document.body;
}

function findMainFeaturesContainer() {
  const mainCol = getMainListingDetailsContainer();
  
  // Exclude actual header / nav / sticky / breadcrumb wrappers precisely
  const isIgnored = (el) => {
    return el.closest('header') || 
           el.closest('nav') ||
           el.closest('.sticky-header') ||
           el.closest('.property-info-sticky') ||
           el.closest('[data-testid="sticky-header"]') ||
           el.closest('.breadcrumbs') ||
           el.closest('[class*="breadcrumbs"]') ||
           el.closest('.sub-header-container') ||
           el.closest('.top-bar');
  };

  // 1. Target specific main details columns first
  const mainREAGroup = mainCol.querySelector('.property-info-element .property-info__feature-group, .property-info__content .property-info__feature-group, .main-content .property-info__feature-group');
  if (mainREAGroup && !isIgnored(mainREAGroup)) {
    return mainREAGroup;
  }
  
  const mainDomainGroup = mainCol.querySelector('.css-1h998q [data-testid="property-features"], .css-b1s6i8 [data-testid="property-features"]');
  if (mainDomainGroup && !isIgnored(mainDomainGroup)) {
    return mainDomainGroup;
  }
  
  // 2. Generic lookup excluding headers, navs, stickies, sub-headers, and breadcrumbs
  const featureGroups = mainCol.querySelectorAll('.property-info__feature-group, [data-testid="property-features"]');
  for (const group of featureGroups) {
    if (isIgnored(group)) {
      continue;
    }
    return group; // return the first clean one
  }
  
  return null;
}

function getAddress() {
  const mainCol = getMainListingDetailsContainer();
  let addressText = '';
  
  const reaEl = mainCol.querySelector('.property-info-address, h1.property-info-address, [data-testid="listing-address"]');
  const domainEl = mainCol.querySelector('h1[data-testid="address-wrapper"], h1.css-72ndy');
  
  if (reaEl) {
    addressText = reaEl.textContent.trim();
  } else if (domainEl) {
    addressText = domainEl.textContent.trim();
  } else {
    // Fallback: search main h1
    const h1 = mainCol.querySelector('h1');
    if (h1 && (h1.textContent.includes('VIC') || h1.textContent.includes('NSW') || h1.textContent.includes('QLD') || h1.textContent.includes('WA') || h1.textContent.includes('SA') || h1.textContent.includes('TAS') || h1.textContent.includes('ACT') || h1.textContent.includes('NT'))) {
      addressText = h1.textContent.trim();
    }
  }
  
  if (!addressText) return null;
  
  // Normalise spaces
  addressText = addressText.replace(/\s+/g, ' ');
  
  // Clean address
  const regex = /(.*?),\s*(.*?)\s+(VIC|NSW|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})/i;
  const match = addressText.match(regex);
  
  if (match) {
    let street = match[1].trim();
    let suburb = match[2].trim();
    
    // Clean trailing commas
    while (suburb.endsWith(',')) suburb = suburb.slice(0, -1).trim();
    while (street.endsWith(',')) street = street.slice(0, -1).trim();
    
    return {
      full: addressText,
      street: street,
      suburb: suburb,
      state: match[3].toUpperCase().trim(),
      postcode: match[4].trim()
    };
  }
  
  // Loose pattern: no comma
  const regexLoose = /(.*?)\s+(VIC|NSW|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})/i;
  const matchLoose = addressText.match(regexLoose);
  
  if (matchLoose) {
    const parts = matchLoose[1].split(' ');
    const postcode = matchLoose[3];
    const state = matchLoose[2].toUpperCase();
    
    let street = parts.slice(0, -2).join(' ').trim();
    let suburb = parts.slice(-2).join(' ').trim();
    
    while (suburb.endsWith(',')) suburb = suburb.slice(0, -1).trim();
    while (street.endsWith(',')) street = street.slice(0, -1).trim();
    
    return {
      full: addressText,
      street: street,
      suburb: suburb,
      state: state,
      postcode: postcode
    };
  }
  
  return {
    full: addressText,
    raw: true
  };
}

function getPropertyProfileUrl(addressInfo) {
  let street = addressInfo.street.toLowerCase();
  const suburb = addressInfo.suburb.toLowerCase().replace(/\s+/g, '-');
  const state = addressInfo.state.toLowerCase();
  const postcode = addressInfo.postcode;
  
  // Clean street suffix abbreviations
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
  
  // Format unit numbers
  // Example: 2/609 High Street Road -> unit-2-609-high-street-rd
  let unitPrefix = '';
  const unitRegex = /^(\d+)\/(\d+)\s+(.*)/i;
  const unitMatch = street.match(unitRegex);
  
  if (unitMatch) {
    unitPrefix = `unit-${unitMatch[1]}-${unitMatch[2]}-`;
    street = unitMatch[3];
  }
  
  // Apply street suffix replacements
  let streetSlug = street.replace(/[^a-z0-9\s-]/g, '').trim();
  for (const [full, short] of Object.entries(streetReplacements)) {
    const regex = new RegExp(`\\b${full}$`, 'i');
    if (regex.test(streetSlug)) {
      streetSlug = streetSlug.replace(regex, short);
      break;
    }
  }
  
  streetSlug = streetSlug.replace(/\s+/g, '-');
  
  return `https://www.realestate.com.au/property/${unitPrefix}${streetSlug}-${suburb}-${state}-${postcode}/`;
}

async function fetchLandSizeFromPropertyPage(profileUrl) {
  try {
    console.log('[AU Insights] Fetching land size from property profile:', profileUrl);
    const response = await fetch(profileUrl);
    if (!response.ok) {
      console.warn('[AU Insights] Failed to fetch property profile page:', response.status);
      return null;
    }
    const htmlText = await response.text();
    
    // 1. Text match (e.g. Land size: 280 m²)
    const textRegex = /(?:land\s+size|land\s+area|block\s+size)(?:\s+of)?[\s:]*([\d,]+(?:\.\d+)?\s*(?:m²|m2|sqm|sq\.?\s*m|square\s+meters?|sq\s*meters?))/i;
    const textMatch = htmlText.match(textRegex);
    if (textMatch) {
      const size = textMatch[1].trim();
      console.log('[AU Insights] Successfully resolved land size via text selector:', size);
      return size;
    }
    
    // 2. JSON property match (e.g. "landSize":{"value":280,"unit":"sqm"})
    const jsonRegex = /"landSize"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/i;
    const jsonMatch = htmlText.match(jsonRegex);
    if (jsonMatch) {
      const size = `${Math.round(parseFloat(jsonMatch[1]))}m²`;
      console.log('[AU Insights] Successfully resolved land size via JSON selector:', size);
      return size;
    }
    
    console.log('[AU Insights] Land size not found in profile page HTML.');
  } catch (error) {
    console.error('[AU Insights] Error scraping property page:', error);
  }
  return null;
}

async function fetchPropertyInsights(addressInfo, showLandSize, showSchools) {
  const addressKey = addressInfo.full || `${addressInfo.street}, ${addressInfo.suburb} ${addressInfo.state} ${addressInfo.postcode}`;
  const normalizedAddressKey = addressKey.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const cacheKey = CACHE_PREFIX + normalizedAddressKey;
  const legacyCacheKey = LEGACY_CACHE_PREFIX + normalizedAddressKey;
  
  // Check Chrome Storage Local Cache
  chrome.storage.local.get([cacheKey, legacyCacheKey], async (cacheResult) => {
    // Remove stale cache entries from previous schema version.
    if (cacheResult[legacyCacheKey]) {
      chrome.storage.local.remove([legacyCacheKey]);
    }

    if (cacheResult[cacheKey]) {
      console.log('[AU Insights] Cache hit for:', addressKey);
      const data = cacheResult[cacheKey];
      injectInsightsPanel(data.landSize, data.schools, showLandSize, showSchools);
      return;
    }
    
    // Cache miss -> show spinner loading state
    console.log('[AU Insights] Cache miss. Initiating fetch...');
    injectLoadingIndicator();
    
    try {
      let data = { landSize: 'Not available', schools: [], landSizeMeta: { status: 'unverified', source: 'none', reason: 'default' } };
      
      if (geminiApiKey) {
        console.log('[AU Insights] Fetching insights via Gemini API...');
        const promptText = `Analyze the following Australian property address: "${addressKey}". 
Find:
1. The property's land size. For houses/townhouses/subdivisions (even with unit numbers like 2/609), find the block size, lot size, or building size (e.g., "156m²" or "250m²"). Respond only with the number + m² (e.g. "156m²"). If it is a subdivided lot or townhouse, make sure to return the land size share of the individual dwelling, not the parent lot size. If completely unavailable, write "Not available".
2. The primary and secondary school catchments (school zones) assigned to this property address. For each school, find:
   - Full School Name
   - Type ("Primary" or "Secondary")
   - The latest BetterEducation state rank (e.g. 35, 12, 1) and rating/score if known.
   - The latest assessment year (e.g. 2024).
   - Sector ("Government", "Independent" or "Catholic").
   - Approximate distance from the property (e.g., 0.8).

Provide the output strictly in JSON format matching this schema:
{
  "landSize": "156m²",
  "landSizeMeta": {
    "status": "unverified",
    "source": "gemini_model",
    "reason": "model_not_authoritative"
  },
  "schools": [
    {
      "name": "Mount Waverley Secondary College",
      "type": "Secondary",
      "ranking": 35,
      "score": 96,
      "assessedYear": 2024,
      "sector": "Government",
      "distance": 1.5
    }
  ]
}`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: promptText
              }]
            }],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        });
        
        if (!response.ok) throw new Error('Gemini API fetch failed');
        
        const result = await response.json();
        const textResponse = result.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(textResponse);
        
        data.schools = parsed.schools || [];

        // Strict mode: never trust Gemini for numeric land size.
        // Numeric land size is only displayed if independently verified from an authoritative profile field.
        const profileUrl = getPropertyProfileUrl(addressInfo);
        const verifiedLandSize = await fetchLandSizeFromPropertyPage(profileUrl);
        if (verifiedLandSize) {
          data.landSize = verifiedLandSize;
          data.landSizeMeta = { status: 'verified', source: 'realestate_profile_client', reason: 'structured_profile_match' };
        } else {
          data.landSize = 'Not available';
          data.landSizeMeta = { status: 'unverified', source: 'realestate_profile_client', reason: 'no_structured_land_size' };
        }
      } else {
        console.log('[AU Insights] Gemini API key not found. Trying local proxy on port 3000...');
        const localCheck = await fetch('http://localhost:3000/health', { method: 'GET' });
        if (!localCheck.ok) throw new Error('Local proxy not healthy');
        
        const params = new URLSearchParams();
        params.append('street', addressInfo.street);
        params.append('suburb', addressInfo.suburb);
        params.append('state', addressInfo.state);
        params.append('postcode', addressInfo.postcode);
        params.append('url', window.location.href);
        
        const response = await fetch(`http://localhost:3000/api/insights?${params.toString()}`);
        if (!response.ok) throw new Error('Local insights fetch failed');
        const localData = await response.json();
        
        data.schools = localData.schools || [];
        data.landSizeMeta = localData.landSizeMeta || { status: 'unverified', source: 'proxy_unknown', reason: 'missing_meta' };
        data.landSize = data.landSizeMeta.status === 'verified' ? (localData.landSize || 'Not available') : 'Not available';
        console.log('[AU Insights] Successfully resolved insights from local proxy.');
      }
      
      // Save successfully resolved details to cache
      if (data) {
        const cacheData = {};
        cacheData[cacheKey] = data;
        chrome.storage.local.set(cacheData);
        
        removeLoadingIndicator();
        injectInsightsPanel(data.landSize, data.schools, showLandSize, showSchools);
      }
    } catch (error) {
      console.error('[AU Insights] Error resolving insights:', error);
      removeLoadingIndicator();
      if (!geminiApiKey) {
        injectApiKeyWarning();
      }
    }
  });
}

function injectLoadingIndicator() {
  if (document.getElementById('au-insights-loading-section')) return;

  const container = document.createElement('div');
  container.className = 'au-insights-schools-container';
  container.id = 'au-insights-loading-section';
  container.style.padding = '12px 16px';
  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: #475569; font-family: sans-serif;">
      <span class="au-insights-spinner"></span>
      <span>Resolving property catchment & insights...</span>
    </div>
  `;
  
  const featureGroup = findMainFeaturesContainer();
  if (featureGroup) {
    const parent = featureGroup.parentElement;
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.display === 'flex' && parentStyle.flexDirection === 'row') {
      parent.parentNode.insertBefore(container, parent.nextSibling);
    } else {
      featureGroup.parentNode.insertBefore(container, featureGroup.nextSibling);
    }
  }
}

function removeLoadingIndicator() {
  const loader = document.getElementById('au-insights-loading-section');
  if (loader) loader.remove();
}

function injectInsightsPanel(landSize, schools, showLandSize, showSchools) {
  // Prevent duplicate injection
  if (document.getElementById('au-insights-schools-section')) return;

  const container = document.createElement('div');
  container.className = 'au-insights-schools-container';
  container.id = 'au-insights-schools-section';

  let landSizeHtml = '';
  if (showLandSize && landSize) {
    const sizeDisplay = landSize.toLowerCase().includes('not') ? 'Not available' : landSize;
    landSizeHtml = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px dashed #e2e8f0; font-family: sans-serif;">
        <span style="color: #64748b; font-weight: 500; font-size: 13px; display: flex; align-items: center; gap: 6px;">📐 Estimated Land Size</span>
        <span style="color: #1e293b; font-weight: 600; font-size: 14px;">${sizeDisplay}</span>
      </div>
    `;
  }

  let schoolsHtml = '';
  if (showSchools && schools && schools.length > 0) {
    let rowsHtml = '';
    schools.forEach(school => {
      let ratingBadge = '';
      
      // Primary schools show overall BetterEducation score (e.g. 98/100), secondary shows State rank (e.g. Rank #35)
      if (school.type && school.type.toLowerCase() === 'primary') {
        ratingBadge = school.score 
          ? `<div class="au-insights-rank-badge" style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); box-shadow: 0 2px 8px rgba(37, 99, 235, 0.15);">Score: ${school.score}</div>`
          : `<div class="au-insights-rank-none">No Score</div>`;
      } else {
        ratingBadge = school.ranking 
          ? `<div class="au-insights-rank-badge">Rank #${school.ranking}</div>`
          : `<div class="au-insights-rank-none">Unranked</div>`;
      }
        
      const assessedYear = school.assessedYear ? `Assessed ${school.assessedYear}` : 'No rating data';
      const distanceText = school.distance ? ` • ${school.distance}km` : '';
      
      rowsHtml += `
        <div class="au-insights-school-row">
          <div class="au-insights-school-info">
            <div class="au-insights-school-name">${school.name}</div>
            <div class="au-insights-school-meta">
              <span class="au-insights-school-type">${school.type}</span>
              <span>${assessedYear}${distanceText}</span>
            </div>
          </div>
          <div class="au-insights-rating-block">
            ${ratingBadge}
          </div>
        </div>
      `;
    });
    
    schoolsHtml = `
      <div class="au-insights-header" style="border-top: ${landSizeHtml ? 'none' : '1px solid transparent'}; border-bottom: none; margin-top: ${landSizeHtml ? '8px' : '0'}; padding-bottom: 0;">
        <h3>School Catchment</h3>
      </div>
      ${rowsHtml}
    `;
  }

  container.innerHTML = `
    <div class="au-insights-header" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e2e8f0; padding: 12px 16px;">
      <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">Property Insights</h3>
      <span class="badge" style="background-color: #2563eb; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">AI Powered</span>
    </div>
    ${landSizeHtml}
    ${schoolsHtml}
  `;

  // Find injection target
  const featureGroup = findMainFeaturesContainer();
  if (featureGroup) {
    const parent = featureGroup.parentElement;
    const parentStyle = window.getComputedStyle(parent);
    
    // If the parent of the features group is a flex row, insert after the parent to avoid squeeze/overlap
    if (parentStyle.display === 'flex' && parentStyle.flexDirection === 'row') {
      parent.parentNode.insertBefore(container, parent.nextSibling);
    } else {
      featureGroup.parentNode.insertBefore(container, featureGroup.nextSibling);
    }
  } else {
    const addr = document.querySelector('.property-info-address, h1.property-info-address, h1[data-testid="address-wrapper"]');
    if (addr) addr.parentNode.insertBefore(container, addr.nextSibling);
  }
}
