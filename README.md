# AU Real Estate Insights

Chrome extension + local proxy server that enriches listings on `realestate.com.au` and `domain.com.au` with:

- verified land size (strict source policy)
- local school catchment/ranking data

## Current Architecture

The project is now **proxy-first**:

- Extension (`extension/content.js`) calls only `http://localhost:3000/api/insights`
- Server (`server/index.js`) performs data resolution and any Gemini calls
- Gemini key is stored server-side in `server/.env` (`GEMINI_API_KEY`), never in extension storage

This avoids exposing keys in the browser and reduces direct API throttling issues.

## Key Behaviors

- Land size is shown only when status is `verified`
- Fallback order for land size:
  1. `realestate.com.au`
  2. `property.com.au`
  3. `allhomes.com.au` (direct property slug URL)
  4. Gemini signal only (non-authoritative for final numeric display)
- 5-second wait is applied before each fallback step
- Server returns `landSizeLogs` with per-source attempt details
- Extension prints attempt logs in browser console for debugging
- Request dedupe/debounce reduces duplicate calls on SPA navigation

## Project Structure

```text
au-rea-insights/
├── extension/
│   ├── manifest.json
│   ├── content.js
│   ├── content.css
│   ├── popup.html
│   └── popup.js
├── server/
│   ├── index.js
│   ├── land-size.test.js
│   ├── schools_db.json
│   └── package.json
├── tests/
│   └── mock_pages.html
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
GEMINI_API_KEY=your_rotated_key_here
PORT=3000
```

### 3) Start backend

```bash
npm --prefix server install
npm --prefix server run dev
```

### 4) Browse supported listing pages

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

## Security Notes

- Do not store Gemini keys in extension storage
- Rotate keys immediately if they are exposed
- Restrict API key scope to Generative Language API where possible
