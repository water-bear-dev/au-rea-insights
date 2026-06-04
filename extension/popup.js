document.addEventListener('DOMContentLoaded', async () => {
  const CACHE_PREFIXES = ['insights_cache_', 'insights_cache_v2_'];
  const toggleLandSize = document.getElementById('toggle-land-size');
  const toggleSchools = document.getElementById('toggle-schools');
  const geminiApiKey = document.getElementById('gemini-api-key');
  const saveStatus = document.getElementById('save-status');

  // Load saved configurations
  chrome.storage.local.get(['showLandSize', 'showSchools', 'geminiApiKey'], (result) => {
    toggleLandSize.checked = result.showLandSize !== false;
    toggleSchools.checked = result.showSchools !== false;
    if (result.geminiApiKey) {
      geminiApiKey.value = result.geminiApiKey;
    }
  });

  // Save changes
  toggleLandSize.addEventListener('change', () => {
    chrome.storage.local.set({ showLandSize: toggleLandSize.checked });
  });

  toggleSchools.addEventListener('change', () => {
    chrome.storage.local.set({ showSchools: toggleSchools.checked });
  });

  // Auto-save API key with a small typing delay
  let saveTimeout;
  geminiApiKey.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      chrome.storage.local.set({ geminiApiKey: geminiApiKey.value.trim() }, () => {
        saveStatus.style.display = 'block';
        setTimeout(() => {
          saveStatus.style.display = 'none';
        }, 1500);
      });
    }, 400);
  });

  // Clear storage cache (developer tools)
  const clearCacheBtn = document.getElementById('clear-cache');
  const clearStatus = document.getElementById('clear-status');
  clearCacheBtn.addEventListener('click', () => {
    chrome.storage.local.get(null, (items) => {
      const keysToRemove = Object.keys(items).filter(key => CACHE_PREFIXES.some(prefix => key.startsWith(prefix)));
      chrome.storage.local.remove(keysToRemove, () => {
        clearStatus.style.display = 'block';
        setTimeout(() => {
          clearStatus.style.display = 'none';
        }, 1500);
      });
    });
  });
});
