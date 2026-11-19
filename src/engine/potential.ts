import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { BoxMon, Dataset, Npc, NpcMon, NpcTeamVariant, StatKey, StatTable } from '../shared/types';
import { ASSUMED_NPC_LEVEL, SELF_KO_MOVES, SLEEP_ONLY_MOVES, boxToCalc, duel, makeField, npcToCalc } from './damage';
import { suggestMoveset, type MoveChoice } from './moveset';
import { dsFor, rulesFor } from './rules';
import { baseOf } from './gen3';
import { scoreAgainstTeam, scorePair, type Candidate, type PairResult, type SuggestOptions, type Suggestion } from './teamSuggest';

/**
 * "Worth grinding": how good each of your Pokémon WOULD be once trained to the level this fight
 * allows. The ready-now suggestion scores everything at its current level, so a Lv 12 Snorlax
 * never shows up even when it would carry the fight at the Lv 45 cap.
 *
 * Model: same species (evolution is not in the dataset), its real IVs, nature and CURRENT EVs
 * (EVs only grow with training, so this is a lower bound), the level cap (or the NPC's top
 * level when there is no cap), and the best 4 moves it can have by then:
 *  - moves it knows;
 *  - level-up moves it crosses on the way (free, per the wiki's move-learning rules);
 *  - TMs only when your bag is known and only the ones you own.
 * Level-up moves it already passed are left out (they need an unspent chance or a re-learn cost).
 */

// The game allows levels above 100 (NPC sets go to 120, the box editor too).
const LEVEL_MAX = 120;

/** Level your Pokémon can be trained to for this fight. */
export function targetLevel(v: NpcTeamVariant): number {
  if (v.levelCap) return Math.min(LEVEL_MAX, v.levelCap);
  const top = Math.max(0, ...v.team.map((m) => m.level ?? 0));
  return Math.min(LEVEL_MAX, top || ASSUMED_NPC_LEVEL);
}

/** Its real stats at another level (same IVs, EVs and nature), via the same calc as the damage scorer. */
export function statsAtLevel(ds: Dataset, mon: BoxMon, level: number): StatTable {
  const s = boxToCalc(ds, { ...mon, level }).stats;
  return { hp: s.hp, atk: s.atk, def: s.def, spa: s.spa, spd: s.spd, spe: s.spe };
}

/* ---------------- IVs ---------------- */

export interface IvSummary {
  /** Sum of the 6 IVs (0–186) when known. */
  total?: number;
  grade: 'great' | 'good' | 'average' | 'poor' | 'unknown';
  text: string;
}

const STAT_LABEL: Record<StatKey, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const KEYS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export function ivSummary(mon: BoxMon): IvSummary {
  const iv = mon.ivs;
  if (!iv || KEYS.some((k) => iv[k] === undefined)) {
    const assumed = mon.source === 'game' ? 'assumed 31' : 'assumed 15';
    return { grade: 'unknown', text: `IVs unknown (${assumed})${mon.nature ? ` · ${mon.nature}` : ''}` };
  }
  const total = KEYS.reduce((s, k) => s + (iv[k] ?? 0), 0);
  const pct = total / 186;
  const grade = pct >= 0.85 ? 'great' : pct >= 0.65 ? 'good' : pct >= 0.45 ? 'average' : 'poor';
  const maxed = KEYS.filter((k) => (iv[k] ?? 0) >= 30).map((k) => STAT_LABEL[k]);
  const low = KEYS.filter((k) => (iv[k] ?? 0) <= 10).map((k) => STAT_LABEL[k]);
  const parts = [`IVs ${total}/186 (${grade})`];
  if (maxed.length === 6) parts.push('all 30+');
  else if (maxed.length) parts.push(`max ${maxed.join('/')}`);
  if (low.length) parts.push(`low ${low.join('/')}`);
  if (mon.nature) parts.push(mon.nature);
  return { total, grade, text: parts.join(' · ') };
}

/* ---------------- potential vs one NPC team ---------------- */

export interface PotentialResult {
  mon: BoxMon;
  targetLevel: number;
  levelsNeeded: number;
  /** Average 0–100 vs the NPC team at its current level (same scorer as the team suggestion). */
  current: number;
  potential: number;
  currentWins: number;
  potentialWins: number;
  pairs: PairResult[];
  moves: MoveChoice[];
  ivs: IvSummary;
  /** NPC Pokémon it would answer better than anyone on the ready-now team. */
  fillsGap: string[];
  why: string;
}

