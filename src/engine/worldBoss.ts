import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { Boosts } from '../shared/battle';
import type { BoxMon, Dataset, Move, Npc, NpcMon, NpcTeamVariant } from '../shared/types';
import { boxToCalc, defenderVsNpc, gen, makeField, moveDamage, npcToCalc, repeatable, type MoveDamage } from './damage';
import { npcAttackWeight } from './npcModel';
import { BOSS_RULES, type BattleRules } from './rules';
import { supportEffect, type SupportEffect } from './supportMoves';
import { movesForBox } from './teamSuggest';

/**
 * World Boss counter-team (a damage race against a shared HP pool).
 *
 * Wiki "World Boss Battles" + "Max Moves" (read 2026-11-22, docs/design/wiki-rules-2026-11.md):
 *  - A boss carries a random part of its move pool per appearance (the lobby lists them).
 *  - Boss HP 10,000,000 (Eternamax 100,000,000); the data's "Shared HP" line wins when present.
 *  - Your damage is 125x ordinary, capped at 50,000 per action (Eternamax 350,000).
 *  - Boss attacks deal 55% less (Eternamax 70% less), every boss (confirmed by the wiki).
 *  - Only Gigantamax and Eternamax bosses use Max Moves for every attack; other bosses use their
 *    normal moves (a Max Move only for the phase-3 extra attack, shown as a note).
 *  - Max Barrier: your damage starts at 20% and is full once the boss has lost 40% HP or after
 *    2 minutes (Eternamax: 1% HP or 30 s). The ramp in between is a GUESS (straight line).
 *  - Shields (start, 75%, 40% HP, 20 s): your damage x0.5, status moves on it fail (not counted).
 *  - Healing from damaging moves (drain, Shell Bell) is cut 50/75/90% in phases 1/2/3 and uses the
 *    ordinary (unboosted) damage; Recover-type moves, abilities, items and Bag medicine heal in full.
 *  - Encore, Leech Seed, Curse, Salt Cure fail (rules.ts BOSS_RULES), as do OHKO moves, Destiny Bond,
 *    Perish Song, Endeavor, Pain Split; its attacks hit through Wonder Guard. The boss counts as very
 *    heavy. Poison/burn deal at most 1,000 per tick.
 *  - A phase change clears your Aqua Ring, Ingrain, Focus Energy, Charge, Magnet Rise and the boss's
 *    status and lowered stats; boss boosts are capped at +2 Atk/SpA and +1 Def/SpD.
 *  - Eternamax Overdrive: each Atk/SpA stage adds 75% damage; boosts carry to your next Pokémon.
 * Assumptions (mainline Gen 8): Max Move power from the base power table; Max Moves never miss and
 * have no priority; status moves become Max Guard (not an attack).
 * GUESSES (not checked in a real raid): the GMAX/Eternamax name test, the barrier ramp, the order
 * 125x → Overdrive → barrier → cap, the HP limits of the drain-cut phases, loot tiers.
 */

export type BossForm = 'normal' | 'gmax' | 'eternamax';

/** GUESS from the name only (the data has no form flag): "Eternamax …", "Gigantamax …", "G-Max …". */
export function bossForm(...names: (string | undefined)[]): BossForm {
  const n = names.filter(Boolean).join(' ');
  if (/eternamax/i.test(n)) return 'eternamax';
  if (/gigantamax|(^|[^a-z])g-?max([^a-z]|$)/i.test(n)) return 'gmax';
  return 'normal';
}
export const bossFormOf = (ds: Dataset, mon: Pick<NpcMon, 'name' | 'species'>): BossForm => bossForm(mon.name, ds.species[mon.species]?.name);

