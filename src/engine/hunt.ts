import type { BoxMon, Dataset, ExploreMap, GameTip, Npc, NpcTeamVariant, WildEncounter } from '../shared/types';
import { REGION_STAGE } from '../data/tips';
import { npcToCalc } from './damage';
import { isFindable, isFishing, METHOD_LABEL } from './explore';
import { evolvedAt, potentialFor, targetLevel, type GrindTeam, type PotentialResult } from './potential';
import { scorePair, type PairResult, type SuggestOptions, type Suggestion } from './teamSuggest';
import { rankBalls, type BallOption } from './catching';

/**
 * "Hunt for <NPC>" (docs/design/hunt-and-grind-spec.md): wild Pokémon worth catching on maps you
 * can reach, imagined at the fight's level with average IVs (15) and the level-up moves it has by
 * then, scored with the Worth grinding scorer. Suggested only when it beats a member of your grind
 * team or answers an NPC Pokémon nobody in your box handles.
 *
 * Reachability is a GUESS (not checked in a real game): MeowRPGAdvisor never asks the game which
 * maps you unlocked. It uses maps seen on the Explore page, Tips you ticked, and the NPC's place on
 * the Tips progress path (fighting a Johto leader → the Kanto Champion is probably beaten).
 */

/* ---------------- reachable maps ---------------- */

/**
 * Explore map → the curated Tips entry that unlocks it (src/data/tips.ts). Written out because a
 * tip's `maps` also lists the map you start from. Maps not listed here need nothing.
 */
export const GATE_TIP: Readonly<Record<string, string>> = {
  'dark-forest': 'map:dark-forest',
  'mt-ember': 'map:mt-ember',
  'moonlit-grove': 'map:mt-ember',
  'dream-forest': 'map:violet-town',
  'fairy-sanctuary': 'map:violet-town',
  'haunted-wood': 'map:graveyard',
  'power-plant': 'map:power-plant',
  'azure-shore': 'map:blue-sea',
  'stone-ridge': 'map:caves',
  'caves-upper': 'map:caves',
  'caves-underground': 'map:caves',
  'sky-meadow': 'map:sky-islands',
  'dragon-sanctuary': 'map:dragons-reach',
  'unown-ruins': 'map:unown-ruins',
  'snow-mountain': 'map:snow-mountain',
  'azure-depths': 'map:underwater',
  'void-wastes': 'map:void',
  'safari-zone': 'map:safari',
  'safari-approach': 'map:safari',
};

/** seen = you were there (Explore page) · ticked = Tips entry ticked · open = needs nothing but finding it · guess = by the NPC's place on the path · locked. */
export type Access = 'seen' | 'ticked' | 'open' | 'guess' | 'locked';
const ACCESS_RANK: Record<Access, number> = { seen: 0, ticked: 0, open: 1, guess: 2, locked: 3 };

export interface MapAccess {
  access: Access;
  /** How to unlock it (the gating Tips entry), when there is one. */
  tip?: GameTip;
  /** "Defeat Sinnoh Champion Cynthia" etc. */
  requires: string[];
}

export interface Progress {
  tips: readonly GameTip[];
  /** Tips ids you ticked. */
  done: ReadonlySet<string>;
  /** Explore map ids seen on the game's encounter card. */
  seenMaps: ReadonlySet<string>;
  /** Path stage you probably passed (see `passedStage`); undefined = unknown. */
  passed?: number;
}

/**
 * Stages of the Tips progress path you have probably passed when you fight this NPC: a League NPC
 * of region n (path stage n) means the Champions before it are beaten (stages < n). GUESS from the
 * suggested region order; other NPCs (Tower, Frontier, bosses…) give no hint (undefined).
 */
export function passedStage(npc: Npc | null | undefined): number | undefined {
  if (!npc || !['gym', 'elite-four', 'champion'].includes(npc.category)) return undefined;
  const stage = REGION_STAGE[(npc.group ?? '').toLowerCase()];
  return stage === undefined ? undefined : stage - 1;
}

