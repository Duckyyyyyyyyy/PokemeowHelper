import type { BoxMon, Dataset, NpcMon, NpcTeamVariant } from '../shared/types';
import { effectiveness } from './typeChart';
import { monAbilities, monTypes } from './analysis';
import { boxToCalc, duel, makeField, npcToCalc, type Duel } from './damage';
import type { Pokemon as CalcPokemon } from '@smogon/calc';
import { abilityVsNpc, type BattleRules } from './rules';

/**
 * Team suggestion. Two scorers, both 0–100 per (your Pokémon, NPC Pokémon) pair:
 *  - 'damage' (default): 1v1 duel estimate with real stats via @smogon/calc (see damage.ts)
 *  - 'type': type matchups only (Phase 1, kept as a fallback and for tests)
 */

export interface AttackOption {
  type: string;
  stab: boolean;
  moveName?: string;
}

export function attackOptions(ds: Dataset, b: BoxMon, rules?: BattleRules): AttackOption[] {
  const types = ds.species[b.species]?.types ?? [];
  const damaging = b.moves.filter((id) => !rules?.bannedMoves.has(id)).map((id) => ds.moves[id]).filter((m) => m && m.category !== 'Status');
  const opts: AttackOption[] = damaging.map((m) => ({ type: m!.type, stab: types.includes(m!.type), moveName: m!.name }));
  // Fewer than 4 moves entered → assume it can still use its own types (STAB).
  if (b.moves.length < 4) for (const t of types) if (!opts.some((o) => o.type === t)) opts.push({ type: t, stab: true });
  return opts;
}

const OFFENSE: [number, number][] = [[4, 100], [2, 80], [1, 50], [0.5, 25], [0.25, 12], [0, 0]];
const DEFENSE: [number, number][] = [[0, 100], [0.25, 95], [0.5, 85], [1, 60], [2, 28], [4, 8]];

function lookup(table: [number, number][], x: number): number {
  for (const [m, s] of table) if (x >= m) return s;
  return table[table.length - 1][1];
}
function defLookup(x: number): number {
  for (const [m, s] of DEFENSE) if (x <= m) return s;
  return DEFENSE[DEFENSE.length - 1][1];
}

export interface PairResult {
  score: number;
  bestHit: { mult: number; option?: AttackOption };
  worstTaken: { mult: number; moveName?: string };
  /** Present in 'damage' mode. */
  duel?: Duel;
}

export function scorePair(ds: Dataset, b: BoxMon, npc: NpcMon, rules?: BattleRules): PairResult {
  const myTypes = ds.species[b.species]?.types ?? [];
  const npcTypes = monTypes(ds, npc);
  const npcAbilities = monAbilities(npc);

  let best: PairResult['bestHit'] = { mult: 0 };
  let bestEff = -1;
  for (const o of attackOptions(ds, b, rules)) {
    const mult = effectiveness(ds.types, o.type, npcTypes, npcAbilities);
    const eff = mult * (o.stab ? 1.5 : 1);
    if (eff > bestEff) {
      bestEff = eff;
      best = { mult, option: o };
    }
  }

  let worst: PairResult['worstTaken'] = { mult: 0 };
  let hasDamaging = false;
  const myAbility = abilityVsNpc(b.ability, rules);
  for (const id of npc.moves) {
    const mv = ds.moves[id];
    if (!mv || mv.category === 'Status') continue; // the rules only ban YOUR moves
    hasDamaging = true;
    const mult = effectiveness(ds.types, mv.type, myTypes, myAbility ? [myAbility] : undefined);
    if (mult > worst.mult || worst.moveName === undefined) worst = { mult, moveName: mv.name };
  }
  if (!hasDamaging) worst = { mult: 0 };

  const off = lookup(OFFENSE, best.mult) + (best.option?.stab && best.mult >= 1 ? 5 : 0);
  const def = defLookup(worst.mult);
  return { score: Math.round(Math.min(100, 0.55 * off + 0.45 * def)), bestHit: best, worstTaken: worst };
}

export interface Candidate {
  mon: BoxMon;
  eligible: boolean;
  /** You pinned it to the team. */
  locked?: boolean;
  reason?: string;
  pairs: PairResult[]; // vs each NPC mon
  avg: number;
}

export interface Suggestion {
  team: Candidate[];
  lead?: Candidate;
  /** Average over NPC Pokémon of the best answer on the suggested team (0–100). */
  coverage: number;
  ranked: Candidate[];
}