/** The rule numbers for one kind of boss: the one place Prep and the Battle tab read them from. */
export interface BossRules {
  /** Every attack is a Max Move (GMAX and Eternamax only). */
  maxMoves: boolean;
  /** Multiplier on the boss's hits (55% / 70% less). */
  hitMult: number;
  /** Shared HP when the data has none. */
  hp: number;
  /** Your damage per action is capped here. */
  cap: number;
  /** The Max Barrier breaks once the boss has lost this share of its HP. */
  barrierBreak: number;
  /** Loot tiers (damage you dealt). */
  tiers: readonly number[];
}

export const BOSS_DAMAGE_MULT = 0.45;
export const ETERNAMAX_DAMAGE_MULT = 0.3;
/** Your damage is this many times ordinary damage. */
export const RAID_MULT = 125;
/** Turn cap for the race: past this, "outlasts it". */
export const BOSS_TURN_CAP = 30;
/** When the data gives no shared HP. */
export const DEFAULT_BOSS_HP = 10_000_000;
export const ETERNAMAX_BOSS_HP = 100_000_000;
/** Your damage while the Max Barrier is fully up. */
export const BARRIER_START = 0.2;
export const LOOT_TIERS: readonly number[] = [50_000, 150_000, 350_000, 750_000];
/** Overdrive (Eternamax): damage added per Atk/SpA stage. */
export const OVERDRIVE_PER_STAGE = 0.75;
/** Healing from damaging moves is cut this much in phases 1, 2, 3. */
export const DRAIN_CUT = [0.5, 0.75, 0.9] as const;
/** "Very heavy": Low Kick / Grass Knot at full power, Heavy Slam / Heat Crash at their weakest. */
export const BOSS_WEIGHT_KG = 9999;

/** Makes the boss's calc Pokémon very heavy (the calc clones from `species`, so the weight goes there too). */
export function asHeavyBoss(p: CalcPokemon): CalcPokemon {
  (p as { species: CalcPokemon['species'] }).species = { ...p.species, weightkg: BOSS_WEIGHT_KG } as CalcPokemon['species'];
  p.weightkg = BOSS_WEIGHT_KG;
  return p;
}

export function bossRules(form: BossForm): BossRules {
  const eterna = form === 'eternamax';
  return {
    maxMoves: form !== 'normal',
    hitMult: eterna ? ETERNAMAX_DAMAGE_MULT : BOSS_DAMAGE_MULT,
    hp: eterna ? ETERNAMAX_BOSS_HP : DEFAULT_BOSS_HP,
    cap: eterna ? 350_000 : 50_000,
    barrierBreak: eterna ? 0.01 : 0.4,
    tiers: eterna ? LOOT_TIERS.map((t) => t * 10) : LOOT_TIERS,
  };
}

/** Share of your damage that gets through the Max Barrier. GUESS: a straight line from 20% to 100%. */
export function barrierMult(lostFrac: number, form: BossForm = 'normal'): number {
  const at = Math.min(1, Math.max(0, lostFrac) / bossRules(form).barrierBreak);
  return BARRIER_START + (1 - BARRIER_START) * at;
}

/** Phase from the share of HP lost: 1 above 75% HP, 2 down to 40%, 3 below (the shield points). */
export const bossPhase = (lostFrac: number): 1 | 2 | 3 => (lostFrac < 0.25 ? 1 : lostFrac < 0.6 ? 2 : 3);

/** HP you get back from a damaging move's drain or Shell Bell: from ordinary damage, cut by phase. */
export function bossDrainHeal(ordinaryDamage: number, share: number, phase: 1 | 2 | 3): number {
  return ordinaryDamage * share * (1 - DRAIN_CUT[phase - 1]);
}

/** Eternamax Overdrive: x(1 + 0.75 per Atk/SpA stage). Lowered stages take the bonus away (never below x1). */
export const overdriveMult = (stage: number) => 1 + OVERDRIVE_PER_STAGE * Math.max(0, stage);

