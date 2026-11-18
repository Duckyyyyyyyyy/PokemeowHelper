import type { Pokemon as CalcPokemon } from '@smogon/calc';

/**
 * Small 1v1 projection helpers shared by the turn advisor (turnAdvisor.ts) and support-move
 * scoring (supportMoves.ts). Damage values are % of each side's max HP per hit.
 */

/** Gen 5+ accuracy/evasion stage multiplier for a net stage n (attacker accuracy − target evasion). */
export function accuracyStageMul(n: number): number {
  const s = Math.max(-6, Math.min(6, n));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

export const stageMul = (b: number) => (b >= 0 ? (2 + b) / 2 : 2 / (2 - b));

/** Speed in battle: stages, Choice Scarf, paralysis, and an extra multiplier (Tailwind ×2). */
export function battleSpeed(p: CalcPokemon, extra = 1): number {
  let s = p.stats.spe * stageMul(p.boosts.spe ?? 0);
  if (p.item === 'Choice Scarf') s *= 1.5;
  if (p.status === 'par') s *= 0.5;
  return s * extra;
}

/** true = you act first, false = they do, null = speed tie. */
export function order(me: CalcPokemon, foe: CalcPokemon, myPrio: number, theirPrio: number, mySpeedMul = 1, foeSpeedMul = 1): boolean | null {
  if (myPrio !== theirPrio) return myPrio > theirPrio;
  const a = battleSpeed(me, mySpeedMul);
  const b = battleSpeed(foe, foeSpeedMul);
  return a === b ? null : a > b;
}

export interface Projection {
  win: boolean;
  /** Your hits needed to KO (Infinity when you can't). */
  myTurns: number;
  /** Their hits needed to KO you. */
  theirTurns: number;
  /** Your HP left when you win, else 0. */
  hpLeft: number;
  /** 0–100: 55+ = you win the 1v1. */
  score: number;
}

/** Projects a 1v1 from current HP%: both sides keep using their best hit. */
export function project(myHit: number, theirHit: number, myHp: number, foeHp: number, youFirst: boolean | null): Projection {
  const myTurns = myHit > 0 ? Math.ceil(foeHp / myHit) : Infinity;
  const theirTurns = theirHit > 0 ? Math.ceil(myHp / theirHit) : Infinity;
  const first = youFirst ?? false; // ties count against you
  const win = myTurns !== Infinity && (first ? myTurns <= theirTurns : myTurns < theirTurns);
  if (win) {
    const hpLeft = Math.max(0, myHp - (first ? myTurns - 1 : myTurns) * theirHit);
    return { win, myTurns, theirTurns, hpLeft, score: 55 + 0.45 * hpLeft };
  }
  const dealt = Math.min(foeHp, (theirTurns === Infinity ? 0 : first ? theirTurns : theirTurns - 1) * myHit);
  return { win, myTurns, theirTurns, hpLeft: 0, score: 0.45 * (foeHp > 0 ? (100 * dealt) / foeHp : 0) };
}
