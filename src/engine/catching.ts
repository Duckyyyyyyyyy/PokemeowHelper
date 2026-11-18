import type { Dataset, Item } from '../shared/types';

/**
 * Catch odds and ball advice.
 *
 * From the game wiki ("Catching Wild Pokémon", read 2026-11-18):
 *  - bonuses from ball, status and level multiply together;
 *  - asleep/frozen ×2.5, paralyzed/burned/poisoned ×1.5;
 *  - wild Pokémon below Lv 13 get a level bonus (Lv1 ×3.4, Lv5 ×2.6, Lv10 ×1.6 = (36 − 2·Lv)/10);
 *  - a normal catch needs four shake checks, a critical capture one; critical strength by
 *    Pokédex count (31–150 ×0.5 … 601+ ×2.5), doubled by the Catching Charm;
 *  - zero HP cannot be caught; Master Ball always works.
 * The wiki does not spell out the HP term or the shake formula: those follow the mainline
 * games (Gen 6+), so every percentage here is an ESTIMATE and is labelled as such in the UI.
 */

export type StatusCode = '' | 'slp' | 'frz' | 'par' | 'brn' | 'psn' | 'tox';

export function statusBonus(status?: string): number {
  if (status === 'slp' || status === 'frz') return 2.5;
  if (status === 'par' || status === 'brn' || status === 'psn' || status === 'tox') return 1.5;
  return 1;
}

/** Wiki table: Lv1 ×3.4, Lv5 ×2.6, Lv10 ×1.6, Lv13+ none. */
export function levelBonus(level: number): number {
  return level < 13 ? Math.max(1, (36 - 2 * Math.max(1, level)) / 10) : 1;
}

/** Wiki table: critical capture strength by species registered as obtained. */
export function criticalStrength(dexCount: number, charm = false): number {
  const base = dexCount <= 30 ? 0 : dexCount <= 150 ? 0.5 : dexCount <= 300 ? 1 : dexCount <= 450 ? 1.5 : dexCount <= 600 ? 2 : 2.5;
  return charm ? base * 2 : base;
}

export interface CatchInput {
  /** Species catch rate (1–255), after any Heavy-Ball style change. */
  catchRate: number;
  /** Current HP as a fraction of max (0–1]. */
  hpFrac: number;
  level: number;
  status?: string;
  ballMul: number;
  dexCount?: number;
  charm?: boolean;
}

/** Chance that ONE throw catches (0–1). Estimate: see the header comment. */
export function catchChance(i: CatchInput): number {
  if (i.hpFrac <= 0) return 0;
  const hp = Math.min(1, i.hpFrac);
  const a = ((3 - 2 * hp) / 3) * Math.max(1, i.catchRate) * i.ballMul * statusBonus(i.status) * levelBonus(i.level);
  if (a >= 255) return 1;
  const shake = Math.pow(a / 255, 3 / 16);
  const crit = Math.min(1, (Math.min(255, a) * criticalStrength(i.dexCount ?? 0, i.charm)) / 256);
  return crit * shake + (1 - crit) * Math.pow(shake, 4);
}

/** Wiki flee rule after a failed throw (before ball/HP reductions are applied by the caller). */
export function fleeChanceAfterFail(failedThrows: number, legendaryOrShiny = false): number {
  const base = failedThrows <= 1 ? 0 : failedThrows === 2 ? 0.05 : failedThrows === 3 ? 0.1 : 0.2;
  return legendaryOrShiny ? base / 2 : base;
}

/* ---------- balls ---------- */

export interface BallContext {
  types: string[];
  catchRate: number;
  level: number;
  baseSpeed: number;
  speciesId: number;
  mapId?: string;
  mapTheme?: string;
  /** Hooked with a rod. */
  fishing?: boolean;
  /** 18:00–06:00 UTC. */
  night?: boolean;
  /** Battle turn the throw happens on (1 = first turn). */
  turn?: number;
  /** Balls already thrown this encounter. */
  throwsSoFar?: number;
  /** Level of your active Pokémon (Level Ball). */
  myLevel?: number;
  /** Your active Pokémon is the same species with the opposite gender (Love Ball). */
  loveMatch?: boolean;
  /** Species already obtained (Repeat/Park Ball). undefined = unknown. */
  registered?: boolean;
  status?: string;
  moonStone?: boolean;
}

export interface BallEffect {
  /** Multiplier on the catch rate term. */
  mul: number;
  /** Additive change to the species catch rate (Heavy Ball), when known. */
  rateDelta?: number;
  /** Always catches (Master Ball). */
  guaranteed?: boolean;
  /** The bonus depends on something MeowHelper cannot know (weight). */
  unknown?: boolean;
  /** Short reason, e.g. "×3.5 Water type". */
  why: string;
}

const ULTRA_BEASTS: ReadonlySet<number> = new Set([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806]);
const CREATION_TRIO: ReadonlySet<number> = new Set([483, 484, 487]);
/** Maps the wiki's "Caves" (Dusk Ball) refers to. */
export const CAVE_MAPS: ReadonlySet<string> = new Set(['stone-ridge', 'caves-upper', 'caves-underground']);
export const isWaterMap = (ctx: Pick<BallContext, 'mapTheme'>) => ctx.mapTheme === 'water';
export const isUltraBeast = (id: number) => ULTRA_BEASTS.has(id);

