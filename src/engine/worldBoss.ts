import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { BoxMon, Dataset, Move, Npc, NpcMon, NpcTeamVariant } from '../shared/types';
import { boxToCalc, defenderVsNpc, makeField, moveDamage, npcToCalc, repeatable } from './damage';
import { npcAttackWeight } from './npcModel';
import { CHALLENGE_RULES, type BattleRules } from './rules';
import { supportEffect, type SupportEffect } from './supportMoves';
import { movesForBox } from './teamSuggest';

/**
 * World Boss counter-team (a damage race against a shared HP pool).
 *
 * From the game itself (World Boss page code + rules text, read 2026-11-20):
 *  - A boss carries a random part of its move pool per appearance; the details dialog lists
 *    "Moves this appearance" once the game has them.
 *  - "Every attack it makes is a Max Move built from these."
 *  - "It attacks once per turn, with 55% less damage." (UNVERIFIED whether this is every boss or only
 *    Eternamax Overdrive: the line sits next to the Overdrive text. Applied to all bosses, labelled.)
 *  - Phase 3 (below 40% HP): an extra Max Move every third turn you take (not modelled, shown as a note).
 *  - A shield at the start and at 75% / 40% HP halves your damage and blocks status moves and most
 *    secondary effects. "The boss cannot be put to sleep or frozen yet."
 *  - Your OHKO moves, Destiny Bond, Perish Song, Endeavor, Pain Split fail; its attacks hit through
 *    Wonder Guard (rules.ts).
 * Assumptions (mainline Gen 8): Max Move power from the base power table; Max Moves never miss and
 * have no priority; status moves become Max Guard (not an attack).
 */

export const BOSS_DAMAGE_MULT = 0.45;
/** Turn cap for the race: past this, "outlasts it". */
export const BOSS_TURN_CAP = 30;
/** When the data gives no shared HP. */
export const DEFAULT_BOSS_HP = 3_000_000;

export const isWorldBoss = (npc?: Npc | null) => npc?.category === 'boss';

/** The shared HP pool, from the data's "Shared HP: 3,000,000" line. */
export function bossPool(npc: Npc): number {
  for (const r of npc.requirements) {
    const m = /shared hp:\s*([\d.,\s]+)/i.exec(r);
    if (m) {
      const n = Number(m[1].replace(/[^\d]/g, ''));
      if (n > 0) return n;
    }
  }
  return DEFAULT_BOSS_HP;
}

/** Keeps only the moves in `selected` (pool order). Empty or missing selection = the full pool. */
export function bossMovesOf(mon: NpcMon, selected?: readonly string[] | null): string[] {
  if (!selected?.length) return mon.moves;
  const keep = mon.moves.filter((id) => selected.includes(id));
  return keep.length ? keep : mon.moves;
}

/** A copy of the boss's team variant whose Pokémon carry only the selected moves. Never mutates the dataset. */
export function bossVariant(v: NpcTeamVariant, selected?: readonly string[] | null): NpcTeamVariant {
  if (!selected?.length) return v;
  return { ...v, team: v.team.map((m) => ({ ...m, moves: bossMovesOf(m, selected) })) };
}

/* ---------------- Max Moves ---------------- */

const MAX_NAMES: Record<string, string> = {
  Normal: 'Max Strike', Fighting: 'Max Knuckle', Flying: 'Max Airstream', Poison: 'Max Ooze', Ground: 'Max Quake',
  Rock: 'Max Rockfall', Bug: 'Max Flutterby', Ghost: 'Max Phantasm', Steel: 'Max Steelspike', Fire: 'Max Flare',
  Water: 'Max Geyser', Grass: 'Max Overgrowth', Electric: 'Max Lightning', Psychic: 'Max Mindstorm', Ice: 'Max Hailstorm',
  Dragon: 'Max Wyrmwind', Dark: 'Max Darkness', Fairy: 'Max Starfall',
};

export function maxMoveName(mv: Pick<Move, 'type' | 'category'>): string {
  return mv.category === 'Status' ? 'Max Guard' : MAX_NAMES[mv.type] ?? 'Max Move';
}

/** Mainline Gen 8 Max Move power from the base move's power (assumption: the game follows it). */
export function maxMovePower(mv: Pick<Move, 'type' | 'power'>): number {
  const weak = mv.type === 'Fighting' || mv.type === 'Poison';
  const p = mv.power || 100; // variable-power moves: middle of the table
  const steps: [number, number, number][] = [[40, 90, 70], [50, 100, 75], [60, 110, 80], [70, 120, 85], [100, 130, 90], [140, 140, 95]];
  for (const [max, std, low] of steps) if (p <= max) return weak ? low : std;
  return weak ? 100 : 150;
}