/** What one action of yours takes off the pool: 125x, Overdrive, barrier, then the cap (order is a GUESS). */
export function bossActionDamage(ordinary: number, form: BossForm, opts: { lostFrac?: number; stage?: number; barrierDown?: boolean } = {}): number {
  const od = form === 'eternamax' ? overdriveMult(opts.stage ?? 0) : 1;
  const bar = opts.barrierDown ? 1 : barrierMult(opts.lostFrac ?? 0, form);
  return Math.min(bossRules(form).cap, ordinary * RAID_MULT * od * bar);
}

/** Boss boosts are capped at +2 Atk/SpA and +1 Def/SpD (a copy). */
export function capBossBoosts(b: Boosts): Boosts {
  return { ...b, atk: Math.min(2, b.atk ?? 0), spa: Math.min(2, b.spa ?? 0), def: Math.min(1, b.def ?? 0), spd: Math.min(1, b.spd ?? 0) };
}

/** Loot tiers reached with this much damage (0–4), and the next tier's threshold. */
export function lootTier(damage: number, form: BossForm = 'normal'): { tier: number; next?: number } {
  const tiers = bossRules(form).tiers;
  const tier = tiers.filter((t) => damage >= t).length;
  return { tier, next: tiers[tier] };
}

export const isWorldBoss = (npc?: Npc | null) => npc?.category === 'boss';

/** The shared HP pool, from the data's "Shared HP: 10,000,000" line; else 10M (Eternamax 100M). */
export function bossPool(npc: Npc): number {
  for (const r of npc.requirements) {
    const m = /shared hp:\s*([\d.,\s]+)/i.exec(r);
    if (m) {
      const n = Number(m[1].replace(/[^\d]/g, ''));
      if (n > 0) return n;
    }
  }
  return bossRules(bossForm(npc.name, npc.variants[0]?.team[0]?.name)).hp;
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

/**
 * The dataset as a Max-Move boss's attacks see it: its damaging moves at Max Move power, never missing,
 * no priority. `keep`: ids left as they are (YOUR side uses them too, the Battle tab shares one dataset).
 */
export function bossDs(ds: Dataset, moveIds: readonly string[], keep?: ReadonlySet<string>): Dataset {
  const moves = { ...ds.moves };
  for (const id of moveIds) {
    if (keep?.has(id)) continue;
    const mv = moves[id];
    if (mv && mv.category !== 'Status') moves[id] = { ...mv, power: maxMovePower(mv), accuracy: true, priority: 0 };
  }
  return { ...ds, moves };
}

/** The boss's attacks for its form: Max Moves for GMAX/Eternamax, its normal moves otherwise (same `ds`). */
export function bossAttackDs(ds: Dataset, form: BossForm, moveIds: readonly string[], keep?: ReadonlySet<string>): Dataset {
  return bossRules(form).maxMoves ? bossDs(ds, moveIds, keep) : ds;
}

/** One boss hit with its 55% / 70% cut (the Battle tab's one-turn rows). */
export function cutBossHit<T extends MoveDamage | null | undefined>(d: T, form: BossForm): T {
  if (!d) return d;
  const k = bossRules(form).hitMult;
  const avg = ((d.minPct + d.maxPct) / 2) * k;
  return { ...d, lo: d.lo * k, hi: d.hi * k, minPct: d.minPct * k, maxPct: d.maxPct * k, expectedPct: d.expectedPct * k, hitsToKO: avg > 0 ? Math.ceil(100 / avg) : Infinity, koText: '' };
}

/* ---------------- the race ---------------- */

export interface BossHit {
  moveId: string;
  name: string;
  /** The Max Move it becomes (GMAX / Eternamax bosses only). */
  maxName?: string;
  type: string;
  category: 'Physical' | 'Special';
  /** Expected % of YOUR HP per hit (after the 55% / 70% cut). */
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
  /** Boss HP taken per attacking action with the barrier down (125x, Overdrive, cap; accuracy in, shield not). */
  perTurn: number;
  /** perTurn as % of the shared pool. */
  perTurnPct: number;
  /** Boss hits you take before fainting (BOSS_TURN_CAP = outlasts the race window). */
  turns: number;
  /** Your actions before fainting (speed decides who hits first). */
  actions: number;
  /** Damage dealt before fainting, barrier lowered only by the HP this race takes off (within the turn cap). */
  total: number;
  /** total as % of the shared pool. */
  totalPct: number;
  /** The same race with the barrier already down (other trainers broke it, or 2 minutes passed). */
  totalDown: number;
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
  /** Damage multiplier on the boss's hits (default from its form). */
  damageMult?: number;
  pool?: number;
  /** Default: from the boss's name. */
  form?: BossForm;
}

/** The boss's attacks on one of your Pokémon, with pick chances. */
export function bossHits(ds: Dataset, boss: NpcMon, me: CalcPokemon, opts: BossOptions = {}): BossHit[] {
  const rules = opts.rules ?? BOSS_RULES;
  const form = opts.form ?? bossFormOf(ds, boss);
  const max = bossRules(form).maxMoves;
  const mult = opts.damageMult ?? bossRules(form).hitMult;
  const attacks = repeatable(boss.moves).filter((id) => ds.moves[id] && ds.moves[id].category !== 'Status');
  const bds = bossAttackDs(ds, form, attacks);
  const foe = npcToCalc(bds, boss);
  const target = defenderVsNpc(me, rules);
  const field = makeField('singles');
  const rows = attacks.map((id) => {
    const d = moveDamage(bds, foe, target, id, field);
    const mv = ds.moves[id];
    const pct = d ? ((d.minPct + d.maxPct) / 2) * mult : 0;
    const lo = d ? d.minPct * mult : 0;
    const hi = d ? d.maxPct * mult : 0;
    return { moveId: id, name: mv.name, maxName: max ? maxMoveName(mv) : undefined, type: mv.type, category: mv.category as 'Physical' | 'Special', pct, w: npcAttackWeight(pct, lo, hi, 100) };
  });
  const total = rows.reduce((s, r) => s + r.w, 0) || 1;
  return rows.map(({ w, ...r }) => ({ ...r, prob: w / total })).sort((a, b) => b.pct - a.pct);
}

const STAGE = (n: number) => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n));

