import { readBattle } from './battleReader';

/**
 * MeowDex content script (pokemeowrpg.com). READ-ONLY by design (game rule: "Play yourself"):
 * it watches the page, reads the battle screen when one is open, and stores a snapshot for
 * the side panel. It never clicks, types, changes the page, or calls the game's API.
 */
const KEY = 'mdBattle';
// Starts as 'none' so a game tab without a battle never wipes a battle another tab is showing.
let last = 'none';
let timer: number | undefined;

function publish() {
  timer = undefined;
  const snap = readBattle(document);
  const { at: _at, ...rest } = snap ?? ({ at: 0 } as { at: number });
  const sig = snap ? JSON.stringify(rest) : 'none';
  if (sig === last) return;
  last = sig;
  try {
    chrome.storage.local.set({ [KEY]: snap }).catch(() => observer.disconnect());
  } catch {
    // Extension reloaded or updated: this old copy is orphaned, stop quietly.
    observer.disconnect();
  }
}

const observer = new MutationObserver(() => {
  if (timer === undefined) timer = window.setTimeout(publish, 300);
});
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-status', 'data-fainted', 'data-active', 'disabled', 'aria-label'] });
publish();