/** The dataset as the boss's attacks see it: its damaging moves at Max Move power, never missing, no priority. */
export function bossDs(ds: Dataset, moveIds: readonly string[]): Dataset {
  const moves = { ...ds.moves };
  for (const id of moveIds) {
    const mv = moves[id];
    if (mv && mv.category !== 'Status') moves[id] = { ...mv, power: maxMovePower(mv), accuracy: true, priority: 0 };
  }
  return { ...ds, moves };
}

/* ---------------- the race ---------------- */

export interface BossHit {
  moveId: string;
  name: string;
  maxName: string;
  type: string;
  category: 'Physical' | 'Special';
  /** Expected % of YOUR HP per hit (after the 55% cut). */
  pct: number;
  /** Chance the boss picks it (same weighting as the Battle tab's NPC model). */
  prob: number;
}

export type PlanKind = 'attack' | 'boost' | 'screen' | 'debuff' | 'status';

export interface BossPlan {
  kind: PlanKind;
  /** The support move used on turn 1 (not for 'attack'). */
  supportMove?: string;
  label: string;
  /** Fails while the boss's shield is up (debuffs and status on the boss). */
  shieldBlocked?: boolean;
}

export interface BossMember {
  mon: BoxMon;
  plan: BossPlan;
  /** Your best attack vs the boss (after any setup). */
  moveId?: string;
  moveName?: string;
  /** Expected raw damage per attacking turn (accuracy included, shield not). */
  perTurn: number;
  /** perTurn as % of the shared pool. */
  perTurnPct: number;
  /** Boss hits you take before fainting (BOSS_TURN_CAP = outlasts the race window). */
  turns: number;
  /** Your actions before fainting (speed decides who hits first). */
  actions: number;
  /** Raw damage dealt before fainting (within the turn cap). */
  total: number;
  /** total as % of the shared pool. */
  totalPct: number;
  /** Expected % of your HP per boss turn, before your support. */
  takenPct: number;
  /** The boss's hardest hit on you. */
  worst?: BossHit;
  youFirst: boolean;
  notes: string[];
}

export interface BossOptions {
  levelCap?: number;
  rules?: BattleRules;
  /** Damage multiplier on the boss's hits (default BOSS_DAMAGE_MULT). */
  damageMult?: number;
  pool?: number;
}

/** The boss's attacks on one of your Pokémon, with pick chances. */
export function bossHits(ds: Dataset, boss: NpcMon, me: CalcPokemon, opts: BossOptions = {}): BossHit[] {
  const rules = opts.rules ?? CHALLENGE_RULES;
  const mult = opts.damageMult ?? BOSS_DAMAGE_MULT;
  const attacks = repeatable(boss.moves).filter((id) => ds.moves[id] && ds.moves[id].category !== 'Status');
  const bds = bossDs(ds, attacks);
  const foe = npcToCalc(bds, boss);
  const target = defenderVsNpc(me, rules);
  const field = makeField('singles');
  const rows = attacks.map((id) => {
    const d = moveDamage(bds, foe, target, id, field);
    const mv = ds.moves[id];
    const pct = d ? ((d.minPct + d.maxPct) / 2) * mult : 0;
    const lo = d ? d.minPct * mult : 0;
    const hi = d ? d.maxPct * mult : 0;
    return { moveId: id, name: mv.name, maxName: maxMoveName(mv), type: mv.type, category: mv.category as 'Physical' | 'Special', pct, w: npcAttackWeight(pct, lo, hi, 100) };
  });
  const total = rows.reduce((s, r) => s + r.w, 0) || 1;
  return rows.map(({ w, ...r }) => ({ ...r, prob: w / total })).sort((a, b) => b.pct - a.pct);
}

const STAGE = (n: number) => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n));

function statusOk(status: string, bossTypes: string[], moveId: string, ds: Dataset): boolean {
  if (status === 'slp') return false; // "cannot be put to sleep or frozen yet"
  if (status === 'brn') return !bossTypes.includes('Fire');
  if (status === 'par') return !bossTypes.includes('Electric') && !(moveId === 'thunderwave' && bossTypes.includes('Ground'));
  if (status === 'psn' || status === 'tox') return !bossTypes.includes('Poison') && !bossTypes.includes('Steel');
  return !!ds;
}

/** Plays the race out: your action and its hit each turn, until you faint or the cap. */
function race(perTurnFor: (t: number) => number, takenFor: (t: number) => number, youFirst: boolean) {
  let hp = 100;
  let total = 0;
  let actions = 0;
  let turns = 0;
  for (let t = 1; t <= BOSS_TURN_CAP; t++) {
    if (!youFirst) {
      hp -= takenFor(t);
      if (hp <= 0) { turns = t; break; }
    }
    total += perTurnFor(t);
    actions++;
    if (youFirst) {
      hp -= takenFor(t);
      if (hp <= 0) { turns = t; break; }
    }
    turns = t;
  }
  return { total, actions, turns: hp > 0 ? BOSS_TURN_CAP : turns };
}