function statusOk(status: string, bossTypes: string[], moveId: string, ds: Dataset): boolean {
  if (status === 'slp') return false; // sleep/freeze stop one action, then 20 s immunity: not worth a turn
  if (status === 'brn') return !bossTypes.includes('Fire');
  if (status === 'par') return !bossTypes.includes('Electric') && !(moveId === 'thunderwave' && bossTypes.includes('Ground'));
  if (status === 'psn' || status === 'tox') return !bossTypes.includes('Poison') && !bossTypes.includes('Steel');
  return !!ds;
}

/** One action of yours in the race: ordinary damage (accuracy in), the attack stat's stage, HP drained (share). */
interface Act { ordinary: number; stage: number; drain: number }

interface RaceCtx { form: BossForm; pool: number; maxHp: number; barrierDown?: boolean }

/** Plays the race out: your action and its hit each turn, until you faint or the cap. */
function race(actFor: (t: number) => Act | null, takenFor: (t: number) => number, youFirst: boolean, ctx: RaceCtx) {
  let hp = 100;
  let total = 0;
  let actions = 0;
  let turns = 0;
  for (let t = 1; t <= BOSS_TURN_CAP; t++) {
    if (!youFirst) {
      hp -= takenFor(t);
      if (hp <= 0) { turns = t; break; }
    }
    const a = actFor(t);
    if (a) {
      // Only this race's own damage lowers the barrier here (other trainers' damage is unknown).
      const lost = total / ctx.pool;
      total += bossActionDamage(a.ordinary, ctx.form, { lostFrac: lost, stage: a.stage, barrierDown: ctx.barrierDown });
      if (a.drain) hp = Math.min(100, hp + (100 * bossDrainHeal(a.ordinary, a.drain, bossPhase(lost))) / ctx.maxHp);
    }
    actions++;
    if (youFirst) {
      hp -= takenFor(t);
      if (hp <= 0) { turns = t; break; }
    }
    turns = t;
  }
  return { total, actions, turns: hp > 0 ? BOSS_TURN_CAP : turns };
}