export interface PotentialOptions extends SuggestOptions {
  /** TMs in your bag (null/undefined = bag unknown → no TMs). */
  ownedTms?: ReadonlySet<string> | null;
}

/** One Pokémon trained to `level` (default: the fight's target level). */
export function potentialFor(ds: Dataset, mon: BoxMon, v: NpcTeamVariant, opts: PotentialOptions = {}, npcCalc?: CalcPokemon[], level = targetLevel(v)): Omit<PotentialResult, 'current' | 'currentWins' | 'fillsGap' | 'why'> {
  const set = suggestMoveset(ds, mon, v, {
    levelCap: v.levelCap,
    untilLevel: level,
    calcLevel: level,
    // Manual entries without moves: assume it knows its earlier level-up moves.
    passedLevelUps: mon.moves.length ? false : undefined,
    allowTM: !!opts.ownedTms,
    ownedTms: opts.ownedTms ?? null,
    rules: opts.rules,
  });
  const trained: BoxMon = { ...mon, level, moves: set.moves.length ? set.moves.map((m) => m.moveId) : mon.moves };
  const pairs = scoreAgainstTeam(ds, trained, v, { ...opts, levelCap: level }, npcCalc);
  return {
    mon,
    targetLevel: level,
    levelsNeeded: Math.max(0, level - (mon.level ?? level)),
    potential: avg(pairs),
    potentialWins: wins(pairs),
    pairs,
    moves: set.moves,
    ivs: ivSummary(mon),
  };
}

const avg = (pairs: PairResult[]) => (pairs.length ? Math.round(pairs.reduce((s, p) => s + p.score, 0) / pairs.length) : 0);
const wins = (pairs: PairResult[]) => pairs.filter((p) => p.duel?.win ?? p.score >= 55).length;
const ivTotal = (m: BoxMon) => KEYS.reduce((s, k) => s + (m.ivs?.[k] ?? 15), 0);
const bst = (ds: Dataset, m: BoxMon) => {
  const b = ds.species[m.species]?.baseStats;
  return b ? KEYS.reduce((s, k) => s + b[k], 0) : 0;
};

export interface GrindOptions extends PotentialOptions {
  /** How many go in "More candidates" (default 5). */
  more?: number;
  /** How many go through the full damage calc after the prefilter (default 24). */
  shortlist?: number;
}

export interface GrindTeamPick extends PotentialResult {
  /** Didn't pass the "clearly helps" bar: only there so the team has 6. */
  filler?: boolean;
}

export interface GrindTeam {
  /** Up to `size` (default 6) picks, in pick order (coverage greedy). */
  team: GrindTeamPick[];
  /** Next best candidates, by potential. */
  more: GrindTeamPick[];
  /** Why the team is short or has fillers. */
  note?: string;
}

/**
 * A full team to train for this fight. Candidates: one copy per species (best IVs, then highest
 * level) below the target level, ready-now members included. Picks use the same greedy as
 * `suggestTeam`: best potential first, then whoever adds the most vs NPC Pokémon the picks so far
 * don't answer. Candidates that clearly help (potential beats the weakest ready-now member or
 * answers an NPC Pokémon better than that team) go first; others only fill empty slots (`filler`).
 */
