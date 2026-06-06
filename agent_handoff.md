# Agent Handoff: AU Real Estate Insights

This handoff summarizes the latest production-oriented state after architecture and parser hardening.

## 1) Current Architecture (Important)

- Extension (`extension/content.js`) is now proxy-only for data retrieval.
- Local backend (`server/index.js`) handles land size + schools + Gemini fallback logic.
- Gemini key lives only in `server/.env` (`GEMINI_API_KEY`).
- Popup key input has been completely removed from the extension interface.

## 2) Land Size Resolution Policy

- Display policy remains strict: numeric land size is shown only for `verified` results.
- Fallback chain in order:
  1. `realestate.com.au`
  2. `property.com.au`
  3. `allhomes.com.au`
  4. Gemini as non-authoritative signal only
- There is a 5-second wait before each fallback source attempt.

## 3) Logging and Debug Signals

- Proxy returns:
  - `landSizeMeta`
  - `landSizeLogs` (step-by-step source attempts)
- Proxy logs each step to terminal:
  - `[Proxy][LandSizeAttempt] {...}`
- Extension console prints grouped attempt logs:
  - `[AU Insights] Land size resolution attempts`

## 4) Recent Reliability Improvements

- Removed browser-direct Gemini API path to reduce exposed-key and quota issues.
- Added dedupe + debounce in extension request flow to reduce duplicate calls.
- Added Gemini retry with exponential backoff + jitter for `429`/`503`.
- Shortened Gemini prompt payload to reduce token pressure.
- Switched Allhomes fallback URL to direct property slug form:
  - `https://www.allhomes.com.au/<street>-<suburb>-<state>-<postcode>`
- Hardened land-size parser to handle:
  - `approx`, `approx.`, `approximately`
  - HTML tag-split values around number/unit
  - examples like `Block size: 188 m² approx.`

## 5) Validation Snapshot

- Server tests currently pass (`npm --prefix server test`).
- Coverage includes:
  - fallback ordering
  - fallback delay behavior
  - Allhomes slug URL generation
  - Gemini retry logic
  - `approx` and tag-split parser cases
  - point-in-polygon lookup, geodetic distance calculation, and spatial school mapping

## 6) Geospatial School Catchments

- Zoned catchments are resolved offline by comparing property coordinates to simplified GeoJSON boundary files loaded on startup (located in `server/data/school-zones/`).
- Listing addresses are geocoded using OpenStreetMap Nominatim with a custom User-Agent to avoid API blockades.
- Point-in-polygon queries use an offline ray-casting algorithm.
- Distance calculations use the Haversine formula for exact distance measurements in kilometers instead of random approximations.

## 7) Operational Notes for Next Agent

1. Ensure server is running before testing extension:
   - `npm --prefix server run dev`
2. If results look stale, clear extension cache from popup.
3. For parser misses on live pages:
   - capture HTML snippet around the visible block/land size text
   - extend targeted regex/selector support only (avoid broad generic `m²` scraping)
4. Keep strict verified-only display behavior intact.

## 8) Guardrails

- Do not move API key usage back into extension/browser context.
- Do not trust model-generated numeric land size as authoritative display value.
- Do not add hardcoded address overrides.
- Do not make geocoding requests without a valid custom User-Agent header to prevent service blocks.
- Ensure that simplified boundary file formats (e.g., GeoJSON polygons) remain simplified to prevent server startup latencies.
