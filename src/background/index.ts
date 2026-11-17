// Clicking the toolbar icon opens the side panel. Nothing else runs in the background in Phase 1.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error('[MeowDex]', err));
