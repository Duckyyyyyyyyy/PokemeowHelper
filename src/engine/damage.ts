import { calculate, Field, Generations, Move as CalcMove, Pokemon as CalcPokemon, toID } from '@smogon/calc';
import type { BoxMon, Dataset, NpcMon, StatTable } from '../shared/types';
import type { BattleRules } from './rules';

/**
 * Damage layer on top of @smogon/calc (Gen 9 mechanics).
 *
 * Verified 2026-11-18: the game's stat formula is the mainline one (Timburr Lv16
 * Modest, IVs/EVs from the box API → 51/30/24/17/20/20, exactly what the game shows).
 * Species stats/types and move power/type/category always come from the GAME's
 * data, so the game's own changes and custom Pokémon are respected.
 */
export const gen = Generations.get(9);

/** Default level used for NPC sets that have none (Frontier Brains). */
export const ASSUMED_NPC_LEVEL = 50;
const PERFECT: StatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function speciesName(ds: Dataset, id: number, fallbackName: string): { name: string; known: boolean } {
  const s = ds.species[id];
  const name = s?.name ?? fallbackName;
  for (const cand of [name, name.replace(/\s+/g, '-')]) {
    const sp = gen.species.get(toID(cand));
    if (sp) return { name: sp.name, known: true };
  }
  return { name: 'Mew', known: false };
}

function validAbility(name?: string) {
  return name && gen.abilities.get(toID(name)) ? name : undefined;
}
function validItem(id?: string | null) {
  const it = id ? gen.items.get(toID(id)) : undefined;
  return it?.name;
}

interface MonInput {
  species: number;
  name: string;
  level: number;
  nature?: string;
  ability?: string;
  item?: string | null;
  ivs?: Partial<StatTable>;
  evs?: Partial<StatTable>;
  gender?: string;
}

function build(ds: Dataset, m: MonInput): CalcPokemon {
  const s = ds.species[m.species];
  const { name } = speciesName(ds, m.species, m.name);
  return new CalcPokemon(gen, name, {
    level: m.level,
    nature: m.nature,
    ability: validAbility(m.ability),
    item: validItem(m.item),
    ivs: { ...PERFECT, ...(m.ivs ?? {}) },
    evs: m.evs ?? {},
    gender: m.gender === 'F' ? 'F' : m.gender === 'M' ? 'M' : undefined,
    // The game's own numbers win over the calc's dex.
    overrides: s ? ({ baseStats: s.baseStats, types: s.types } as any) : undefined,
  });
}

export function npcToCalc(ds: Dataset, m: NpcMon): CalcPokemon {
  return build(ds, {
    species: m.species,
    name: m.name,
    level: m.level ?? ASSUMED_NPC_LEVEL,
    nature: m.nature,
    ability: m.ability ?? m.possibleAbilities?.[0],
    item: m.item,
    ivs: m.ivs,
    evs: m.evs,
    gender: m.gender,
  });
}

/** Manual entries without IVs are assumed average (IV 15); synced ones use their real IVs/EVs. */
export function boxToCalc(ds: Dataset, b: BoxMon, defaultLevel = 50): CalcPokemon {
  return build(ds, {
    species: b.species,
    name: ds.species[b.species]?.name ?? '',
    level: b.level ?? defaultLevel,
    nature: b.nature,
    ability: b.ability,
    item: b.item,
    ivs: b.ivs ?? (b.source === 'game' ? undefined : { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 }),
    evs: b.evs,
    gender: b.gender,
  });
}

function calcMove(ds: Dataset, id: string): CalcMove | null {
  const g = ds.moves[id];
  if (!g || g.category === 'Status') return null;
  const known = gen.moves.get(toID(id));
  const overrides: Record<string, unknown> = {};
  if (!known || known.type !== g.type) overrides.type = g.type;
  if (!known || known.category !== g.category) overrides.category = g.category;
  // Fixed/variable-power moves have power 0 in the game data – keep the calc's logic for those.
  if (g.power > 0 && (!known || known.basePower !== g.power)) overrides.basePower = g.power;
  try {
    return new CalcMove(gen, known ? known.name : 'Tackle', Object.keys(overrides).length ? { overrides: overrides as any } : undefined);
  } catch {
    return null;
  }
}

export interface MoveDamage {
  moveId: string;
  name: string;
  type: string;
  /** Raw HP damage range (before accuracy). */
  lo: number;
  hi: number;
  /** % of the defender's max HP. */
  minPct: number;
  maxPct: number;
  /** Average % × accuracy – used for ranking. */
  expectedPct: number;
  /** Average hits to KO from full HP (Infinity when it does nothing). */
  hitsToKO: number;
  priority: number;
  koText: string;
}

const accOf = (ds: Dataset, id: string) => {
  const a = ds.moves[id]?.accuracy;
  return a === true || a === undefined ? 1 : a / 100;
};

export function moveDamage(ds: Dataset, atk: CalcPokemon, def: CalcPokemon, moveId: string, field?: Field): MoveDamage | null {
  const mv = calcMove(ds, moveId);
  if (!mv) return null;
  let r;
  try {
    r = calculate(gen, atk, def, mv, field);
  } catch {
    return null;
  }
  const [lo, hi] = r.range();
  const hp = def.maxHP();
  const minPct = (lo / hp) * 100;
  const maxPct = (hi / hp) * 100;
  const avg = (minPct + maxPct) / 2;
  let koText = '';
  try {
    koText = hi > 0 ? r.kochance().text : '';
  } catch {
    koText = '';
  }
  return {
    moveId,
    name: ds.moves[moveId]?.name ?? mv.name,
    type: ds.moves[moveId]?.type ?? mv.type,
    lo,
    hi,
    minPct,
    maxPct,
    expectedPct: avg * accOf(ds, moveId),
    hitsToKO: avg > 0 ? Math.ceil(100 / avg) : Infinity,
    priority: ds.moves[moveId]?.priority ?? 0,
    koText,
  };
}

