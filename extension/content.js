// Configuration
const CACHE_PREFIX = 'insights_cache_v2_';
const LEGACY_CACHE_PREFIX = 'insights_cache_';
const INSIGHTS_DEBOUNCE_MS = 800;
const inflightRequests = new Set();
const lastFetchAtByKey = new Map();

// Retrieve settings from storage
chrome.storage.local.get(['showLandSize'], (result) => {
  const showLandSize = result.showLandSize !== false;
  
  if (showLandSize) {
    init(showLandSize);
  }
});

function init(showLandSize) {
  let lastUrl = location.href;
  
  // Initial check
  checkPage(showLandSize);
  
  // URL change observer (due to Single Page App transitions on REA/Domain)
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Wait briefly for new content to render
      setTimeout(() => checkPage(showLandSize), 1000);
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
}

function checkPage(showLandSize) {
  const isREA = document.querySelector('.property-info-address, h1.property-info-address, [data-testid="listing-address"]');
  const isDomain = document.querySelector('h1[data-testid="address-wrapper"], h1.css-72ndy');
  const isMock = window.location.pathname.includes('mock_pages.html');
  
  if (!isREA && !isDomain && !isMock) return;
  
  const addressInfo = getAddress();
  if (!addressInfo) return;
  
  console.log('[AU Insights] Address detected:', addressInfo);
  
  // Check if we already injected our content
  if (document.getElementById('au-insights-schools-section') || document.getElementById('au-insights-proxy-warning')) return;

  fetchPropertyInsights(addressInfo, showLandSize);
}

function injectProxyWarning() {
  const container = document.createElement('div');
  container.id = 'au-insights-proxy-warning';
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
  container.innerHTML = '⚠️ Local proxy unavailable. Start the proxy server to load insights: `npm --prefix server run dev`.';
  
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

async function fetchPropertyInsights(addressInfo, showLandSize) {
  const addressKey = addressInfo.full || `${addressInfo.street}, ${addressInfo.suburb} ${addressInfo.state} ${addressInfo.postcode}`;
  const normalizedAddressKey = addressKey.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const cacheKey = CACHE_PREFIX + normalizedAddressKey;
  const legacyCacheKey = LEGACY_CACHE_PREFIX + normalizedAddressKey;
  const now = Date.now();

  if (inflightRequests.has(cacheKey)) {
    console.log('[AU Insights] Request already in-flight for:', addressKey);
    return;
  }
  if ((lastFetchAtByKey.get(cacheKey) || 0) + INSIGHTS_DEBOUNCE_MS > now) {
    console.log('[AU Insights] Debounced duplicate fetch for:', addressKey);
    return;
  }
  lastFetchAtByKey.set(cacheKey, now);
  
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
    inflightRequests.add(cacheKey);
    injectLoadingIndicator();
    
    try {
      let data = { landSize: 'Not available', landSizeMeta: { status: 'unverified', source: 'none', reason: 'default' } };
      console.log('[AU Insights] Resolving insights via local proxy...');
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
      
      data.landSizeMeta = localData.landSizeMeta || { status: 'unverified', source: 'proxy_unknown', reason: 'missing_meta' };
      data.landSize = data.landSizeMeta.status === 'verified' ? (localData.landSize || 'Not available') : 'Not available';
      if (Array.isArray(localData.landSizeLogs)) {
        console.group('[AU Insights] Land size resolution attempts');
        localData.landSizeLogs.forEach((attempt, index) => {
          console.log(
            `#${index + 1} ${attempt.step} | status=${attempt.status} | landSize=${attempt.landSize || 'Not available'} | source=${attempt.source} | reason=${attempt.reason} | waitBeforeMs=${attempt.waitBeforeMs || 0}`
          );
        });
        console.groupEnd();
      }
      console.log('[AU Insights] Successfully resolved insights from local proxy.');
      
      // Save successfully resolved details to cache
      if (data) {
        const cacheData = {};
        cacheData[cacheKey] = data;
        chrome.storage.local.set(cacheData);
        
        removeLoadingIndicator();
        injectInsightsPanel(data.landSize, showLandSize);
      }
    } catch (error) {
      console.error('[AU Insights] Error resolving insights:', error);
      removeLoadingIndicator();
      injectProxyWarning();
    } finally {
      inflightRequests.delete(cacheKey);
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
    <div class="au-insights-loading-shell">
      <div class="au-insights-loading-row">
        <svg class="au-insights-spinner" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; flex-shrink: 0;">
          <circle cx="12" cy="12" r="10" fill="none" stroke="#cbd5e1" stroke-width="3"/>
          <path d="M 12 2 A 10 10 0 0 1 22 12" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
          </path>
        </svg>
        <span class="au-insights-loading-text">
          Retrieving property insights<span class="au-insights-loading-dots" aria-hidden="true"></span>
        </span>
      </div>
      <div class="au-insights-loading-bar">
        <div class="au-insights-loading-bar-fill"></div>
      </div>
      <div class="au-insights-loading-subtext">Checking multiple data sources. This can take 10-20 seconds.</div>
      <div class="au-insights-loading-elapsed">Elapsed: <span id="au-insights-loading-seconds">0</span>s</div>
    </div>
  `;

  const secondsEl = container.querySelector('#au-insights-loading-seconds');
  let elapsed = 0;
  const intervalId = setInterval(() => {
    elapsed += 1;
    if (secondsEl) {
      secondsEl.textContent = String(elapsed);
    }
  }, 1000);
  container.dataset.timerId = String(intervalId);
  
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
  if (loader) {
    const timerId = Number(loader.dataset.timerId);
    if (Number.isFinite(timerId)) {
      clearInterval(timerId);
    }
    loader.remove();
  }
}

function injectInsightsPanel(landSize, showLandSize) {
  // Prevent duplicate injection
  if (document.getElementById('au-insights-schools-section')) return;

  const container = document.createElement('div');
  container.className = 'au-insights-schools-container';
  container.id = 'au-insights-schools-section';

  let landSizeHtml = '';
  if (showLandSize && landSize) {
    const sizeDisplay = landSize.toLowerCase().includes('not') ? 'Not available' : landSize;
    landSizeHtml = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 4px; border-bottom: 1px dashed #e2e8f0; font-family: sans-serif;">
        <span style="color: #64748b; font-weight: 500; font-size: 13px; display: flex; align-items: center; gap: 6px;">📐 Estimated Land Size</span>
        <span style="color: #1e293b; font-weight: 600; font-size: 14px;">${sizeDisplay}</span>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="au-insights-header" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e2e8f0; padding: 12px 16px; margin-left: -16px; margin-right: -16px; margin-top: -16px; border-top-left-radius: 12px; border-top-right-radius: 12px;">
      <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">Property Insights</h3>
    </div>
    ${landSizeHtml || '<div style="padding: 16px 4px; color: #64748b; font-size: 13px;">Land size insights are disabled.</div>'}
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
