# AU Real Estate Insights: Chrome Extension

A premium Chromium extension designed for Australian property buyers. It dynamically injects property land size details and local school catchment rankings directly into listings on **realestate.com.au** and **domain.com.au** using the Gemini API.

---

## 🌟 Key Features

1. **Land Size Enrichment**: Extracts land size values. If absent on the page, the extension queries the Gemini model to resolve it based on local property records.
2. **School Catchment Dashboard**: Shows nearest primary and secondary schools within the property's zone, displaying their **BetterEducation State Rank**, score, and latest assessment year.
3. **Serverless Architecture**: Direct integration with Google's Gemini API using the user's personal API key. No backend proxy or local servers required.
4. **Dynamic SPA Observer**: Uses MutationObservers to handle dynamic Single Page Application (SPA) navigation transitions on Domain and REA.

---

## 📂 Project Structure

```
au-rea-insights/
├── extension/           # Chrome Extension folder
│   ├── manifest.json    # Extension configuration (Manifest V3)
│   ├── content.js       # Content script (queries Gemini & injects UI)
│   ├── content.css      # Custom light theme style for insights UI
│   ├── popup.html       # Popup settings & Gemini API configuration interface
│   └── popup.js         # Settings & API key saving script
└── tests/               # Local Sandbox Tests
    └── mock_pages.html  # Mock sandbox page for instant UI rendering checks
```

---

## 🚀 Setup & Installation

### Step 1: Install the Chrome Extension

1. Open Google Chrome.
2. In the URL bar, go to `chrome://extensions/`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left corner.
5. Choose the **`extension/`** folder from this project directory.
6. The extension is now active! You will see the **AU Real Estate Insights** icon in your toolbar.

---

### Step 2: Configure Gemini API Key

1. Click on the extension icon in your toolbar.
2. Under **Gemini API Configuration**, enter your Gemini API Key.
   *If you do not have a key, you can generate one for free on [Google AI Studio](https://aistudio.google.com/).*
3. The key saves automatically on typing.
4. Navigate to any property on `realestate.com.au` or `domain.com.au` to view insights.

---

## 🧪 Testing the Extension (Sandbox)

Since live property sites have rate limits or login blocks, we included a local mock page for instant verification:

1. Open the file **`tests/mock_pages.html`** in Chrome.
2. The mock page simulates listing styles from both `realestate.com.au` and `domain.com.au`.
3. Configure your API key in the popup.
4. The content script automatically detects the simulated containers, calls the Gemini API directly, and renders the land size bubble and school catchment panel.