/** Balls that exist in the catalog but are never awarded (wiki "Balls you cannot keep"). */
export const NOT_AWARDED: ReadonlySet<string> = new Set(['sportball', 'parkball', 'cherishball', 'strangeball']);

const has = (ctx: BallContext, t: string) => ctx.types.includes(t);
const pick = (cond: boolean, mul: number, yes: string, no = 'no bonus here'): BallEffect => (cond ? { mul, why: yes } : { mul: 1, why: no });
const firstTurn = (ctx: BallContext) => (ctx.turn ?? 1) <= 1 && !(ctx.throwsSoFar ?? 0);

/** Hand-coded from each ball's wiki description (the data file has them only as prose). */
export const BALL_RULES: Record<string, (ctx: BallContext) => BallEffect> = {
  pokeball: () => ({ mul: 1, why: 'standard ×1' }),
  premierball: () => ({ mul: 1, why: 'same as Poké Ball' }),
  greatball: () => ({ mul: 1.5, why: '×1.5' }),
  ultraball: () => ({ mul: 2, why: '×2' }),
  masterball: () => ({ mul: 255, guaranteed: true, why: 'always catches' }),
  safariball: (c) => pick(c.mapId === 'safari-zone', 1.5, '×1.5 on Grass maps (Safari Zone only)', 'Safari Zone only'),
  fastball: (c) => pick(c.baseSpeed >= 100, 4, '×4 base Speed ≥ 100'),
  levelball: (c) => {
    const me = c.myLevel ?? 0;
    if (me >= c.level * 4) return { mul: 8, why: '×8 your Pokémon is 4× its level' };
    if (me >= c.level * 2) return { mul: 4, why: '×4 your Pokémon is 2× its level' };
    if (me > c.level) return { mul: 2, why: '×2 your Pokémon is higher level' };
    return { mul: 1, why: c.myLevel ? 'your Pokémon is not higher level' : 'needs your active Pokémon\'s level' };
  },
  lureball: (c) => pick(!!c.fishing || (has(c, 'Water') && isWaterMap(c)), 4, c.fishing ? '×4 hooked by fishing' : '×4 Water type on a Water map'),
  heavyball: () => ({ mul: 1, unknown: true, why: 'depends on weight (not in the wiki data)' }),
  loveball: (c) => pick(!!c.loveMatch, 8, '×8 same species, opposite gender', 'needs same species, opposite gender'),
  friendball: () => ({ mul: 1, why: '×1 (starts with 150 friendship)' }),
  moonball: (c) => pick(!!c.moonStone, 4, '×4 evolves with a Moon Stone'),
  sportball: (c) => pick(has(c, 'Bug'), 3, '×3 Bug type'),
  netball: (c) => pick(has(c, 'Water') || has(c, 'Bug'), 3.5, '×3.5 Water/Bug type'),
  diveball: (c) => pick(isWaterMap(c), 3.5, '×3.5 on a Water map'),
  nestball: (c) => pick(c.level < 30 && (41 - c.level) / 10 > 1, Math.max(1, (41 - c.level) / 10), `×${(Math.max(1, (41 - c.level) / 10)).toFixed(1)} low level`),
  repeatball: (c) => pick(!!c.registered, 3.5, '×3.5 already in your Pokédex', c.registered === undefined ? 'needs the species in your Pokédex' : 'not in your Pokédex yet'),
  timerball: (c) => {
    const passed = Math.max(0, (c.turn ?? 1) - 1);
    const mul = Math.min(4, 1 + 0.3 * passed);
    return { mul, why: mul > 1 ? `×${mul.toFixed(1)} after ${passed} turns` : '×1 now, ×4 after 10 turns' };
  },
  luxuryball: () => ({ mul: 1, why: '×1 (friendship bonus)' }),
  duskball: (c) => pick(!!c.night || CAVE_MAPS.has(c.mapId ?? ''), 3, c.night ? '×3 at night' : '×3 in Caves', 'only at night or in Caves'),
  healball: () => ({ mul: 1, why: '×1' }),
  quickball: (c) => pick(firstTurn(c), 5, '×5 first throw on turn 1', 'only on the first turn'),
  cherishball: () => ({ mul: 1, why: '×1' }),
  parkball: (c) => pick(!!c.registered, 4, '×4 already in your Pokédex'),
  dreamball: (c) => pick(c.status === 'slp', 4, '×4 while asleep', 'needs it asleep'),
  beastball: (c) => (isUltraBeast(c.speciesId) ? { mul: 5, why: '×5 Ultra Beast' } : { mul: 0.1, why: '×0.1 (not an Ultra Beast)' }),
  strangeball: (c) => pick(has(c, 'Ghost') || has(c, 'Psychic'), 2, '×2 Ghost/Psychic type'),
  hisuianpokeball: () => ({ mul: 1, why: '×1' }),
  hisuiangreatball: () => ({ mul: 1.5, why: '×1.5' }),
  hisuianultraball: () => ({ mul: 2, why: '×2' }),
  featherball: (c) => pick(has(c, 'Flying'), 1.5, '×1.5 Flying type'),
  wingball: (c) => (has(c, 'Flying') ? { mul: 2, why: '×2 Flying type' } : { mul: 1.5, why: '×1.5' }),
  jetball: (c) => (has(c, 'Flying') ? { mul: 3, why: '×3 Flying type' } : { mul: 2, why: '×2' }),
  hisuianheavyball: (c) => (firstTurn(c) ? { mul: 1.5, why: '×1.5 first throw' } : { mul: 1.25, why: '×1.25' }),
  leadenball: (c) => (firstTurn(c) ? { mul: 2.25, why: '×2.25 first throw' } : { mul: 1.75, why: '×1.75' }),
  gigatonball: (c) => (firstTurn(c) ? { mul: 3, why: '×3 first throw' } : { mul: 2.5, why: '×2.5' }),
  originball: (c) => pick(CREATION_TRIO.has(c.speciesId), 4, '×4 Dialga/Palkia/Giratina'),
};

