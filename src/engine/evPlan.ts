import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { BoxMon, Dataset, Npc, NpcTeamVariant, StatTable } from '../shared/types';
import { movesForBox, outcomeOf, scoreAgainstTeam, type PairResult, type SuggestOptions } from './teamSuggest';
import { targetLevel } from './potential';

/**
 * EV advice for one Pokémon against one NPC, and where to farm each stat.
 *
 * Rules (wiki "EV Training", read 2026-11-23): up to 252 EVs per stat and 510 in total; every 4 EVs add
 * 1 stat point at Lv 100 (a share of that lower down, about half at Lv 50). EVs come from defeating or
 * catching through the battle controls: wild battles, trainer battles and NPC team battles at actual
 * levels. Live PvP, World Bosses, the Battle Frontier and Quick catch give none. A held Power item adds 8
 * in its stat per knockout or catch; Macho Brace doubles gains instead (one held item, not both).
 * Vitamins add 10 EVs each (also at Lv 100); EV Berries remove 10 each; Fresh-Start Mochi resets all six.
 */

export type StatKey = keyof StatTable;
export const STATS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const EV_MAX_STAT = 252;
export const EV_MAX_TOTAL = 510;
export const STAT_NAME: Record<StatKey, string> = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
export const VITAMIN: Record<StatKey, string> = { hp: 'HP Up', atk: 'Protein', def: 'Iron', spa: 'Calcium', spd: 'Zinc', spe: 'Carbos' };
export const EV_BERRY: Record<StatKey, string> = { hp: 'Pomeg Berry', atk: 'Kelpsy Berry', def: 'Qualot Berry', spa: 'Hondew Berry', spd: 'Grepa Berry', spe: 'Tamato Berry' };
export const POWER_ITEM: Record<StatKey, string> = { hp: 'Power Weight', atk: 'Power Bracer', def: 'Power Belt', spa: 'Power Lens', spd: 'Power Band', spe: 'Power Anklet' };
export const POWER_BONUS = 8;
export const VITAMIN_EVS = 10;
/** NPC categories whose battles give no EVs (wiki): World Bosses and the Battle Frontier. */
const NO_EV_CATEGORIES: ReadonlySet<Npc['category']> = new Set(['boss', 'frontier']);

const zero = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
const spread = (p: Partial<StatTable>): StatTable => ({ ...zero(), ...p });

export interface SpreadResult {
  label: string;
  evs: StatTable;
  wins: number;
  avg: number;
  pairs: PairResult[];
}

export interface EvChange {
  stat: StatKey;
  from: number;
  to: number;
}

export interface EvPlan {
  level: number;
  now: { evs: StatTable; wins: number; avg: number };
  best: SpreadResult;
  /** Every spread tried, best first. */
  ranked: SpreadResult[];
  /** Stats to raise (to > from) or lower (to < from) to reach `best` exactly. */
  changes: EvChange[];
  /** Stats below the spread: raise these. */
  raise: EvChange[];
  /**
   * Only the lowering needed to make room within 510 (EVs in other stats can stay when there is room),
   * taken from the stats with the most extra first.
   */
  lower: EvChange[];
  /** Scored at the fight's level (it is below it now), not its current level. */
  atFightLevel: boolean;
  /** The best spread wins more 1v1, or scores clearly better (+5), than the current EVs. */
  improves: boolean;
}

/** Physical, special or both, from the damaging moves the scorer uses for it. */
export function attackSide(ds: Dataset, mon: BoxMon): ('atk' | 'spa')[] {
  let phys = 0;
  let spec = 0;
  for (const id of movesForBox(ds, mon)) {
    const c = ds.moves[id]?.category;
    if (c === 'Physical') phys++;
    else if (c === 'Special') spec++;
  }
  if (!phys && !spec) return [];
  if (phys === spec) return ['atk', 'spa'];
  return [phys > spec ? 'atk' : 'spa'];
}