/** One of your Pokémon in the race: best plan (attack only, or one support move first). */
export function rateBossMember(ds: Dataset, mon: BoxMon, boss: NpcMon, opts: BossOptions = {}): BossMember {
  const rules = opts.rules ?? CHALLENGE_RULES;
  const pool = opts.pool ?? DEFAULT_BOSS_HP;
  const me = boxToCalc(ds, mon, opts.levelCap ?? 50);
  const foe = npcToCalc(ds, boss);
  const field = makeField('singles');
  const legal = repeatable(movesForBox(ds, mon).filter((id) => !rules.bannedMoves.has(id) && ds.moves[id] && ds.moves[id].category !== 'Status'));
  const best = (atk: CalcPokemon) => {
    let top: { id: string; raw: number } | undefined;
    for (const id of legal) {
      const d = moveDamage(ds, atk, foe, id, field);
      if (!d) continue;
      const acc = ds.moves[id].accuracy === true ? 1 : (ds.moves[id].accuracy as number) / 100;
      const raw = ((d.lo + d.hi) / 2) * acc;
      if (!top || raw > top.raw) top = { id, raw };
    }
    return top;
  };
  const hits = bossHits(ds, boss, me, opts);
  const takenPct = hits.reduce((s, h) => s + h.prob * h.pct, 0);
  const phys = hits.reduce((s, h) => s + (h.category === 'Physical' ? h.prob * h.pct : 0), 0);
  const spec = takenPct - phys;
  const youFirst = me.stats.spe > foe.stats.spe; // ties counted pessimistically; Max Moves have no priority
  const base = best(me);
  const bossTypes = ds.species[boss.species]?.types ?? [];

  type Option = { plan: BossPlan; move?: { id: string; raw: number }; r: ReturnType<typeof race> };
  const options: Option[] = [];
  options.push({ plan: { kind: 'attack', label: 'Attack every turn' }, move: base, r: race(() => base?.raw ?? 0, () => takenPct, youFirst) });

  const own = mon.moves.filter((id) => ds.moves[id]?.category === 'Status' && !rules.bannedMoves.has(id));
  for (const id of own) {
    const fx: SupportEffect | null = supportEffect(ds, id);
    if (!fx) continue;
    const name = ds.moves[id].name;
    if (fx.kind === 'boost') {
      const boosted = me.clone();
      for (const [k, v] of Object.entries(fx.self)) if (v && k in boosted.boosts) (boosted.boosts as Record<string, number>)[k] = Math.min(6, v);
      const b = best(boosted);
      if (!b) continue;
      const spe = (fx.self.spe ?? 0) > 0 ? boosted.stats.spe * STAGE(fx.self.spe ?? 0) > foe.stats.spe : youFirst;
      options.push({ plan: { kind: 'boost', supportMove: id, label: `${name} first, then attack` }, move: b,
        r: race((t) => (t === 1 ? 0 : b.raw), () => takenPct, spe) });
    } else if (fx.kind === 'screen') {
      const cut = fx.screen === 'reflect' ? phys : spec;
      if (cut <= 0) continue;
      options.push({ plan: { kind: 'screen', supportMove: id, label: `${name} first (halves its ${fx.screen === 'reflect' ? 'physical' : 'special'} hits for 5 turns, your team too)` }, move: base,
        r: race((t) => (t === 1 ? 0 : base?.raw ?? 0), (t) => (t <= fx.turns ? takenPct - cut / 2 : takenPct), youFirst) });
    } else if (fx.kind === 'debuff') {
      const a = fx.target.atk ?? 0;
      const s = fx.target.spa ?? 0;
      if (a >= 0 && s >= 0) continue;
      const taken = phys * STAGE(a) + spec * STAGE(s);
      options.push({ plan: { kind: 'debuff', supportMove: id, label: `${name} first (lowers its ${a < 0 && s < 0 ? 'Attack and Sp. Atk' : a < 0 ? 'Attack' : 'Sp. Atk'})`, shieldBlocked: true }, move: base,
        r: race((t) => (t === 1 ? 0 : base?.raw ?? 0), (t) => (t === 1 ? takenPct : taken), youFirst) });
    } else if (fx.kind === 'status') {
      if (fx.yawn || !statusOk(fx.status, bossTypes, id, ds)) continue;
      const taken = fx.status === 'brn' ? phys / 2 + spec : fx.status === 'par' ? takenPct * 0.75 : takenPct;
      if (taken >= takenPct) continue; // poison chip is nothing next to the shared pool
      options.push({ plan: { kind: 'status', supportMove: id, label: `${name} first (${fx.status === 'brn' ? 'burn halves its physical hits' : 'paralysis: it loses ~25% of its turns'})`, shieldBlocked: true }, move: base,
        r: race((t) => (t === 1 ? 0 : base?.raw ?? 0), (t) => (t === 1 ? takenPct : taken), youFirst) });
    }
  }

  const pick = options.reduce((a, b) => (b.r.total > a.r.total * 1.05 ? b : a), options[0]);
  const notes: string[] = [];
  if (pick.plan.shieldBlocked) notes.push(`${ds.moves[pick.plan.supportMove!].name} fails while its shield is up (start, 75% and 40% HP).`);
  if (!base) notes.push('No damaging move that works here.');
  const perTurn = pick.move?.raw ?? 0;
  return {
    mon,
    plan: pick.plan,
    moveId: pick.move?.id,
    moveName: pick.move ? ds.moves[pick.move.id]?.name : undefined,
    perTurn,
    perTurnPct: (100 * perTurn) / pool,
    turns: pick.r.turns,
    actions: pick.r.actions,
    total: pick.r.total,
    totalPct: (100 * pick.r.total) / pool,
    takenPct,
    worst: hits[0],
    youFirst,
    notes,
  };
}

