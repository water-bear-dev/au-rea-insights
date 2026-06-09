# Agent Handoff: AU Real Estate Insights

This handoff summarizes the latest production-oriented state after architecture, parser hardening, and school database consistency updates.

## 1) Current Architecture (Important)

- Extension (`extension/content.js`) is now proxy-only for data retrieval.
- Local backend (`server/index.js`) handles land size + schools resolution.
- Popup key input has been completely removed from the extension interface.

## 2) Land Size Resolution Policy

- Display policy remains strict: numeric land size is shown only for `verified` results.
- Fallback chain in order:
  1. `realestate.com.au`
  2. `property.com.au`
  3. `allhomes.com.au`
- There is a 5-second wait before each fallback source attempt.

## 3) Logging and Debug Signals

- Proxy returns:
  - `landSizeMeta`
  - `landSizeLogs` (step-by-step source attempts)
- Proxy logs each step to terminal:
  - `[Proxy][LandSizeAttempt] {...}`
- Extension console prints grouped attempt logs:
  - `[AU Insights] Land size resolution attempts`
- Server console logs resolved school statistics when catchment is requested:
  - `[School Lookup] Resolved Primary School: <name>, State Overall Score: <score>`
  - `[School Lookup] Resolved Secondary College: <name>, Ranking: <ranking>`

## 4) Recent Reliability & UX Improvements

- Removed browser-direct Gemini API path and server-side fallback completely to prevent key exposure and unnecessary dependencies.
- Added dedupe + debounce in extension request flow to reduce duplicate calls.
- Switched Allhomes fallback URL to direct property slug form.
- Hardened land-size parser to handle `approx` and tag-split values.
- Replaced the extension loading indicator with a robust **SMIL-animated inline SVG spinner** to ensure the animation always spins smoothly on all host sites.
- Re-styled the insights panel rows with flex gaps, `min-width` bounds, and non-shrinkable badges (`flex-shrink: 0`) to prevent school name text from touching or overlapping the ranking badges.

## 5) Validation Snapshot

- Server tests currently pass (`npm --prefix server test`).
- Coverage includes:
  - fallback ordering
  - fallback delay behavior
  - Allhomes slug URL generation
  - `approx` and tag-split parser cases
  - point-in-polygon lookup, geodetic distance calculation, and spatial school mapping (including Sandringham College VIC boundary checks)

## 6) Geospatial School Catchments & Database Consistency

- Zoned catchments are resolved offline for both primary and secondary schools by comparing property coordinates to simplified GeoJSON boundary files (located in `server/data/school-zones/`).
- Sandringham College has been added to the schools database under VIC, and its catchment boundary has been configured in `vic_secondary.json` to correctly map Hampton East properties.
- **School database consistency**: All Victorian public secondary colleges in `schools_db.json` have been re-ranked using their **overall state-wide Better Education Ranks** (e.g. Balwyn High School #53, Glen Waverley #64, Mount Waverley #125, Brighton Secondary College #158) rather than public-only ranks to ensure consistency with independent and selective schools.
- Distance calculations use the Haversine formula.

## 7) Operational Notes for Next Agent

1. Ensure server is running before testing extension:
   - `npm --prefix server run dev`
2. If results look stale, clear extension cache from popup.
3. Keep strict verified-only display behavior intact.

## 8) Guardrails

- Do not add hardcoded address overrides.
- Do not make geocoding requests without a valid custom User-Agent header.
- Ensure that school rankings continue to align with the overall state-wide ranking standard (not public-only ranks).