/** Moves used for one of your Pokémon: its known damaging moves, else level-up moves it can know at its level. */
export function movesForBox(ds: Dataset, b: BoxMon): string[] {
  const known = b.moves.filter((id) => ds.moves[id] && ds.moves[id].category !== 'Status');
  if (known.length) return b.moves;
  const lv = b.level ?? 100;
  return (ds.species[b.species]?.levelMoves ?? []).filter(([id, l]) => l <= lv && ds.moves[id]?.category !== 'Status').map(([id]) => id);
}

export interface SuggestOptions {
  levelCap?: number;
  size?: number;
  mode?: 'damage' | 'type';
  /** Challenge rule modifiers (see rules.ts). */
  rules?: BattleRules;
  /** uids you pinned: always on the team (if eligible), before the greedy picks. */
  locked?: readonly string[];
  /** uids you never want suggested. */
  excluded?: readonly string[];
}

/** Scores one of your Pokémon against every NPC Pokémon of a team variant. */
export function scoreAgainstTeam(ds: Dataset, mon: BoxMon, v: NpcTeamVariant, opts: SuggestOptions = {}, npcCalc?: CalcPokemon[]): PairResult[] {
  if (opts.mode === 'type') return v.team.map((n) => scorePair(ds, mon, n, opts.rules));
  const field = makeField(v.format);
  const me = boxToCalc(ds, mon, opts.levelCap ?? 50);
  const myMoves = movesForBox(ds, mon);
  const foes = npcCalc ?? v.team.map((n) => npcToCalc(ds, n));
  return v.team.map((n, j) => {
    const typeView = scorePair(ds, mon, n, opts.rules);
    const d = duel(ds, me, myMoves, foes[j], n.moves, field, opts.rules);
    return { ...typeView, score: d.score, duel: d };
  });
}

export function suggestTeam(ds: Dataset, box: BoxMon[], v: NpcTeamVariant, opts: SuggestOptions = {}): Suggestion {
  const size = opts.size ?? 6;
  const npcCalc = opts.mode === 'type' ? undefined : v.team.map((n) => npcToCalc(ds, n));
  const excluded = new Set(opts.excluded ?? []);
  const locked = new Set(opts.locked ?? []);
  const ranked: Candidate[] = box.map((mon) => {
    const pairs = scoreAgainstTeam(ds, mon, v, opts, npcCalc);
    const tooHigh = opts.levelCap !== undefined && mon.level !== undefined && mon.level > opts.levelCap;
    const out = excluded.has(mon.uid);
    return {
      mon,
      eligible: !tooHigh && !out,
      locked: locked.has(mon.uid) && !out,
      reason: tooHigh ? `Over level cap ${opts.levelCap}` : out ? 'Excluded by you' : undefined,
      pairs,
      avg: pairs.length ? Math.round(pairs.reduce((s, p) => s + p.score, 0) / pairs.length) : 0,
    };
  }).sort((a, b) => b.avg - a.avg);

  // Greedy: add the member that most improves "best answer per NPC Pokémon".
  const pool = ranked.filter((c) => c.eligible);
  const team: Candidate[] = [];
  const bestPer = v.team.map(() => 0);
  // Pinned members go in first (highest average first), then the greedy picks fill the rest.
  for (const c of pool.filter((c) => c.locked).slice(0, size)) {
    pool.splice(pool.indexOf(c), 1);
    team.push(c);
    c.pairs.forEach((p, j) => (bestPer[j] = Math.max(bestPer[j], p.score)));
  }
  while (team.length < size && pool.length) {
    let pick = 0;
    let gain = -1;
    pool.forEach((c, i) => {
      const g = c.pairs.reduce((s, p, j) => s + Math.max(0, p.score - bestPer[j]), 0) + c.avg / 1000;
      if (g > gain) {
        gain = g;
        pick = i;
      }
    });
    // Nobody improves coverage any more → fill remaining slots by highest avg (pool is sorted by avg).
    if (team.length && gain < 1) pick = 0;
    const c = pool.splice(pick, 1)[0];
    team.push(c);
    c.pairs.forEach((p, j) => (bestPer[j] = Math.max(bestPer[j], p.score)));
  }

  const lead = team.length ? [...team].sort((a, b) => (b.pairs[0]?.score ?? 0) - (a.pairs[0]?.score ?? 0))[0] : undefined;
  const coverage = bestPer.length ? Math.round(bestPer.reduce((s, x) => s + x, 0) / bestPer.length) : 0;
  return { team, lead, coverage, ranked };
}