/** The common 252/252 spreads (plus a split-bulk one), all within 510 (the last 6 EVs are left out: worth at most 1 point). */
export function spreadCandidates(sides: readonly ('atk' | 'spa')[]): { label: string; evs: StatTable }[] {
  const out: { label: string; evs: StatTable }[] = [];
  for (const a of sides) {
    const n = STAT_NAME[a];
    out.push({ label: `${n} + Speed`, evs: spread({ [a]: 252, spe: 252 }) });
    out.push({ label: `${n} + HP`, evs: spread({ [a]: 252, hp: 252 }) });
  }
  out.push({ label: 'HP + Defense', evs: spread({ hp: 252, def: 252 }) });
  out.push({ label: 'HP + Sp. Def', evs: spread({ hp: 252, spd: 252 }) });
  out.push({ label: 'HP + Speed', evs: spread({ hp: 252, spe: 252 }) });
  out.push({ label: 'HP + split bulk', evs: spread({ hp: 252, def: 128, spd: 128 }) });
  return out;
}

const winsOf = (pairs: PairResult[], tower: boolean) => pairs.filter((p) => outcomeOf(p, tower) === 'win').length;
const avgOf = (pairs: PairResult[]) => (pairs.length ? pairs.reduce((s, p) => s + p.score, 0) / pairs.length : 0);

/** EVs to remove so the spread fits in 510 next to what it keeps; the stats with the most extra go first. */
export function lowerNeeded(cur: StatTable, target: StatTable): EvChange[] {
  const kept = STATS.reduce((s, k) => s + Math.max(cur[k], target[k]), 0);
  let over = kept - EV_MAX_TOTAL;
  const out: EvChange[] = [];
  for (const k of [...STATS].sort((a, b) => cur[b] - target[b] - (cur[a] - target[a]))) {
    if (over <= 0) break;
    const extra = cur[k] - target[k];
    if (extra <= 0) continue;
    const cut = Math.min(extra, over);
    out.push({ stat: k, from: cur[k], to: cur[k] - cut });
    over -= cut;
  }
  return out;
}

/**
 * Scores its current EVs and each spread vs this NPC team: at its level, or at the fight's level when it
 * is below it (EVs are for the fight it will take, and a low level hides what they do).
 */
export function evPlanFor(ds: Dataset, orig: BoxMon, v: NpcTeamVariant, opts: SuggestOptions & { tower?: boolean } = {}, npcCalc?: CalcPokemon[]): EvPlan {
  const tower = !!opts.tower;
  const fight = targetLevel(v);
  const atFightLevel = orig.level !== undefined && orig.level < fight;
  const mon: BoxMon = atFightLevel ? { ...orig, level: fight } : orig;
  const so: SuggestOptions = { ...opts, levelCap: opts.levelCap ?? v.levelCap };
  const cur = spread(orig.evs ?? {});
  const nowPairs = scoreAgainstTeam(ds, { ...mon, evs: cur }, v, so, npcCalc);
  const now = { evs: cur, wins: winsOf(nowPairs, tower), avg: avgOf(nowPairs) };
  const ranked = spreadCandidates(attackSide(ds, mon))
    .map((c) => {
      const pairs = scoreAgainstTeam(ds, { ...mon, evs: c.evs }, v, so, npcCalc);
      return { ...c, pairs, wins: winsOf(pairs, tower), avg: avgOf(pairs) };
    })
    .sort((a, b) => b.wins - a.wins || b.avg - a.avg);
  const best = ranked[0];
  const changes = STATS.filter((k) => best.evs[k] !== cur[k]).map((k) => ({ stat: k, from: cur[k], to: best.evs[k] }));
  const improves = best.wins > now.wins || (best.wins === now.wins && best.avg >= now.avg + 5);
  const raise = changes.filter((c) => c.to > c.from);
  const lower = lowerNeeded(cur, best.evs);
  return { level: mon.level ?? opts.levelCap ?? 50, now, best, ranked, changes, raise, lower, improves, atFightLevel };
}

/* ---------------- where to farm ---------------- */

