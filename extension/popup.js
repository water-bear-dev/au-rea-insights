document.addEventListener('DOMContentLoaded', async () => {
  const CACHE_PREFIXES = ['insights_cache_', 'insights_cache_v2_'];
  const toggleLandSize = document.getElementById('toggle-land-size');
  const toggleLivability = document.getElementById('toggle-livability');
  const toggleDevControls = document.getElementById('toggle-dev-controls');
  const developerCard = document.getElementById('developer-card');

  // Load saved configurations
  chrome.storage.local.get(['showLandSize', 'showLivability', 'showDevControls'], (result) => {
    toggleLandSize.checked = result.showLandSize !== false;
    toggleLivability.checked = result.showLivability !== false;
    
    const showDev = result.showDevControls === true;
    toggleDevControls.checked = showDev;
    developerCard.style.display = showDev ? 'block' : 'none';
  });

  // Save changes
  toggleLandSize.addEventListener('change', () => {
    chrome.storage.local.set({ showLandSize: toggleLandSize.checked });
  });

  toggleLivability.addEventListener('change', () => {
    chrome.storage.local.set({ showLivability: toggleLivability.checked });
  });

  toggleDevControls.addEventListener('change', () => {
    const isChecked = toggleDevControls.checked;
    chrome.storage.local.set({ showDevControls: isChecked });
    developerCard.style.display = isChecked ? 'block' : 'none';
  });

  // Clear storage cache (developer tools) with double confirmation
  const clearCacheBtn = document.getElementById('clear-cache');
  const clearStatus = document.getElementById('clear-status');
  let confirmMode = false;
  let resetTimeout;

  clearCacheBtn.addEventListener('click', () => {
    if (!confirmMode) {
      // Enter confirmation phase
      confirmMode = true;
      clearCacheBtn.innerText = 'Click again to confirm!';
      clearCacheBtn.style.backgroundColor = '#f97316'; // Orange warning color
      
      resetTimeout = setTimeout(() => {
        confirmMode = false;
        clearCacheBtn.innerText = 'Clear Storage Cache';
        clearCacheBtn.style.backgroundColor = '#ef4444'; // Original red color
      }, 3000);
    } else {
      // Confirmed click
      clearTimeout(resetTimeout);
      confirmMode = false;
      clearCacheBtn.innerText = 'Clear Storage Cache';
      clearCacheBtn.style.backgroundColor = '#ef4444';
      
      chrome.storage.local.get(null, (items) => {
        const keysToRemove = Object.keys(items).filter(key => CACHE_PREFIXES.some(prefix => key.startsWith(prefix)));
        chrome.storage.local.remove(keysToRemove, () => {
          clearStatus.style.display = 'block';
          setTimeout(() => {
            clearStatus.style.display = 'none';
          }, 1500);
        });
      });
    }
  });
});