/** Share of the damage a move drains back (from the calc's move data), plus Shell Bell's 1/8. */
function drainShare(moveId: string, item?: string | null): number {
  const d = gen.moves.get(moveId as never)?.drain;
  const bell = item && item.toLowerCase().replace(/[^a-z]/g, '') === 'shellbell' ? 1 / 8 : 0;
  return (d ? d[0] / d[1] : 0) + bell;
}

/** One of your Pokémon in the race: best plan (attack only, or one support move first). */
export function rateBossMember(ds: Dataset, mon: BoxMon, boss: NpcMon, opts: BossOptions = {}): BossMember {
  const rules = opts.rules ?? BOSS_RULES;
  const form = opts.form ?? bossFormOf(ds, boss);
  const pool = opts.pool ?? bossRules(form).hp;
  const me = boxToCalc(ds, mon, opts.levelCap ?? 50);
  const foe = npcToCalc(ds, boss);
  asHeavyBoss(foe);
  const field = makeField('singles');
  const legal = repeatable(movesForBox(ds, mon).filter((id) => !rules.bannedMoves.has(id) && ds.moves[id] && ds.moves[id].category !== 'Status'));
  const best = (atk: CalcPokemon) => {
    let top: { id: string; raw: number; stage: number } | undefined;
    let topDealt = -1;
    for (const id of legal) {
      const d = moveDamage(ds, atk, foe, id, field);
      if (!d) continue;
      const acc = ds.moves[id].accuracy === true ? 1 : (ds.moves[id].accuracy as number) / 100;
      const raw = ((d.lo + d.hi) / 2) * acc;
      const stage = (ds.moves[id].category === 'Physical' ? atk.boosts.atk : atk.boosts.spa) ?? 0;
      const dealt = bossActionDamage(raw, form, { stage, barrierDown: true }) + raw * 1e-9; // equal at the cap: harder hit
      if (dealt > topDealt) { top = { id, raw, stage }; topDealt = dealt; }
    }
    return top;
  };
  const act = (b: { id: string; raw: number; stage: number } | undefined): Act | null => (b ? { ordinary: b.raw, stage: b.stage, drain: drainShare(b.id, mon.item) } : null);
  const hits = bossHits(ds, boss, me, { ...opts, form });
  const takenPct = hits.reduce((s, h) => s + h.prob * h.pct, 0);
  const phys = hits.reduce((s, h) => s + (h.category === 'Physical' ? h.prob * h.pct : 0), 0);
  const spec = takenPct - phys;
  const youFirst = me.stats.spe > foe.stats.spe; // ties counted pessimistically; Max Moves have no priority
  const base = best(me);
  const bossTypes = ds.species[boss.species]?.types ?? [];
  const ctx: RaceCtx = { form, pool, maxHp: me.maxHP() };
  const both = (actFor: (t: number) => Act | null, takenFor: (t: number) => number, first: boolean) => ({
    ...race(actFor, takenFor, first, ctx),
    down: race(actFor, takenFor, first, { ...ctx, barrierDown: true }).total,
  });

  type Option = { plan: BossPlan; move?: { id: string; raw: number; stage: number }; r: ReturnType<typeof both> };
  const options: Option[] = [];
  options.push({ plan: { kind: 'attack', label: 'Attack every turn' }, move: base, r: both(() => act(base), () => takenPct, youFirst) });

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
      const od = form === 'eternamax' && b.stage > 0 ? ` (Overdrive: x${overdriveMult(b.stage)} damage)` : '';
      options.push({ plan: { kind: 'boost', supportMove: id, label: `${name} first, then attack${od}` }, move: b,
        r: both((t) => (t === 1 ? null : act(b)), () => takenPct, spe) });
    } else if (fx.kind === 'screen') {
      const cut = fx.screen === 'reflect' ? phys : spec;
      if (cut <= 0) continue;
      options.push({ plan: { kind: 'screen', supportMove: id, label: `${name} first (halves its ${fx.screen === 'reflect' ? 'physical' : 'special'} hits for 5 turns, your team too)` }, move: base,
        r: both((t) => (t === 1 ? null : act(base)), (t) => (t <= fx.turns ? takenPct - cut / 2 : takenPct), youFirst) });
    } else if (fx.kind === 'debuff') {
      const a = fx.target.atk ?? 0;
      const s = fx.target.spa ?? 0;
      if (a >= 0 && s >= 0) continue;
      const taken = phys * STAGE(a) + spec * STAGE(s);
      options.push({ plan: { kind: 'debuff', supportMove: id, label: `${name} first (lowers its ${a < 0 && s < 0 ? 'Attack and Sp. Atk' : a < 0 ? 'Attack' : 'Sp. Atk'})`, shieldBlocked: true }, move: base,
        r: both((t) => (t === 1 ? null : act(base)), (t) => (t === 1 ? takenPct : taken), youFirst) });
    } else if (fx.kind === 'status') {
      if (fx.yawn || !statusOk(fx.status, bossTypes, id, ds)) continue;
      const taken = fx.status === 'brn' ? phys / 2 + spec : fx.status === 'par' ? takenPct * 0.75 : takenPct;
      if (taken >= takenPct) continue; // poison chip (at most 1,000 a tick) is nothing next to the shared pool
      options.push({ plan: { kind: 'status', supportMove: id, label: `${name} first (${fx.status === 'brn' ? 'burn halves its physical hits' : 'paralysis: it loses ~25% of its turns'})`, shieldBlocked: true }, move: base,
        r: both((t) => (t === 1 ? null : act(base)), (t) => (t === 1 ? takenPct : taken), youFirst) });
    }
  }

  const pick = options.reduce((a, b) => (b.r.total > a.r.total * 1.05 ? b : a), options[0]);
  const notes: string[] = [];
  if (pick.plan.shieldBlocked) notes.push(`${ds.moves[pick.plan.supportMove!].name} fails while its shield is up (start, 75% and 40% HP). A phase change also clears it.`);
  if (pick.plan.kind === 'boost' && form === 'eternamax') notes.push('Overdrive: the boosts carry over to your next Pokémon until your team faints or a phase shockwave (not counted here).');
  if (pick.move && drainShare(pick.move.id, mon.item) > 0) notes.push('Drain and Shell Bell heal is cut 50% / 75% / 90% in phases 1 / 2 / 3 (counted as phase 1 here).');
  if (!base) notes.push('No damaging move that works here.');
  const perTurn = pick.move ? bossActionDamage(pick.move.raw, form, { stage: pick.move.stage, barrierDown: true }) : 0;
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
    totalDown: pick.r.down,
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
  /** How many of your Pokémon (scored) it hits for 50%+ (after the cut). */
  heavy: number;
  /** Highest % of HP it does to one of them. */
  top: number;
  topName?: string;
}

