# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Added Sandringham College to the VIC schools database with overall Better Education rankings (#141 for 2025, #144 for 2024).
- Added SVG loader spinner featuring native SMIL animation to ensure a robust and reliable loading indicator across all host sites.
- Added console logging to the catchment resolution logic (`resolveCatchmentSchools`), printing resolved school names, primary school overall scores, and secondary college state rankings.

### Changed
- Re-ranked all Victorian public secondary colleges in `schools_db.json` using their overall state-wide Better Education Ranks instead of public-only ranks (e.g., Balwyn High School #53, Glen Waverley Secondary College #64, Mount Waverley Secondary College #125, Brighton Secondary College #158).
- Adjusted catchment boundaries in `vic_secondary.json` to correctly map Hampton East coordinates to Sandringham College instead of Brighton Secondary College.
- Restyled the school rows inside the insights panel to add flexible gap layouts, `min-width` bounds, and non-shrinkable badges (`flex-shrink: 0`) to prevent text overlapping or touching the ranking badges.
- Increased layout margins and padding within the insights card for a cleaner and more user-friendly interface.

## [0.2.0] - 2026-06-05

### Added
- Added dynamic, lazy-loading boundary cache (`boundaryCache`) to support resolving school catchments in any state or territory.
- Extended the Better Education ratings scraper (`update_schools_db.js`) to dynamically target all states and territories (`vic`, `nsw`, `qld`, `wa`, `sa`, `tas`, `act`, `nt`).
- Added spatial catchments for secondary colleges (using simplified `vic_secondary.json` boundaries).
- Added offline Point-in-Polygon geospatial catchment resolution using simplified GeoJSON boundary files (`server/data/school-zones/vic_primary.json`).
- Added Haversine geodetic distance calculation for zoned schools based on coordinates.
- Added address geocoding via OpenStreetMap Nominatim on the proxy backend.
- Added strict land-size resolution metadata (`landSizeMeta`) and per-attempt logs (`landSizeLogs`) from proxy responses.
- Added server test coverage for:
  - point-in-polygon lookup, geodetic distance calculation, and spatial school mapping for VIC and NSW
  - fallback ordering
  - 5-second fallback delay behavior
  - Allhomes direct slug URL building
  - Gemini retry behavior on `429`
  - parsing `approx` land-size text and tag-split HTML snippets
- Added richer loading UI in the extension:
  - spinner
  - animated dots
  - animated progress bar
  - elapsed timer

### Changed
- Switched architecture from browser-direct Gemini requests to proxy-only insights retrieval.
- Moved Gemini key usage to server-side env (`server/.env`) via `GEMINI_API_KEY`.
- Cleaned up the extension popup interface (`popup.html` and `popup.js`) to completely remove the Gemini API Key configuration card, placeholder elements, and external setup links.
- Updated land-size fallback chain to:
  1. `realestate.com.au`
  2. `property.com.au`
  3. `allhomes.com.au`
  4. Gemini as non-authoritative fallback signal
- Added mandatory 5-second waits before each fallback source attempt.
- Updated Allhomes lookup from query search URL to direct property slug URL:
  - `https://www.allhomes.com.au/<street>-<suburb>-<state>-<postcode>`
- Improved parser robustness for land-size extraction:
  - supports `approx`, `approx.`, `approximately`
  - handles HTML tag-split values around numeric/unit text
- Shortened Gemini prompt payload to reduce token and quota pressure.
- Added retry with exponential backoff + jitter for retriable Gemini failures (`429`, `503`).
- Added extension request dedupe/debounce guards to reduce duplicate API calls in SPA transitions.

### Removed
- Removed browser-side Gemini API call path from extension content script.
- Removed extension dependency on popup-stored Gemini API key for insights retrieval.
