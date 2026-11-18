/** Your bag, as read from the game's Bag page by the content script (chrome.storage.local "mdBag"). */
export type BagPocket = 'balls' | 'exploration' | 'medicine' | 'held' | 'berries' | 'evolution' | 'tms' | 'key' | string;

export interface BagItem {
  /** The game's item id, e.g. "potion", "electricgem", "tmgigadrain". */
  id: string;
  name: string;
  count: number;
  pocket: BagPocket;
}

export interface BagSnapshot {
  v: 1;
  /** When it was last read. */
  at: number;
  items: BagItem[];
}

/** Move id taught by a TM item ("tmgigadrain" → "gigadrain"), or undefined. */
export const tmMove = (it: BagItem) => (it.pocket === 'tms' && it.id.startsWith('tm') ? it.id.slice(2) : undefined);