export function mapAccess(mapId: string, p: Progress): MapAccess {
  const tipId = GATE_TIP[mapId];
  const tip = tipId ? p.tips.find((t) => t.id === tipId) : undefined;
  const requires = tip?.requires ?? [];
  if (p.seenMaps.has(mapId)) return { access: 'seen', tip, requires };
  if (tip && p.done.has(tip.id)) return { access: 'ticked', tip, requires };
  if (!requires.length) return { access: 'open', tip, requires };
  if (p.passed !== undefined && tip?.stage !== undefined && tip.stage <= p.passed) return { access: 'guess', tip, requires };
  return { access: 'locked', tip, requires };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Explore map for an encounter card's page title ("Grasslands 3" → verdant-trail): the longest map name it starts with. */
export function mapIdForTitle(ds: Dataset, title: string | undefined): string | undefined {
  const t = norm(title ?? '');
  if (!t) return undefined;
  return (ds.wild?.maps ?? []).filter((m) => t.startsWith(norm(m.name))).sort((a, b) => b.name.length - a.name.length)[0]?.id;
}

/** Field gear you are KNOWN to have (ticked Tips, Bag page, a box Pokémon knowing Surf). Unknown ≠ missing. */
export interface Gear {
  surf: boolean;
  rods: ReadonlySet<string>;
}

export function knownGear(done: ReadonlySet<string>, bagIds: ReadonlySet<string>, box: readonly BoxMon[]): Gear {
  const rods = new Set(['oldrod', 'goodrod', 'superrod'].filter((r) => done.has(`item:${r}`) || bagIds.has(r)));
  const surf = done.has('hm:hmsurf') || bagIds.has('hmsurf') || box.some((m) => m.moves.includes('surf'));
  return { surf, rods };
}

/** What an encounter needs that you are not known to have ("Surf", "Old Rod"), else undefined. */
export function gearNeeded(method: string, gear: Gear): string | undefined {
  if (method === 'surf') return gear.surf ? undefined : 'Surf';
  if (isFishing(method)) return gear.rods.has(method) ? undefined : METHOD_LABEL[method] ?? method;
  return undefined;
}

/* ---------------- candidates ---------------- */

export interface HuntWhere {
  map: ExploreMap;
  enc: WildEncounter;
  access: MapAccess;
  /** Gear you are not known to have ("Surf", "Good Rod"). */
  needs?: string;
}

export interface HuntAnswer {
  foe: string;
  move?: string;
  /** Learn level when it is a level-up move learned later. */
  level?: number;
}

export interface HuntPick extends Omit<PotentialResult, 'current' | 'currentWins' | 'why'> {
  /** Species you meet in the wild (mon.species); scored as `evolvedTo` when it evolves by then. */
  where: HuntWhere;
  /** Other reachable spots for this form. */
  otherSpots: number;
  /** Level you catch it at (top of the spawn range, at most the target). */
  catchLevel: number;
  answers: HuntAnswer[];
  /** Grind-team member it would replace, with its potential. */
  beats?: { name: string; potential: number };
  catchRate: number;
  difficulty: 'easy' | 'medium' | 'hard';
  why: string;
}

export interface HuntResult {
  picks: HuntPick[];
  /** NPC Pokémon nobody in your box answers (now or after grinding). */
  gaps: string[];
  /** Every NPC Pokémon has an answer in your box. */
  covered: boolean;
  /** Findable forms left out because their map looks locked (shown with showLocked). */
  lockedForms: number;
  /** Encounters were present at all (false = no map data). */
  hasMaps: boolean;
}

export interface HuntOptions extends SuggestOptions {
  progress: Progress;
  gear: Gear;
  /** Include maps that look locked. */
  showLocked?: boolean;
  /** Team size of the grind team (default 6). */
  size?: number;
  /** Max cards (default 5). */
  limit?: number;
  /** Full calcs after the type/stat prefilter (default 24). */
  shortlist?: number;
}

const AVG_IVS = { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 };
const won = (p: PairResult | undefined) => !!p && (p.duel?.win ?? p.score >= 55);
const chanceOf = (e: WildEncounter) => Math.max(e.day, e.night);
const bstOf = (ds: Dataset, id: number) => {
  const b = ds.species[id]?.baseStats;
  return b ? b.hp + b.atk + b.def + b.spa + b.spd + b.spe : 0;
};

/** Better spot first: reachable before guessed before locked, no missing gear, then the likeliest spawn. */
function betterSpot(a: HuntWhere, b: HuntWhere): number {
  return ACCESS_RANK[a.access.access] - ACCESS_RANK[b.access.access] || Number(!!a.needs) - Number(!!b.needs) || chanceOf(b.enc) - chanceOf(a.enc);
}

export function difficultyOf(catchRate: number): HuntPick['difficulty'] {
  return catchRate >= 120 ? 'easy' : catchRate >= 45 ? 'medium' : 'hard';
}

/**
 * Up to `limit` wild Pokémon to catch and train for this fight. `ready` is the ready-now
 * suggestion (its `ranked` covers the whole box), `grind` the Worth grinding team.
 */
export function huntFor(ds: Dataset, v: NpcTeamVariant, box: readonly BoxMon[], ready: Suggestion, grind: GrindTeam, opts: HuntOptions): HuntResult {
  const level = targetLevel(v);
  const size = opts.size ?? 6;

  // Who in the box already answers each NPC Pokémon (now, or after grinding).
  const handled = v.team.map((_n, j) => ready.ranked.some((c) => c.eligible && won(c.pairs[j])) || [...grind.team, ...grind.more].some((g) => won(g.pairs[j])));
  const gaps = v.team.filter((_n, j) => !handled[j]).map((n) => n.name);

  // Forms you already own (as caught, or as what they become by the target level).
  const owned = new Set<number>();
  for (const b of box) {
    owned.add(b.species);
    owned.add(evolvedAt(ds, b.species, level));
  }

  // Best spot per form it is scored as (Caterpie and Metapod → one Butterfree card).
  const byForm = new Map<number, { where: HuntWhere; spots: number }>();
  let lockedForms = new Set<number>();
  let hasMaps = false;
  for (const map of ds.wild?.maps ?? []) {
    for (const enc of map.encounters) {
      hasMaps = true;
      if (!isFindable(ds, enc) || enc.levels[0] > level || !ds.species[enc.species]) continue;
      const form = evolvedAt(ds, enc.species, level);
      if (owned.has(enc.species) || owned.has(form)) continue;
      const access = mapAccess(map.id, opts.progress);
      if (access.access === 'locked' && !opts.showLocked) {
        lockedForms.add(form);
        continue;
      }
      const where: HuntWhere = { map, enc, access, needs: gearNeeded(enc.method, opts.gear) };
      const prev = byForm.get(form);
      if (!prev) byForm.set(form, { where, spots: 1 });
      else {
        prev.spots++;
        if (betterSpot(where, prev.where) < 0) prev.where = where;
      }
    }
  }
  lockedForms = new Set([...lockedForms].filter((f) => !byForm.has(f)));

  const monOf = (w: HuntWhere): BoxMon => ({
    uid: `hunt:${w.enc.species}`, species: w.enc.species, level: Math.min(w.enc.levels[1], level), moves: [], source: 'manual', ivs: AVG_IVS,
  });

  // Shortlist for the full calc, as in worthGrinding: top by base stats UNION top by type matchup.
  const all = [...byForm.entries()];
  const n = Math.ceil((opts.shortlist ?? 24) / 2);
  const typeAvg = (form: number) => v.team.reduce((s, foe) => s + scorePair(ds, { uid: '', species: form, moves: [] }, foe, opts.rules).score, 0);
  const byStats = [...all].sort((a, b) => bstOf(ds, b[0]) - bstOf(ds, a[0]) || a[0] - b[0]).slice(0, n);
  const byType = all.map((e) => [e, typeAvg(e[0])] as const).sort((a, b) => b[1] - a[1] || a[0][0] - b[0][0]).slice(0, n).map(([e]) => e);
  const pool = [...new Set([...byStats, ...byType])];

  const npcCalc = opts.mode === 'type' ? undefined : v.team.map((m) => npcToCalc(ds, m));
  const full = grind.team.length >= size;
  const weakest = full ? grind.team.reduce((a, b) => (b.potential < a.potential ? b : a)) : undefined;

  const picks: HuntPick[] = [];
  for (const [, { where, spots }] of pool) {
    const mon = monOf(where);
    const p = potentialFor(ds, mon, v, opts, npcCalc, level);
    const fillsGap = v.team.filter((_m, j) => !handled[j] && won(p.pairs[j])).map((m) => m.name);
    const beatsGrind = p.potential >= 45 && (!weakest || p.potential > weakest.potential);
    if (!fillsGap.length && !beatsGrind) continue;
    // Answers: NPC Pokémon it beats 1v1, gaps first, with the move that does it.
    const order = v.team.map((_m, j) => j).sort((a, b) => Number(handled[a]) - Number(handled[b]));
    const answers: HuntAnswer[] = order.filter((j) => won(p.pairs[j])).map((j) => {
      const mine = p.pairs[j].duel?.mine;
      const mc = mine ? p.moves.find((m) => m.moveId === mine.moveId) : undefined;
      return { foe: v.team[j].name, move: mine?.name, level: mc?.source === 'level' && mc.later ? mc.level : undefined };
    });
    const catchRate = ds.species[where.enc.species]?.catchRate ?? 45;
    const beats = beatsGrind && weakest ? { name: ds.species[weakest.mon.species]?.name ?? '?', potential: weakest.potential } : undefined;
    const pick: HuntPick = {
      ...p, fillsGap, where, otherSpots: spots - 1, catchLevel: mon.level!, answers, beats, catchRate, difficulty: difficultyOf(catchRate), why: '',
    };
    pick.why = huntWhy(pick, v.team.length);
    picks.push(pick);
  }
  // A spot that needs gear you may lack, or a map that is only guessed reachable, counts 10 points less.
  const rankOf = (p: HuntPick) => p.potential - (p.where.needs || ACCESS_RANK[p.where.access.access] > ACCESS_RANK.open ? 10 : 0);
  picks.sort((a, b) => b.fillsGap.length - a.fillsGap.length || rankOf(b) - rankOf(a) || betterSpot(a.where, b.where));
  return { picks: picks.slice(0, opts.limit ?? 5), gaps, covered: !gaps.length, lockedForms: lockedForms.size, hasMaps };
}

/** "Answers Salamence and Altaria with Ice Beam (Lv 40)", grouped by move. */
export function huntWhy(p: Pick<HuntPick, 'answers' | 'beats' | 'potential' | 'potentialWins' | 'targetLevel'>, teamSize: number): string {
  const byMove = new Map<string, { foes: string[]; level?: number }>();
  for (const a of p.answers) {
    const k = a.move ?? '';
    if (!byMove.has(k)) byMove.set(k, { foes: [], level: a.level });
    byMove.get(k)!.foes.push(a.foe);
  }
  const list = (xs: string[]) => (xs.length > 2 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(' and '));
  const parts = [...byMove.entries()].slice(0, 2).map(([move, g]) => `${list(g.foes)}${move ? ` with ${move}${g.level ? ` (Lv ${g.level})` : ''}` : ''}`);
  const out: string[] = [];
  if (parts.length) out.push(`Answers ${parts.join('; ')}`);
  out.push(`wins ${p.potentialWins}/${teamSize} 1v1 at Lv ${p.targetLevel}`);
  if (p.beats) out.push(`beats your grind pick ${p.beats.name} (${p.potential} vs ${p.beats.potential})`);
  return out.join(' · ');
}

/** Best ball for it at full HP from your bag (bag unknown: best overall), at the spot you'd catch it. */
export function huntBall(ds: Dataset, p: Pick<HuntPick, 'where' | 'catchLevel'>, owned: ReadonlyMap<string, number> | null): BallOption | null {
  const s = ds.species[p.where.enc.species];
  if (!s) return null;
  const adv = rankBalls(ds, {
    speciesId: s.id, types: s.types, catchRate: s.catchRate ?? 45, level: p.catchLevel, baseSpeed: s.baseStats.spe,
    mapId: p.where.map.id, mapTheme: p.where.map.theme, fishing: isFishing(p.where.enc.method), registered: false,
    moonStone: ds.wild?.moonStone.includes(s.id),
  }, { owned });
  return adv.bestOwned ?? adv.best;
}
