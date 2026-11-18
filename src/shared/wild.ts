/**
 * The wild encounter card on the game's Explore page, as read by the content script
 * (chrome.storage.local "mdWild"). Plain JSON. Shape learned from a live encounter
 * (Doduo, Grasslands 3) on 2026-11-18.
 */
export interface WildBall {
  name: string;
  count: number;
}

export interface WildLead {
  name: string;
  level?: number;
  hp?: number;
  maxHp?: number;
  item?: string;
}

export interface WildSnapshot {
  v: 1;
  at: number;
  /** wild-encounter data-view: "intro" before Battle, something else once the battle runs. */
  view: string;
  /** Map section from the page title, e.g. "Grasslands 3". */
  map?: string;
  name: string;
  gender?: 'M' | 'F';
  level?: number;
  /** Rarity tag text: Common, Rare, Extremely Rare, Legendary, Shiny… */
  rarity?: string;
  shiny: boolean;
  item?: string;
  /** Pokédex icon: registered as obtained (true) / not yet (false). */
  registered?: boolean;
  /** "[in box: N]" – currently owned, including team and reserved. */
  inBox?: number;
  hp?: number;
  maxHp?: number;
  /** HP % from the health bar when no numbers are shown. */
  hpPct?: number;
  /** Status code: par, brn, psn, tox, slp, frz. */
  status?: string;
  /** Quick-catch slots with their bag counts. */
  balls: WildBall[];
  lead?: WildLead;
}
