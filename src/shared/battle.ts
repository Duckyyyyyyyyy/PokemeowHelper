/**
 * What the content script reads from the game's battle screen (read-only).
 * Plain JSON: it travels through chrome.storage to the side panel.
 * Shape learned from a real Gym battle (Brock) on 2026-11-18, see docs/PLAN.md 0.3.
 */

export type BoostKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion';
export type Boosts = Partial<Record<BoostKey, number>>;

export interface BattleMon {
  name: string;
  level?: number;
  hp?: number;
  maxHp?: number;
  /** Game status code: par, brn, psn, tox, slp, frz. */
  status?: string;
  item?: string;
  /** Stat stages shown on screen next to the name ("Evasion +1"), when any. */
  stages?: Boosts;
  /** Doubles: field position (1 = left card, "Position 1" / "Opponent 1"). */
  position?: number;
}

export interface BattleMove {
  name: string;
  type?: string;
  category?: 'Physical' | 'Special' | 'Status';
  power?: number;
  accuracy?: number;
  pp?: number;
  maxPp?: number;
  disabled: boolean;
}

export interface RosterMon {
  name: string;
  level?: number;
  hp?: number;
  maxHp?: number;
  active: boolean;
  fainted: boolean;
  /** Gender when the page shows it (Explore team panel). */
  gender?: 'M' | 'F';
  /** Team slot shown on the Explore team panel (1 = starter). */
  slot?: number;
  /** Your side only: move names (with PP) shown on the switch card. */
  moves?: { name: string; pp?: number; maxPp?: number }[];
}

/**
 * One move use from the battle log, e.g. "Opponent’s Onix used Rock Tomb! It dealt 12 damage."
 * Only wording seen in a real battle is parsed; crits are flagged (`crit`), multi-hit lines too (`unusual`).
 */
export interface BattleEvent {
  /** Position in the full log (stable while the battle lasts). */
  idx: number;
  turn?: number;
  side: 'player' | 'opponent';
  mon: string;
  move: string;
  /**
   * The Pokémon hit: the other side's active one in singles; in doubles the one named in
   * "X used Crunch on Tate & Liza’s Claydol!" (seen live 2026-11-19).
   */
  target?: string;
  /** Side of `target` (doubles: a move can target your own ally). */
  targetSide?: 'player' | 'opponent';
  /**
   * Doubles spread move ("Slowbro used Surf!" then one "<Pokémon> took N damage." line per
   * Pokémon hit, "It doesn't affect <Pokémon>." for an immune one; seen live 2026-11-19).
   */
  hits?: EventHit[];
  damage?: number;
  missed?: boolean;
  /** The target fainted right after this hit (damage may be capped by its HP). */
  targetFainted?: boolean;
  /** Line has wording we don't model (multi-hit, recoil…): keep out of damage checks. */
  unusual?: boolean;
  /** The hit was a critical hit (checked against the crit damage range). */
  crit?: boolean;
  /** Stat stages of attacker and target at that moment. */
  stages: { attacker: Boosts; target: Boosts };
}

export interface EventHit {
  side: 'player' | 'opponent';
  mon: string;
  damage?: number;
  immune?: boolean;
  fainted?: boolean;
  /** Stat stages of the Pokémon hit at that moment. */
  stages?: Boosts;
}