export function worthGrinding(ds: Dataset, v: NpcTeamVariant, ready: Suggestion, opts: GrindOptions = {}): GrindTeam {
  const size = opts.size ?? 6;
  const level = targetLevel(v);
  const excluded = new Set(opts.excluded ?? []);
  const current = new Map<string, Candidate>(ready.ranked.map((c) => [c.mon.uid, c]));

  // Best copy per species, below the target level (unknown level = already scored at the cap).
  const bySpecies = new Map<number, BoxMon>();
  for (const c of ready.ranked) {
    const m = c.mon;
    if (excluded.has(m.uid) || m.level === undefined || m.level >= level || !ds.species[m.species]) continue;
    const prev = bySpecies.get(m.species);
    if (!prev || ivTotal(m) > ivTotal(prev) || (ivTotal(m) === ivTotal(prev) && (m.level ?? 0) > (prev.level ?? 0))) bySpecies.set(m.species, m);
  }
  // Shortlist for the full calc: top by base stats (bulky neutral picks like Snorlax win on stats)
  // UNION top by type matchup (a low-stat 4× answer still makes it).
  const all = [...bySpecies.values()];
  const n = Math.ceil(Math.max(opts.shortlist ?? 24, size + (opts.more ?? 5)) / 2);
  const typeAvg = (m: BoxMon) => v.team.reduce((s, foe) => s + scorePair(ds, { ...m, moves: [] }, foe, opts.rules).score, 0);
  const byStats = [...all].sort((a, b) => bst(ds, b) - bst(ds, a) || ivTotal(b) - ivTotal(a)).slice(0, n);
  const byType = all.map((m) => [m, typeAvg(m)] as const).sort((a, b) => b[1] - a[1] || bst(ds, b[0]) - bst(ds, a[0])).slice(0, n).map(([m]) => m);
  const pool = [...new Set([...byStats, ...byType])];

  const npcCalc = opts.mode === 'type' ? undefined : v.team.map((n) => npcToCalc(ds, n));
  const teamBest = v.team.map((_n, j) => Math.max(0, ...ready.team.map((c) => c.pairs[j]?.score ?? 0)));
  const weakest = ready.team.length ? Math.min(...ready.team.map((c) => c.avg)) : 0;
  const full = ready.team.length >= size;

  const good: GrindTeamPick[] = [];
  const rest: GrindTeamPick[] = [];
  for (const mon of pool) {
    const p = potentialFor(ds, mon, v, opts, npcCalc, level);
    const cur = current.get(mon.uid);
    const curAvg = cur?.avg ?? 0;
    const curWins = cur ? wins(cur.pairs) : 0;
    const fillsGap = v.team.filter((_n, j) => p.pairs[j].score >= 55 && p.pairs[j].score >= teamBest[j] + 10).map((n) => n.name);
    const beatsWeakest = !full || p.potential > weakest;
    const helps = p.potential >= curAvg + 5 && p.potential >= 45 && (beatsWeakest || fillsGap.length > 0);
    const why = whyText(ds, p, curWins, v.team.length, fillsGap);
    if (helps) good.push({ ...p, current: curAvg, currentWins: curWins, fillsGap, why });
    else rest.push({ ...p, current: curAvg, currentWins: curWins, fillsGap, filler: true, why: `Filler – weak vs this NPC. ${why}` });
  }
  const byPotential = (a: GrindTeamPick, b: GrindTeamPick) => b.potential - a.potential || b.fillsGap.length - a.fillsGap.length || a.levelsNeeded - b.levelsNeeded;
  good.sort(byPotential);
  rest.sort(byPotential);

  // Greedy coverage, as in suggestTeam: the pick that most raises "best answer per NPC Pokémon".
  const team: GrindTeamPick[] = [];
  const bestPer = v.team.map(() => 0);
  for (const group of [good, rest]) {
    while (team.length < size && group.length) {
      let pick = 0;
      let gain = -1;
      group.forEach((c, i) => {
        const g = c.pairs.reduce((s, p, j) => s + Math.max(0, p.score - bestPer[j]), 0) + c.potential / 1000;
        if (g > gain) {
          gain = g;
          pick = i;
        }
      });
      if (team.length && gain < 1) pick = 0; // nobody adds coverage: highest potential
      const c = group.splice(pick, 1)[0];
      team.push(c);
      c.pairs.forEach((p, j) => (bestPer[j] = Math.max(bestPer[j], p.score)));
    }
  }
  const more = [...good, ...rest].sort(byPotential).slice(0, opts.more ?? 5);

  const fillers = team.filter((c) => c.filler).length;
  let note: string | undefined;
  if (team.length < size)
    note = `Only ${all.length} of your Pokémon ${all.length === 1 ? 'is' : 'are'} below Lv ${level} (one per species; excluded ones left out), so the grind team has ${team.length}.`;
  else if (fillers)
    note = `${fillers} filler${fillers > 1 ? 's' : ''}: only ${team.length - fillers} of your low-level Pokémon clearly beat the ready-now team at Lv ${level}.`;
  return { team, more, note };
}

function whyText(ds: Dataset, p: Omit<PotentialResult, 'current' | 'currentWins' | 'fillsGap' | 'why'>, curWins: number, n: number, fillsGap: string[]): string {
  const parts = [`At Lv ${p.targetLevel} it wins ${p.potentialWins}/${n} 1v1 (now ${curWins}/${n})`];
  if (fillsGap.length) parts.push(`best answer to ${fillsGap.slice(0, 2).join(', ')}${fillsGap.length > 2 ? '…' : ''}`);
  const newMoves = p.moves.filter((m) => m.source === 'level' && m.later);
  if (newMoves.length) parts.push(`learns ${newMoves.slice(0, 2).map((m) => `${m.name} (Lv ${m.level})`).join(', ')}`);
  const b = ds.species[p.mon.species]?.baseStats;
  if (b) {
    const top = KEYS.reduce((a, k) => (b[k] > b[a] ? k : a), 'hp' as StatKey);
    if (b[top] >= 100) parts.push(`base ${STAT_LABEL[top]} ${b[top]}`);
  }
  return parts.join(' · ');
}

