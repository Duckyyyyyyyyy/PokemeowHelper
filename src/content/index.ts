import { readBattle } from './battleReader';
import { mergeBag, readBag } from './bagReader';
import { readWild } from './wildReader';
import { carryTeamHp } from '../shared/wildTeam';
import { lobbySig, mergeBossLobby, readBossLobby } from './bossLobbyReader';

/**
 * MeowRPGAdvisor content script (pokemeowrpg.com). READ-ONLY by design (game rule: "Play yourself"):
 * it watches the page, reads the battle screen, the Bag page the Explore encounter card or the World Boss page when one is open, and stores a
 * snapshot for the side panel. It never clicks, types, changes the page, or calls the game's API.
 */
const KEY = 'mdBattle';
const BAG_KEY = 'mdBag';
const WILD_KEY = 'mdWild';
const LOBBY_KEY = 'mdBossLobby';
// Starts as 'none' so a game tab without a battle never wipes a battle another tab is showing.
let last = 'none';
let lastBag = '';
// Same rule as battles: a tab that never showed an encounter never clears one.
let lastWild = 'none';
/** Last published encounter, so a Pokémon switched out keeps its HP (the team panel shows none). */
let lastWildSnap: ReturnType<typeof readWild> = null;
let timer: number | undefined;
// The World Boss page: only published while it is open, never cleared (its moves are needed in the battle).
let lastLobby = 'none';

function publishBag() {
  const read = readBag(document);
  if (!read) return;
  const sig = JSON.stringify(read.snap.items);
  if (sig === lastBag) return;
  lastBag = sig;
  chrome.storage.local
    .get(BAG_KEY)
    .then((r) => chrome.storage.local.set({ [BAG_KEY]: mergeBag(r[BAG_KEY], read) }))
    .catch(() => observer.disconnect());
}

/** The wild encounter card on the Explore page (read-only). */
function publishWild() {
  const snap = carryTeamHp(lastWildSnap, readWild(document));
  lastWildSnap = snap;
  const { at: _at, ...rest } = snap ?? ({ at: 0 } as { at: number });
  const sig = snap ? JSON.stringify(rest) : 'none';
  if (sig === lastWild) return;
  lastWild = sig;
  chrome.storage.local.set({ [WILD_KEY]: snap }).catch(() => observer.disconnect());
}

/** The World Boss page: next boss and the details dialog's moves (read-only). */
function publishLobby() {
  const read = readBossLobby(document);
  const sig = lobbySig(read);
  if (!read || sig === lastLobby) return;
  lastLobby = sig;
  chrome.storage.local
    .get(LOBBY_KEY)
    .then((r) => chrome.storage.local.set({ [LOBBY_KEY]: mergeBossLobby(r[LOBBY_KEY], read) }))
    .catch(() => observer.disconnect());
}

function publish() {
  timer = undefined;
  try {
    publishBag();
    publishWild();
    publishLobby();
  } catch {
    observer.disconnect();
    return;
  }
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
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-view', 'data-staff', 'datetime', 'style', 'data-status', 'data-fainted', 'data-active', 'disabled', 'aria-label'] });
publish();
