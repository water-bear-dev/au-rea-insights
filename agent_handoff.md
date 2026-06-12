# Agent Handoff: AU Real Estate Insights

This handoff summarizes the latest production-oriented state after implementing the unified offline school zones compilation, backend catchment containment/fallback checks, and Vercel serverless configurations.

## 1) Current Architecture (Important)

- **Extension Service Worker (`extension/background.js`)**: Executes client-side background scraping of land sizes using the user's residential IP to bypass datacenter blocks (403 Forbidden errors).
- **Content Script (`extension/content.js`)**: Scrapes listing details, triggers background land size scraping and backend school lookup, and renders the insights card UI. Configured to query the production Vercel deployment: `https://au-rea-insights.vercel.app`.
- **Serverless Backend (`server/index.js` / Vercel)**: Geocodes addresses and runs offline local spatial lookups using the compiled school zones in `server/data/school-zones/`. Path resolution uses `process.cwd()` via a custom `getRootPath()` helper to resolve files correctly in the Vercel Lambda container.

## 2) Land Size Resolution Policy

- **Verified Only**: Only land sizes matching clean patterns are displayed.
- **Fallback Chain**: `allhomes.com.au` -> `property.com.au` -> `realestate.com.au` (with 5-second wait intervals).

## 3) Offline School Catchment Resolution

- **Compiled States**: All 8 states and territories (ACT, NSW, NT, QLD, SA, TAS, VIC, WA) are fully compiled into unified GeoJSON files:
  - `server/data/school-zones/<state>_primary.json`
  - `server/data/school-zones/<state>_secondary.json`
- **Data Source Formats**:
  - **VIC**: Parsed from original GeoJSON boundary sets.
  - **NSW, SA, TAS**: Parsed from shapefiles using `pyshp`.
  - **QLD**: Parsed from local KML datasets.
  - **ACT**: CSV priority enrolment areas parsed from WKT strings.
  - **WA**: Excel active schools compiled into Point coordinates.
  - **NT**: Automatically downloaded and parsed from the user-provided Google My Maps embed URLs.
- **Spatial Lookup Strategy**:
  1. Check if the property coordinates fall inside any defined zone polygon (Polygon or MultiPolygon with hole handling).
  2. If not contained (or point-only like WA), calculate geodetic Haversine distance to all schools in the state's dataset using their centroids/points and select the closest one.
- **Ratings Matcher**: Matches name against the local rankings database (`schools_db.json`).
- **Limit**: Returns exactly 1 closest primary school and 1 closest secondary school.

## 4) Preprocessing Pipeline

- Run the data pipeline script:
  ```bash
  python3 server/scripts/process_zones.py
  ```
  This script downloads NT maps, converts TAS projections from MGA Zone 55 to EPSG:4326, simplifies shapes to `0.0002` degrees, calculates centroids, and outputs unified GeoJSON files.

## 5) Validation Snapshot

- All 14 backend unit tests pass successfully (`npm test` in the `server` directory).
- Coverage checks:
  - Land size fallback ordering and parsing.
  - Spatial MultiPolygon catchment checks in VIC.
  - Point-only nearest school lookups in WA.
  - Missing coordinates suburb matching fallback.

## 6) Deployment Checklist

1. **Vercel Serverless**: Deploy the root directory. Vercel routes `/api/insights` traffic to `api/index.js`.
2. **Asset Bundling**: `vercel.json` contains `"includeFiles": "server/**"` to ensure that `schools_db.json` and the `data/school-zones/` JSON files are copied into the Lambda function package during compilation.
3. **Extension Configuration**: Ensure `content.js` calls the correct production Vercel URL.

## 7) Guardrails

- **Do not make Nominatim geocoding requests without a valid custom User-Agent header**.
- **Keep geometry simplification intact** (tolerance `0.0002`) to prevent serverless function payload limits from being exceeded.
- **Ensure school ratings continue to align with the overall state-wide Better Education rankings**.