export interface BattleSnapshot {
  /** Reader schema version, bump when the shape changes (v1 had no events). */
  v: 1 | 2;
  at: number;
  /** arena data-status: "active", "won", "lost"… */
  status: string;
  /** arena data-kind: "gym", "tower"… */
  kind?: string;
  format?: string;
  opponentName?: string;
  turn?: number;
  player?: BattleMon;
  opponent?: BattleMon;
  moves: BattleMove[];
  bench: RosterMon[];
  opponentTeam: RosterMon[];
  /** Stat stages of the active Pokémon on each side, rebuilt from the battle log. */
  boosts: { player: Boosts; opponent: Boosts };
  /** Last few log lines, for display. */
  log: string[];
  /** Move uses parsed from the whole log (v2+; missing in v1 snapshots). */
  events?: BattleEvent[];
  /**
   * Your active Pokémon fainted and the game wants the next one ("Choose your next Pokémon."):
   * only a switch-in can be picked. Missing in older snapshots: use activeFainted().
   */
  forcedSwitch?: boolean;
  /** Items panel of the battle screen, only what is rendered while the Items tab is open (see readBattleBag). */
  bag?: BattleBagItem[];
  /**
   * How many combatant stat boxes each side shows (2 per side would mean a doubles battle).
   * Not checked against a live doubles battle yet: see doublesReason().
   */
  sides?: { player: number; opponent: number };
  /**
   * Doubles (format "doubles", one card per field position; seen live 2026-11-19): every active
   * Pokémon of each side in position order. `player` / `opponent` stay the first ones.
   */
  actives?: { player: BattleMon[]; opponent: BattleMon[] };
  /**
   * Doubles: whose moves `moves` are. The game shows one position's moves at a time
   * ("Choose for Slowbro · Position 1"), and none while a target is being picked.
   */
  movesFor?: string;
  /** Weather and terrain shown on screen (effect buttons beside the turn counter). Unverified markup: see readField. */
  field?: BattleField;
}

/** On-screen field (2026-11 game update). Names use @smogon/calc spelling: "Rain", "Sun", "Electric"… */
export interface BattleField {
  weather?: string;
  weatherTurns?: number;
  terrain?: string;
  terrainTurns?: number;
  /** Every effect button's label as shown (Trick Room, Tailwind… are not sorted out yet). */
  labels?: string[];
}

/** One entry of the battle screen's Items panel. */
export interface BattleBagItem {
  /** Item id as the Bag page uses it (lower-case name without spaces, or the game's data attribute). */
  id: string;
  name: string;
  count: number;
  /** The game greys it out ("No team member needs this item" or disabled): unusable right now. */
  locked?: boolean;
}

/**
 * Why this battle looks like a doubles battle, or null for singles. The Battle tab's advice is
 * singles-only (a 1v1 projection), so in doubles it must not show it as if it were right.
 * Signals: the arena's data-format, two stat boxes on a side, two Pokémon marked active on the
 * switch cards or the opponent roster, two different Pokémon of one side using moves in the same
 * turn of the log, or the matched NPC team's wiki format (passed in by the caller).
 */
export function doublesReason(snap: BattleSnapshot, npcFormat?: string): string | null {
  const f = (snap.format ?? '').toLowerCase();
  if (f && f !== 'singles') return `the battle screen says the format is “${snap.format}”`;
  if (snap.sides && (snap.sides.player > 1 || snap.sides.opponent > 1)) return 'two Pokémon are on the field on one side';
  if (snap.bench.filter((r) => r.active && !r.fainted).length > 1) return 'two of your Pokémon are marked active';
  if (snap.opponentTeam.filter((r) => r.active && !r.fainted).length > 1) return 'two of their Pokémon are marked active';
  if (npcFormat === 'doubles') return 'this NPC battles in Doubles (wiki data)';
  // Needs two such turns: a rare singles quirk (e.g. a switch effect) must not hide singles advice.
  const seen = new Map<string, Set<string>>();
  const doubleTurns = new Set<string>();
  for (const e of snap.events ?? []) {
    if (e.turn === undefined) continue;
    const key = `${e.turn}|${e.side}`;
    const mons = seen.get(key) ?? new Set<string>();
    mons.add(e.mon.toLowerCase());
    seen.set(key, mons);
    if (mons.size > 1) doubleTurns.add(key);
  }
  return doubleTurns.size > 1 ? 'two Pokémon of one side moved in the same turn (battle log)' : null;
}

/**
 * True when your active Pokémon is down: the reader's flag, 0 HP on screen, a "fnt" status, or
 * its own switch card marked fainted. Unknown HP never counts as fainted (a false positive would
 * hide all move advice).
 */
export function activeFainted(snap: BattleSnapshot): boolean {
  if (snap.forcedSwitch) return true;
  const p = snap.player;
  if (!p) return false;
  if (p.hp !== undefined && p.hp <= 0) return true;
  if (p.status === 'fnt') return true;
  const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return snap.bench.some((r) => r.active && lc(r.name) === lc(p.name) && (r.fainted || (r.hp !== undefined && r.hp <= 0)));
}
