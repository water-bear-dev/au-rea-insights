# Agent Handoff: AU Real Estate Insights

This handoff reflects the current strict land-size accuracy policy and latest implementation state.

---

## 1. Project Overview

**AU Real Estate Insights** is a Chrome extension for **realestate.com.au** and **domain.com.au** that injects:
1. **Land size insight** (strict verified-only display policy).
2. **School catchment/ranking insight** (BetterEducation-based presentation).

### Architecture
- **Extension frontend (`/extension`)**
  - `content.js`: address extraction, data fetch flow, UI injection, caching.
  - `content.css`: styling for injected "Property Insights" card.
  - `popup.html` / `popup.js`: toggles, API key input, cache clear control.
- **Local proxy (`/server`)**
  - `index.js`: API endpoint `/api/insights`, school resolution, strict land-size resolver with metadata.

---

## 2. What Was Changed (Latest)

### A. Strict Verified-Only Land Size Policy
- Implemented global rule: numeric land size is shown **only** when source is verified from authoritative profile extraction.
- If verification fails, response/display is `Not available`.
- Added land-size provenance metadata in proxy responses:
  - `landSizeMeta: { status, value, source, reason }`

### B. Server Resolver Hardening (`server/index.js`)
- Added normalization and strict resolver helpers:
  - `normalizeLandSize(...)`
  - `createLandSizeResolution(...)`
  - `resolveLandSizeStrict(...)`
- Kept verified extraction path from realestate profile page (text/JSON structured matches).
- Removed weak/non-authoritative fallbacks:
  - Removed broad `property.com.au` scraping fallback for land size.
  - Removed hardcoded demo land-size overrides (including Cheltenham `156m²` override).
- Gemini is retained but treated as **unverified signal only** (never directly authoritative for numeric land size).

### C. Extension Strict Display + Cache Versioning (`extension/content.js`)
- Added cache versioning:
  - New prefix: `insights_cache_v2_`
  - Legacy prefix: `insights_cache_` is cleaned per-address on read
- Enforced strict display behavior:
  - Only display numeric land size if status is verified.
  - Otherwise display `Not available`.
- In Gemini-key path, extension no longer trusts Gemini `landSize` directly:
  - It performs authoritative profile extraction before displaying numeric size.
- Extension now includes page URL when calling proxy fallback:
  - `url=<window.location.href>`

### D. URL + Address Guided Retrieval
- Added URL parser in proxy:
  - `parseAddressFromRealEstatePropertyUrl(...)`
- `/api/insights` now accepts `url` and can reconstruct address context from realestate property URL format when needed.
- This improves resilience where formatted address parts are inconsistent.

### E. Regex Improvement for Real Listings
- Updated text extraction regex to handle phrasing like:
  - `land size of 156 m²`
  - `land area: 156 sqm`
  - `block size 156m2`
- Applied in both extension and server extraction logic.

### F. Popup Cache Clearing (`extension/popup.js`)
- Clear cache now removes both old and new cache key prefixes:
  - `insights_cache_`
  - `insights_cache_v2_`

---

## 3. Current Known Behavior

- Correctness-first behavior is active.
- Some properties may now show `Not available` where a heuristic/model value was previously shown.
- This is intentional to avoid incorrect parent-lot values (e.g., townhouse/subdivision mismatch like `703m²` vs `156m²`).

---

## 4. Verification Done

- Syntax checks passed:
  - `node --check server/index.js`
  - `node --check extension/content.js`
  - `node --check extension/popup.js`
- Lint diagnostics: no new errors on edited files.

---

## 5. Immediate Next Steps for Another Agent

1. Reload extension in `chrome://extensions`.
2. Click **Clear Storage Cache** in popup (clears both legacy and v2 keys).
3. Re-test `24 Abbington Avenue, Cheltenham VIC 3192` on live listing page.
4. Confirm the stricter flow:
   - If authoritative extraction succeeds, show numeric value.
   - If not, show `Not available` (no Gemini numeric fallback).
5. If still `Not available` while page text clearly includes land size:
   - Inspect the exact HTML snippet containing land size phrase.
   - Extend strict regex/selector list without reintroducing broad heuristic matches.

---

## 6. Important Guardrails

- Do not reintroduce generic page-wide `m²` scraping.
- Do not reintroduce hardcoded suburb/address numeric overrides.
- Keep model outputs non-authoritative for numeric land size unless independently verified.
