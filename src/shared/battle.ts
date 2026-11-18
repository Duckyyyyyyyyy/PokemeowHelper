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

export interface BattleSnapshot {
  /** Reader schema version, bump when the shape changes. */
  v: 1;
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
}
