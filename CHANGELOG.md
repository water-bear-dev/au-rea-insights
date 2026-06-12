# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.4.0] - 2026-06-12

### Added
- Added Python data pipeline script `process_zones.py` to compile and unify all state-specific raw school boundaries and locations from `source_files/` (covering VIC, NSW, QLD, SA, TAS, ACT, WA, NT).
- Added automatic KMZ/KML downloading and parsing from Google My Maps URLs for Northern Territory (NT) school catchments.
- Added MGA Zone 55 coordinate reprojection (EPSG:28355 -> EPSG:4326) for Tasmanian intake area boundaries using the `pyproj` library.
- Added geometry simplification (0.0002 degrees tolerance) and centroid coordinate calculation to maintain small GeoJSON file sizes.
- Added local MultiPolygon containment checks (`isPointInGeoJsonGeometry`) in `server/index.js` supporting holes.
- Added nearest-distance fallback using computed centroids for properties outside defined polygon areas or for states with point-only data (like WA).
- Added `getRootPath()` helper in `server/index.js` resolving paths relative to `process.cwd()` to ensure compatibility with Vercel's serverless file execution.
- Added Vercel functions configuration in `vercel.json` to bundle `server/**` assets (school-zones and `schools_db.json`) into the serverless function.
- Added OSRM Routing API integration to calculate real driving distance by car instead of straight-line distance.
- Added highway-snapping detour protection in `getDrivingDistance` (falling back to straight-line distance if driving distance is >1.5km and >2.5x the straight-line distance to avoid snapping errors to nearby freeways).

### Changed
- Migrated backend school catchment resolution from Nominatim API bounding-box queries back to local, high-performance offline spatial checks.
- Updated backend unit tests to verify containment and fallback lookup results across multiple states, relaxing distance thresholds to accommodate realistic driving routes.
- Switched hardcoded API endpoint in `extension/content.js` from the preview URL to the production Vercel URL.

## [0.3.0] - 2026-06-12

### Added
- Added client-side background scraping of land size in extension background service worker (`background.js`) to bypass proxy/cloud hosting `403 Forbidden` response blocks (e.g., from Render/AWS).
- Added fallback order sequence in background script: `allhomes.com.au` -> `property.com.au` -> `realestate.com.au` with a 5-second sleep duration between fallback queries.
- Added dynamic coordinate-radius school catchment resolution on the backend using Nominatim's radius boundary search (~4.4km bounding box) instead of offline GeoJSON polygon files.
- Added a flexible name-cleaning matcher helper on the backend to match Nominatim geolocated school results against the local `schools_db.json` ratings database.
- Added Vercel Serverless Function deployment support via a root `vercel.json`, `api/index.js` wrapper, and root `package.json` proxy configuration.

### Changed
- Shifted the scraping duties from the Node.js backend to the client extension's background service worker (`background.js`) to ensure requests originate from the user's residential IP.
- Rewrote backend catchment lookup (`resolveCatchmentSchools`) to perform dynamic coordinate-radius bounding box searches to support all of Australia location-agnostically (including TAS, NT, ACT).
- Constrained school lookup returns to exactly 1 closest primary school and 1 closest secondary school.

### Removed
- Removed the offline GeoJSON boundary files (`server/data/school-zones/`) entirely.
- Removed mock polygon boundary-checking dependencies and offline point-in-polygon logic.


## [0.2.1] - 2026-06-09

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