export interface BossSuggestion {
  team: BossMember[];
  ranked: BossMember[];
  /** Damage the team deals before all six faint (within the turn cap each), barrier from this race only. */
  total: number;
  totalPct: number;
  /** The same with the barrier already down. */
  totalDown: number;
  pool: number;
  form: BossForm;
  dangers: BossDanger[];
  notes: string[];
}

/** Counter-team for a World Boss: the six that deal the most damage before fainting. */
export function suggestBossTeam(ds: Dataset, box: BoxMon[], v: NpcTeamVariant, opts: BossOptions & { size?: number; excluded?: readonly string[]; locked?: readonly string[] } = {}): BossSuggestion {
  const boss = v.team[0];
  const form = opts.form ?? bossFormOf(ds, boss);
  const R = bossRules(form);
  const pool = opts.pool ?? R.hp;
  const size = opts.size ?? 6;
  const out = new Set(opts.excluded ?? []);
  const lock = new Set(opts.locked ?? []);
  const ranked = box
    .filter((m) => !out.has(m.uid) && !(opts.levelCap !== undefined && m.level !== undefined && m.level > opts.levelCap))
    .map((m) => rateBossMember(ds, m, boss, { ...opts, pool, form }))
    .sort(byRace);
  const team = [...ranked.filter((m) => lock.has(m.mon.uid)), ...ranked.filter((m) => !lock.has(m.mon.uid))].slice(0, size);
  team.sort(byRace);

  const dangers = new Map<string, BossDanger>();
  for (const m of team) {
    const me = boxToCalc(ds, m.mon, opts.levelCap ?? 50);
    for (const h of bossHits(ds, boss, me, { ...opts, form })) {
      const d = dangers.get(h.moveId) ?? { hit: { moveId: h.moveId, name: h.name, maxName: h.maxName, type: h.type, category: h.category }, heavy: 0, top: 0 };
      if (h.pct >= 50) d.heavy++;
      if (h.pct > d.top) { d.top = h.pct; d.topName = ds.species[m.mon.species]?.name; }
      dangers.set(h.moveId, d);
    }
  }
  const total = team.reduce((s, m) => s + m.total, 0);
  const totalDown = team.reduce((s, m) => s + m.totalDown, 0);
  const eterna = form === 'eternamax';
  const k = (n: number) => `${n / 1000}k`;
  const notes = [
    R.maxMoves
      ? `Every attack it makes is a Max Move (Gen 8 power table, assumed), ${eterna ? '70' : '55'}% less damage.`
      : 'It uses its normal moves at 55% less damage; only the phase-3 extra attack is a Max Move.',
    'Phase 3 (below 40% HP): it adds an extra Max Move every third turn you take. Not counted.',
    `Your damage is ${RAID_MULT}x ordinary, at most ${k(R.cap)} per action.`,
    `Max Barrier: your damage starts at 20% and is full once the boss has lost ${eterna ? '1' : '40'}% HP or after ${eterna ? '30 seconds' : '2 minutes'}. Totals count only your own damage toward it; "barrier down" is the likely number in a busy raid or after ${eterna ? '30 s' : '2 min'}. The ramp is a guess.`,
    'Its shield (start, 75%, 40% HP) halves your damage for 20 seconds and blocks status moves on it. Not counted.',
    'Encore, Leech Seed, Curse and Salt Cure fail. Poison and burn deal at most 1,000 a tick. A phase change clears its status and lowered stats, and your Aqua Ring, Ingrain, Focus Energy, Charge and Magnet Rise; its boosts stop at +2 Atk/SpA, +1 Def/SpD.',
    'Drain and Shell Bell heal from ordinary damage, cut 50/75/90% by phase; Recover-type moves, abilities, items and Bag medicine heal in full.',
    'If you do not act for 20 seconds, it attacks you anyway, every 20 seconds.',
  ];
  if (eterna) notes.push('Overdrive: each Atk/SpA boost stage adds 75% damage and carries to your next Pokémon (until your team faints or a phase shockwave). Above 25 trainers, damage and the cap drop 4% per extra trainer (down to 60%); not counted.');
  if (team.some((m) => m.plan.kind === 'screen')) notes.push('Screens also cover the Pokémon that come in after the setter (not counted in their numbers).');
  return { team, ranked, total, totalPct: (100 * total) / pool, totalDown, pool, form, dangers: [...dangers.values()].sort((a, b) => b.heavy - a.heavy || b.top - a.top), notes };
}
