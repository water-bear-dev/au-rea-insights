# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.0] - 2026-06-05

### Added
- Added strict land-size resolution metadata (`landSizeMeta`) and per-attempt logs (`landSizeLogs`) from proxy responses.
- Added server test coverage for:
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
