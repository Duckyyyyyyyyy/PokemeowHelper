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
  /** Your side only: move names (with PP) shown on the switch card. */
  moves?: { name: string; pp?: number; maxPp?: number }[];
}

/**
 * One move use from the battle log, e.g. "Opponent’s Onix used Rock Tomb! It dealt 12 damage."
 * Only wording seen in a real battle is parsed; crits/multi-hit lines are flagged, not parsed.
 */
export interface BattleEvent {
  /** Position in the full log (stable while the battle lasts). */
  idx: number;
  turn?: number;
  side: 'player' | 'opponent';
  mon: string;
  move: string;
  /** The other side's active Pokémon when the move was used. */
  target?: string;
  damage?: number;
  missed?: boolean;
  /** The target fainted right after this hit (damage may be capped by its HP). */
  targetFainted?: boolean;
  /** Line has wording we don't model (critical hit, multi-hit…): keep out of damage checks. */
  unusual?: boolean;
  /** Stat stages of attacker and target at that moment. */
  stages: { attacker: Boosts; target: Boosts };
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