/**
 * Race order: total damage before fainting, then (equal totals, e.g. several that faint before acting)
 * turns survived, then damage per turn, then a stable id.
 */
export function byRace(a: BossMember, b: BossMember): number {
  return b.total - a.total || b.turns - a.turns || b.perTurn - a.perTurn || (a.mon.uid < b.mon.uid ? -1 : a.mon.uid > b.mon.uid ? 1 : 0);
}

export interface BossDanger {
  hit: Omit<BossHit, 'pct' | 'prob'>;
  /** How many of your Pokémon (scored) it hits for 50%+ (after the 55% cut). */
  heavy: number;
  /** Highest % of HP it does to one of them. */
  top: number;
  topName?: string;
}

export interface BossSuggestion {
  team: BossMember[];
  ranked: BossMember[];
  /** Raw damage the team deals before all six faint (within the turn cap each). */
  total: number;
  totalPct: number;
  pool: number;
  dangers: BossDanger[];
  notes: string[];
}

/** Counter-team for a World Boss: the six that deal the most damage before fainting. */
export function suggestBossTeam(ds: Dataset, box: BoxMon[], v: NpcTeamVariant, opts: BossOptions & { size?: number; excluded?: readonly string[]; locked?: readonly string[] } = {}): BossSuggestion {
  const boss = v.team[0];
  const pool = opts.pool ?? DEFAULT_BOSS_HP;
  const size = opts.size ?? 6;
  const out = new Set(opts.excluded ?? []);
  const lock = new Set(opts.locked ?? []);
  const ranked = box
    .filter((m) => !out.has(m.uid) && !(opts.levelCap !== undefined && m.level !== undefined && m.level > opts.levelCap))
    .map((m) => rateBossMember(ds, m, boss, { ...opts, pool }))
    .sort(byRace);
  const team = [...ranked.filter((m) => lock.has(m.mon.uid)), ...ranked.filter((m) => !lock.has(m.mon.uid))].slice(0, size);
  team.sort(byRace);

  const dangers = new Map<string, BossDanger>();
  for (const m of team) {
    const me = boxToCalc(ds, m.mon, opts.levelCap ?? 50);
    for (const h of bossHits(ds, boss, me, opts)) {
      const d = dangers.get(h.moveId) ?? { hit: { moveId: h.moveId, name: h.name, maxName: h.maxName, type: h.type, category: h.category }, heavy: 0, top: 0 };
      if (h.pct >= 50) d.heavy++;
      if (h.pct > d.top) { d.top = h.pct; d.topName = ds.species[m.mon.species]?.name; }
      dangers.set(h.moveId, d);
    }
  }
  const total = team.reduce((s, m) => s + m.total, 0);
  const notes = [
    'Boss attacks are Max Moves (Gen 8 power table, assumed) at 55% less damage (game text; unverified for every boss).',
    'Phase 3 (below 40% HP): it adds an extra Max Move every third turn you take. Not counted.',
    'Its shield (start, 75%, 40% HP) halves your damage for 20 seconds and blocks status moves on it.',
  ];
  if (team.some((m) => m.plan.kind === 'screen')) notes.push('Screens also cover the Pokémon that come in after the setter (not counted in their numbers).');
  return { team, ranked, total, totalPct: (100 * total) / pool, pool, dangers: [...dangers.values()].sort((a, b) => b.heavy - a.heavy || b.top - a.top), notes };
}