/** Rough value of a ball, for "don't waste a rare ball when a cheap one is as good". */
const COST: Record<string, number> = { pokeball: 1, premierball: 1, hisuianpokeball: 1, greatball: 2, hisuiangreatball: 2, ultraball: 3, hisuianultraball: 3, masterball: 100 };
const costOf = (id: string) => COST[id] ?? 5;

export function ballEffect(ballId: string, ctx: BallContext): BallEffect | null {
  const rule = BALL_RULES[ballId];
  if (!rule) return null;
  const eff = rule(ctx);
  // Wiki: "Other balls except Master Ball have ×0.1 against Ultra Beasts."
  if (isUltraBeast(ctx.speciesId) && ballId !== 'beastball' && ballId !== 'masterball') return { ...eff, mul: eff.mul * 0.1, why: `${eff.why}, ×0.1 vs Ultra Beast` };
  return eff;
}

export interface BallOption {
  id: string;
  name: string;
  effect: BallEffect;
  /** Estimated chance per throw at the given HP/status. */
  chance: number;
  /** In your bag (count), 0 = not owned, undefined = bag not read. */
  count?: number;
  /** Master Ball: kept for legendaries unless this target deserves it. */
  saveIt?: boolean;
  /** Can't be used here or isn't awarded. */
  unavailable?: string;
}

export interface BallAdvice {
  best: BallOption | null;
  /** Best among balls you own (when the bag is known and differs from best). */
  bestOwned: BallOption | null;
  ranked: BallOption[];
}

export interface RankOptions {
  hpFrac?: number;
  dexCount?: number;
  charm?: boolean;
  /** Bag counts by item id; null = bag not read yet. */
  owned?: ReadonlyMap<string, number> | null;
  /** Worth a Master Ball (legendary, shiny…). */
  precious?: boolean;
}

export function ballItems(ds: Dataset): Item[] {
  return Object.values(ds.items).filter((i) => i.category === 'balls' || (!i.category && !!BALL_RULES[i.id]));
}

/**
 * Ranks every ball for this encounter. Balls you own come first in `bestOwned`;
 * a cheaper ball wins a near-tie (within 2 points) so rare balls are not wasted.
 */
export function rankBalls(ds: Dataset, ctx: BallContext, opts: RankOptions = {}): BallAdvice {
  const hpFrac = opts.hpFrac ?? 1;
  const owned = opts.owned;
  const ranked: BallOption[] = [];
  for (const it of ballItems(ds)) {
    const effect = ballEffect(it.id, ctx);
    if (!effect) continue;
    const rate = Math.min(255, Math.max(1, ctx.catchRate + (effect.rateDelta ?? 0)));
    const chance = effect.guaranteed ? 1 : catchChance({ catchRate: rate, hpFrac, level: ctx.level, status: ctx.status, ballMul: effect.mul, dexCount: opts.dexCount, charm: opts.charm });
    let unavailable: string | undefined;
    if (NOT_AWARDED.has(it.id)) unavailable = 'not awarded in the game';
    else if (it.id === 'safariball' && ctx.mapId !== 'safari-zone') unavailable = 'Safari Zone only';
    ranked.push({
      id: it.id,
      name: it.name,
      effect,
      chance,
      count: owned ? owned.get(it.id) ?? 0 : undefined,
      saveIt: it.id === 'masterball' && !opts.precious,
      unavailable,
    });
  }
  ranked.sort((a, b) => b.chance - a.chance || costOf(a.id) - costOf(b.id));
  const usable = (o: BallOption) => !o.unavailable && !o.saveIt && !o.effect.unknown;
  const choose = (list: BallOption[]) => {
    const cands = list.filter(usable);
    if (!cands.length) return null;
    const top = cands[0].chance;
    return cands.filter((o) => o.chance >= top - 0.02).sort((a, b) => costOf(a.id) - costOf(b.id) || b.chance - a.chance)[0];
  };
  const best = choose(ranked);
  const bestOwned = owned ? choose(ranked.filter((o) => (o.count ?? 0) > 0)) : null;
  return { best, bestOwned, ranked };
}