/** Moves that make the user faint: they can't be repeated, so they never "win a 1v1" by spamming. */
export const SELF_KO_MOVES: ReadonlySet<string> = new Set(['selfdestruct', 'explosion', 'mistyexplosion', 'finalgambit', 'memento', 'healingwish', 'lunardance']);
/** Moves a Pokémon can keep using turn after turn (for 1v1 projections). */
/** Moves that fail unless someone is asleep: never a plan for a normal 1v1. */
export const SLEEP_ONLY_MOVES: ReadonlySet<string> = new Set(['snore', 'dreameater']);
export const repeatable = (ids: string[]) => ids.filter((id) => !SELF_KO_MOVES.has(id) && !SLEEP_ONLY_MOVES.has(id));

export function bestMove(ds: Dataset, atk: CalcPokemon, def: CalcPokemon, moveIds: string[], field?: Field): MoveDamage | null {
  let best: MoveDamage | null = null;
  for (const id of moveIds) {
    const d = moveDamage(ds, atk, def, id, field);
    if (d && (!best || d.expectedPct > best.expectedPct)) best = d;
  }
  return best;
}

/** Under challenge rules the NPC's attacks ignore Wonder Guard: hit a copy without it. */
export function defenderVsNpc(me: CalcPokemon, rules?: BattleRules): CalcPokemon {
  if (!rules?.npcIgnoresWonderGuard || me.ability !== 'Wonder Guard') return me;
  const c = me.clone();
  // `undefined` falls back to the species' default ability (Wonder Guard again) when the calc clones it.
  c.ability = 'No Ability' as CalcPokemon['ability'];
  return c;
}

function effectiveSpeed(p: CalcPokemon): number {
  let s = p.stats.spe;
  if (p.item === 'Choice Scarf') s *= 1.5;
  return s;
}

export interface Duel {
  mine: MoveDamage | null;
  theirs: MoveDamage | null;
  /** true = you act first, false = they do, null = speed tie. */
  youFirst: boolean | null;
  win: boolean;
  /** Your HP left at the end (0–100) when you win; their HP left when you lose. */
  hpLeftPct: number;
  score: number;
}

/**
 * Simple 1v1 estimate: both sides spam their best move every turn, average
 * damage, speed/priority decide who hits first. No switching, crits, status
 * or items that heal. Good for ranking, not a full simulator.
 */
export function duel(ds: Dataset, me: CalcPokemon, myMoves: string[], foe: CalcPokemon, foeMoves: string[], field?: Field, rules?: BattleRules): Duel {
  const legal = (ids: string[]) => repeatable(rules?.bannedMoves.size ? ids.filter((id) => !rules.bannedMoves.has(id)) : ids);
  const mine = bestMove(ds, me, foe, legal(myMoves), field);
  const theirs = bestMove(ds, foe, defenderVsNpc(me, rules), legal(foeMoves), field);
  const myAvg = mine ? (mine.minPct + mine.maxPct) / 2 : 0;
  const theirAvg = theirs ? (theirs.minPct + theirs.maxPct) / 2 : 0;

  let youFirst: boolean | null;
  const pMine = mine?.priority ?? 0;
  const pTheirs = theirs?.priority ?? 0;
  if (pMine !== pTheirs) youFirst = pMine > pTheirs;
  else {
    const a = effectiveSpeed(me);
    const b = effectiveSpeed(foe);
    youFirst = a === b ? null : a > b;
  }

  let myTurns = myAvg > 0 ? Math.ceil(100 / myAvg) : Infinity;
  // A Gem is used up by the first hit of its type: only that hit is boosted.
  if (mine && myAvg > 0 && me.item?.endsWith(' Gem')) {
    const plainMe = me.clone();
    plainMe.item = undefined;
    const plain = bestMove(ds, plainMe, foe, legal(myMoves), field);
    const plainAvg = plain ? (plain.minPct + plain.maxPct) / 2 : 0;
    if (plainAvg > 0 && plainAvg < myAvg) myTurns = myAvg >= 100 ? 1 : 1 + Math.ceil((100 - myAvg) / plainAvg);
  }
  const theirTurns = theirAvg > 0 ? Math.ceil(100 / theirAvg) : Infinity;
  const first = youFirst ?? false; // ties are counted pessimistically
  const win = myTurns !== Infinity && (first ? myTurns <= theirTurns : myTurns < theirTurns);

  let hpLeftPct: number;
  let score: number;
  if (win) {
    const hitsTaken = first ? myTurns - 1 : myTurns;
    hpLeftPct = Math.max(0, 100 - hitsTaken * theirAvg);
    score = 55 + 0.45 * hpLeftPct;
  } else {
    const hitsDealt = theirTurns === Infinity ? 0 : first ? theirTurns : theirTurns - 1;
    hpLeftPct = Math.max(0, 100 - hitsDealt * myAvg);
    score = 0.45 * (100 - hpLeftPct);
  }
  return { mine, theirs, youFirst, win, hpLeftPct, score: Math.round(Math.max(0, Math.min(100, score))) };
}

export function makeField(format: 'singles' | 'doubles'): Field {
  return new Field({ gameType: format === 'doubles' ? 'Doubles' : 'Singles' });
}

export function statLine(p: CalcPokemon): string {
  const s = p.stats;
  return `${s.hp}/${s.atk}/${s.def}/${s.spa}/${s.spd}/${s.spe}`;
}