/* ---------------- versatility across NPCs ---------------- */

export interface Versatility {
  /** Average share of NPC Pokémon it beats 1v1 when trained to each NPC's level (0–100). */
  score: number;
  /** NPCs where it wins at least half of the 1v1s. */
  good: number;
  /** NPCs it can be used against (not over their level cap). */
  total: number;
}

const npcCalcCache = new WeakMap<NpcMon, CalcPokemon>();
const foeCalc = (ds: Dataset, m: NpcMon) => {
  let c = npcCalcCache.get(m);
  if (!c) npcCalcCache.set(m, (c = npcToCalc(ds, m)));
  return c;
};

/** Must rest a turn after use: `duel` would count them as usable every turn, so they're left out here. */
export const RECHARGE_MOVES: ReadonlySet<string> = new Set(['hyperbeam', 'gigaimpact', 'blastburn', 'frenzyplant', 'hydrocannon', 'rockwrecker', 'roaroftime', 'eternabeam', 'prismaticlaser', 'meteorassault']);

/** Damaging moves it can have by `level` (known + crossed level-up + owned TMs), best one per type, at most `max`. */
export function movePool(ds: Dataset, mon: BoxMon, level: number, ownedTms?: ReadonlySet<string> | null, max = 5): string[] {
  const s = ds.species[mon.species];
  const types = s?.types ?? [];
  const from = mon.moves.length ? (mon.level ?? 0) : 0; // manual entries without moves: assume earlier moves are known
  const ids = new Set<string>(mon.moves);
  for (const [id, l] of s?.levelMoves ?? []) if (l <= level && (l > from || !mon.moves.length)) ids.add(id);
  if (ownedTms) for (const id of s?.machineMoves ?? []) if (ownedTms.has(id)) ids.add(id);
  const bestPerType = new Map<string, { id: string; v: number }>();
  for (const id of ids) {
    const m = ds.moves[id];
    if (!m || m.category === 'Status' || SELF_KO_MOVES.has(id) || SLEEP_ONLY_MOVES.has(id) || RECHARGE_MOVES.has(id)) continue;
    const v = (m.power || 60) * (types.includes(m.type) ? 1.5 : 1) * (m.accuracy === true ? 1 : m.accuracy / 100);
    const prev = bestPerType.get(m.type);
    if (!prev || v > prev.v) bestPerType.set(m.type, { id, v });
  }
  return [...bestPerType.values()].sort((a, b) => b.v - a.v).slice(0, max).map((x) => x.id);
}

/**
 * How often it is a good pick across the NPC list (first team of each NPC, up to `maxTeam` of its
 * Pokémon), trained to each NPC's level. Matches "Snorlax shows up everywhere": bulk + coverage.
 * Costs ~0.5 ms per NPC Pokémon; run it off the main suggestion path.
 */
export function versatility(ds: Dataset, mon: BoxMon, npcs: readonly Npc[], opts: { ownedTms?: ReadonlySet<string> | null; maxTeam?: number } = {}): Versatility {
  let sum = 0;
  let good = 0;
  let total = 0;
  for (const npc of npcs) {
    const v = npc.variants[0];
    if (!v?.team.length) continue;
    const cap = v.levelCap;
    if (cap !== undefined && mon.level !== undefined && mon.level > cap) continue; // can't be used there
    const level = Math.max(mon.level ?? 0, targetLevel(v));
    const rules = rulesFor(npc.category);
    // Each NPC under its own rules: Gen III data only for Battle Frontier Brains.
    const nds = dsFor(baseOf(ds), rules);
    const moves = movePool(nds, mon, level, opts.ownedTms);
    const me = boxToCalc(nds, { ...mon, level });
    const field = makeField(v.format);
    const team = v.team.slice(0, opts.maxTeam ?? 6);
    const w = team.filter((n) => duel(nds, me, moves, foeCalc(nds, n), n.moves, field, rules).win).length;
    total++;
    sum += w / team.length;
    if (w * 2 >= team.length) good++;
  }
  return { score: total ? Math.round((sum / total) * 100) : 0, good, total };
}