const RARITY_RANK: Record<string, number> = { common: 0, rare: 1, 'extremely-rare': 2, legendary: 3 };

export interface WildEvSpot {
  species: number;
  name: string;
  /** EVs of this stat per knockout or catch (before a Power item / Macho Brace). */
  amount: number;
  /** Other stats it also gives. */
  also: string[];
  rarity: string;
  maps: string[];
}

/** Wild Pokémon that give this stat, most first, then the commonest. */
export function wildEvSpots(ds: Dataset, stat: StatKey, limit = 3): WildEvSpot[] {
  const by = new Map<number, WildEvSpot & { rank: number; chance: number }>();
  for (const map of ds.wild?.maps ?? []) {
    for (const e of map.encounters) {
      const y = ds.species[e.species]?.evYield;
      if (!y || !y[stat]) continue;
      const cur = by.get(e.species);
      const rank = RARITY_RANK[e.rarity] ?? 2;
      const chance = Math.max(e.day, e.night);
      if (!cur) {
        by.set(e.species, {
          species: e.species, name: ds.species[e.species].name, amount: y[stat],
          also: STATS.filter((k) => k !== stat && y[k]).map((k) => `${y[k]} ${STAT_NAME[k]}`),
          rarity: e.rarity, maps: [map.name], rank, chance,
        });
      } else {
        if (!cur.maps.includes(map.name)) cur.maps.push(map.name);
        if (rank < cur.rank || (rank === cur.rank && chance > cur.chance)) Object.assign(cur, { rarity: e.rarity, rank, chance });
      }
    }
  }
  return [...by.values()]
    .sort((a, b) => b.amount - a.amount || a.rank - b.rank || b.chance - a.chance)
    .slice(0, limit)
    .map(({ rank: _r, chance: _c, ...s }) => s);
}

/** EVs one win against this team gives (sum of species yields); undefined when any yield is unknown. */
export function npcEvTotal(ds: Dataset, v: NpcTeamVariant): StatTable | undefined {
  const t = zero();
  for (const m of v.team) {
    const y = ds.species[m.species]?.evYield;
    if (!y) return undefined;
    for (const k of STATS) t[k] += y[k];
  }
  return t;
}

export interface NpcEvBattle {
  npc: Npc;
  variant: number;
  label: string;
  amount: number;
  total: StatTable;
  topLevel: number;
}

/**
 * NPC battles that give the most of this stat per win (no World Bosses or Frontier: they give no EVs).
 * GUESS: an NPC with a "Rematch" team is farmed through its rematch (the first battle is assumed not
 * repeatable); `maxLevel` drops teams far above the Pokémon.
 */
export function npcEvBattles(ds: Dataset, stat: StatKey, limit = 3, maxLevel?: number): NpcEvBattle[] {
  const out: NpcEvBattle[] = [];
  for (const npc of ds.npcs) {
    if (NO_EV_CATEGORIES.has(npc.category)) continue;
    const hasRematch = npc.variants.some((x) => /rematch/i.test(x.label));
    npc.variants.forEach((v, i) => {
      if (hasRematch && !/rematch/i.test(v.label)) return;
      const total = npcEvTotal(ds, v);
      if (!total || !total[stat]) return;
      const topLevel = Math.max(0, ...v.team.map((m) => m.level ?? 0));
      if (maxLevel !== undefined && topLevel > maxLevel) return;
      out.push({ npc, variant: i, label: v.label, amount: total[stat], total, topLevel });
    });
  }
  return out.sort((a, b) => b.amount - a.amount || a.topLevel - b.topLevel).slice(0, limit);
}

/** Knockouts (or wins) to gain `need` EVs at `per` each: plain, with the stat's Power item (+8), with Macho Brace (×2). */
export function koCount(need: number, per: number): { plain: number; power: number; brace: number } {
  const n = (x: number) => (x > 0 ? Math.ceil(need / x) : Infinity);
  return { plain: n(per), power: n(per + POWER_BONUS), brace: n(per * 2) };
}
