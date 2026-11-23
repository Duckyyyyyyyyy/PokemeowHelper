/**
 * The World Boss page (sidebar → Battling → "World Boss Battles"), as read by the content script
 * (chrome.storage.local "mdBossLobby"). Plain JSON.
 *
 * The "Next Scheduled Boss" card was checked live on 2026-11-23 (tests/fixtures/worldboss/next-card.live.html):
 * section.world-boss-next with the name button ("GMAX Melmetal", form icon span.pokemon-name-gmax), types,
 * <time datetime>, countdown, and .world-boss-next-build holding the same facts and "Moves this appearance"
 * list as the dialog (move name in button.world-boss-info-move, category in an aria-label).
 * The details dialog below is still UNVERIFIED (reconstructed from the game's WorldBossBattles chunk).
 *  - The boss details dialog (opened from the next boss's name or a schedule row's "About this
 *    boss"): .world-boss-schedule-info with Level / Ability / Nature and, when the game has them,
 *    "Moves this appearance" (ul.world-boss-info-moves). Otherwise it says the moves are confirmed
 *    when the boss appears.
 */

export interface BossLobbyMove {
  name: string;
  type?: string;
  /** Physical / Special / Status, as the dialog shows it. */
  category?: string;
}

/** One boss's build from the details dialog. */
export interface BossBuild {
  name: string;
  /** Form hint from the name icons (eternamax, gmax) or the sprite. */
  form?: string;
  types: string[];
  level?: number;
  ability?: string;
  nature?: string;
  /** Undefined = the dialog shows no moves yet ("confirmed when it appears"); never an empty list. */
  moves?: BossLobbyMove[];
  /** Staff-summoned: build revealed on appearance. */
  staff?: boolean;
  /** When the dialog was read. */
  at: number;
  /**
   * The "Next scheduled boss" spawn time when this boss was the next one at read time. The dialog is
   * shared with every schedule row, so a build only counts as the next spawn while this still matches.
   */
  startsAt?: string;
}

export interface BossNext {
  name: string;
  form?: string;
  types: string[];
  /** Spawn time (ISO, from the card's <time datetime>), when shown. */
  startsAt?: string;
  staff?: boolean;
}

export interface BossLobbySnapshot {
  v: 1;
  at: number;
  next?: BossNext;
  /** Builds seen in the details dialog, keyed by lowercased boss name (+ form). Kept when the dialog closes. */
  builds: Record<string, BossBuild>;
}

export const bossKey = (name: string, form?: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}${form ? `:${form}` : ''}`;
