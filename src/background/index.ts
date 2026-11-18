import { DEFAULT_BOUNDS, MODE_KEY, WINDOW_BOUNDS_KEY, isGameUrl, normalizeMode, sanitizeBounds, type UiMode } from '../shared/uiMode';

// The toolbar icon either opens a small standalone window (default) or a side panel that is only enabled on
// pokemeowrpg.com tabs. Live data does not depend on which tab is active: the content script writes to
// chrome.storage and the UI listens there. Nothing here touches the game page.

const PAGE = 'sidepanel.html';
const log = (err: unknown) => console.error('[MeowHelper]', err);

async function getMode(): Promise<UiMode> {
  const r = await chrome.storage.local.get(MODE_KEY);
  return normalizeMode(r[MODE_KEY]);
}

async function setTabPanel(tabId: number, url: string | undefined) {
  await chrome.sidePanel.setOptions({ tabId, path: PAGE, enabled: isGameUrl(url) });
}

async function applyMode() {
  const mode = await getMode();
  const tabs = (await chrome.tabs.query({})).filter((t) => t.id !== undefined);
  await chrome.sidePanel.setOptions({ enabled: false }); // off everywhere by default
  if (mode === 'panel') {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await Promise.all(tabs.map((t) => setTabPanel(t.id!, t.url))); // on for game tabs
  } else {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    // Clear per-tab overrides left over from panel mode.
    await Promise.all(tabs.map((t) => chrome.sidePanel.setOptions({ tabId: t.id!, enabled: false })));
  }
}

async function findHelperWindow(): Promise<chrome.windows.Window | undefined> {
  const base = chrome.runtime.getURL(PAGE);
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
  return wins.find((w) => w.tabs?.some((t) => (t.url ?? t.pendingUrl ?? '').startsWith(base)));
}

async function openOrFocusWindow() {
  const existing = await findHelperWindow();
  if (existing?.id !== undefined) {
    await chrome.windows.update(existing.id, { focused: true, drawAttention: true });
    return;
  }
  const saved = sanitizeBounds((await chrome.storage.local.get(WINDOW_BOUNDS_KEY))[WINDOW_BOUNDS_KEY] ?? DEFAULT_BOUNDS);
  await chrome.windows.create({ url: chrome.runtime.getURL(PAGE), type: 'popup', focused: true, ...saved });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function rememberBounds(windowId: number) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const helper = await findHelperWindow();
    if (!helper || helper.id !== windowId || helper.state === 'minimized' || helper.state === 'fullscreen') return;
    const { width, height, left, top } = helper;
    if (width && height) await chrome.storage.local.set({ [WINDOW_BOUNDS_KEY]: sanitizeBounds({ width, height, left, top }) });
  }, 400);
}

chrome.runtime.onInstalled.addListener(() => applyMode().catch(log));
chrome.runtime.onStartup.addListener(() => applyMode().catch(log));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[MODE_KEY]) applyMode().catch(log);
});

chrome.action.onClicked.addListener(() => {
  // Only fires in window mode: in panel mode Chrome opens the side panel itself.
  getMode()
    .then((m) => (m === 'window' ? openOrFocusWindow() : undefined))
    .catch(log);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && info.status !== 'complete') return;
  getMode()
    .then((m) => (m === 'panel' ? setTabPanel(tabId, tab.url ?? info.url) : undefined))
    .catch(log);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  getMode()
    .then(async (m) => {
      if (m === 'panel') await setTabPanel(tabId, (await chrome.tabs.get(tabId)).url);
    })
    .catch(log);
});

chrome.windows.onBoundsChanged.addListener((w) => {
  if (w.type === 'popup' && w.id !== undefined) rememberBounds(w.id);
});
