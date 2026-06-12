# AU Real Estate Insights

Chrome extension + server backend that enriches listings on `realestate.com.au` and `domain.com.au` with:

- verified land size (strict source policy, scraped locally)
- local primary and secondary schools resolved via nearby coordinate-radius search
- official Better Education school rating and ranking metadata

## Current Architecture

The project uses a **hybrid architecture** to bypass anti-scraping blocks:

- **Extension Background Service Worker (`extension/background.js`)**: Executes the HTTP requests to scrape land sizes (Allhomes, Property.com.au, Realestate.com.au) using the **user's residential IP address**. This avoids the `403 Forbidden` errors triggered when cloud datacenter IPs attempt to scrape real estate platforms.
- **Serverless Backend Server (`server/index.js` / Vercel)**: Handles coordinate geocoding (via Nominatim) and school catchment matches using offline state-specific zone files compiled in `server/data/school-zones/`.

## Key Behaviors

- **Land Size Scraping**: Done client-side in the extension background script.
- **Land Size Fallback Order**:
  1. `allhomes.com.au`
  2. `property.com.au`
  3. `realestate.com.au`
- **Wait Delays**: A 5-second wait is applied between fallback attempts.
- **Offline School Catchment Search**: Resolves catchment zones using high-performance local spatial calculations. It checks polygon containment first, falling back to geodetic nearest-neighbor calculations (for point-only locations like WA, or properties outside defined boundaries). Matches results against the Better Education rankings database (`schools_db.json`).
- **Driving Distance Resolution**: School distances show actual driving distance by car (using OSRM routing API with a straight-line geodetic fallback). Includes a detour guard (falling back to straight-line distance if driving distance is >1.5km and >2.5x straight-line distance) to handle cases where school centroids snap to nearby restricted-access freeways.
- **1 Primary, 1 Secondary constraint**: The card lists at most the 1 closest primary school and 1 closest secondary school.
- **Vercel Serverless Support**: Configured for instant deployment to Vercel as Serverless Functions (`vercel.json` + `api/index.js`).

## Project Structure

```text
au-rea-insights/
├── api/
│   └── index.js
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── popup.html
│   └── popup.js
├── server/
│   ├── data/
│   │   └── school-zones/
│   ├── scripts/
│   │   ├── process_zones.py
│   │   └── update_schools_db.js
│   ├── index.js
│   ├── land-size.test.js
│   ├── schools-lookup.test.js
│   ├── schools_db.json
│   └── package.json
├── tests/
│   └── mock_pages.html
├── vercel.json
├── package.json
├── CHANGELOG.md
└── agent_handoff.md
```

## Setup

### 1) Install extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select the `extension/` folder

### 2) Configure server env

Create `server/.env`:

```env
PORT=3000
```

### 3) Start backend

```bash
npm --prefix server install
npm --prefix server run dev
```

### 4) Update School Database (Optional)

To scrape and automatically populate the database with the latest school overall ratings and rankings from Better Education (scrapes Top Schools pages and applies 10-second delays to avoid rate limits):

```bash
node server/scripts/update_schools_db.js
```

### 5) Browse supported listing pages

Open a property page on `realestate.com.au` or `domain.com.au`.
The extension injects the Property Insights card once the proxy responds.

## Testing

Run server tests:

```bash
npm --prefix server test
```

Open local mock page for UI checks:

- `tests/mock_pages.html`

## Debugging Tips

- If insights do not load, check proxy health:
  - `http://localhost:3000/health`
- Check browser console group:
  - `[AU Insights] Land size resolution attempts`
- Verify fallback attempts in server logs:
  - `[Proxy][LandSizeAttempt] ...`


