import { Field, Generations, toID, type Pokemon as CalcPokemon } from '@smogon/calc';
import type { BattleEvent, BoostKey, Boosts } from '../shared/battle';
import type { Dataset } from '../shared/types';
import { bestMove, defenderVsNpc, moveDamage, type MoveDamage } from './damage';
import { accuracyStageMul, order, project, type Projection } from './projection';
import type { BattleRules } from './rules';
import { effectiveness } from './typeChart';
import { BLOCKING_ABILITIES, STATUS_MOVES } from './catchPlan';

/**
 * Phase 4a: scores support moves (stat boosts, stat drops on the target, status, screens, weather,
 * Tailwind, hazards) by comparing two plans with the same 1v1 projection the turn advisor uses:
 *   A: attack now with your best move;
 *   B: use the support move this turn (taking their best hit when they are faster, or the hit
 *      they can still make after the effect when you are faster), then attack with the new
 *      stages / status / field.
 * The score stays on the 0–100 projection scale so it sorts with attacks; the reason says how
 * much better B is (hits to KO, HP left, who wins). Effects that stay on the enemy (stage drops,
 * status) and field effects with turns left also get credit for your remaining team.
 *
 * Effects come from the game's move descriptions (Showdown wording) where they exist; only
 * screens / weather / Tailwind / hazards (no stat or status line) and the status-move flags
 * (powder, type immunity) come from small hand tables.
 */

const gen = Generations.get(9);

export type StatusCode = 'par' | 'brn' | 'psn' | 'tox' | 'slp';
export type WeatherKind = 'Rain' | 'Sun' | 'Sand' | 'Snow' | 'Hail';
export type ScreenKind = 'reflect' | 'lightscreen';
export type HazardKind = 'stealthrock' | 'spikes' | 'toxicspikes';

export type SupportEffect =
  | { kind: 'boost'; self: Boosts }
  | { kind: 'debuff'; target: Boosts }
  | { kind: 'status'; status: StatusCode; yawn?: boolean; powder?: boolean; typeImmune?: boolean }
  | { kind: 'screen'; screen: ScreenKind; turns: number }
  | { kind: 'tailwind'; turns: number }
  | { kind: 'weather'; weather: WeatherKind; turns: number }
  | { kind: 'hazard'; hazard: HazardKind; layers: number };

/** Effects with no stat/status line in the move data. Turn counts are mainline (incl. the turn used). */
const FIELD_MOVES: Record<string, SupportEffect> = {
  reflect: { kind: 'screen', screen: 'reflect', turns: 5 },
  lightscreen: { kind: 'screen', screen: 'lightscreen', turns: 5 },
  tailwind: { kind: 'tailwind', turns: 4 },
  raindance: { kind: 'weather', weather: 'Rain', turns: 5 },
  sunnyday: { kind: 'weather', weather: 'Sun', turns: 5 },
  sandstorm: { kind: 'weather', weather: 'Sand', turns: 5 },
  snowscape: { kind: 'weather', weather: 'Snow', turns: 5 },
  hail: { kind: 'weather', weather: 'Hail', turns: 5 },
  stealthrock: { kind: 'hazard', hazard: 'stealthrock', layers: 1 },
  spikes: { kind: 'hazard', hazard: 'spikes', layers: 3 },
  toxicspikes: { kind: 'hazard', hazard: 'toxicspikes', layers: 2 },
};

/** Stat lines we don't model as a plain boost (HP cost, conditions, random stat, raises the target). */
const NOT_PLAIN: ReadonlySet<string> = new Set(['bellydrum', 'clangoroussoul', 'filletaway', 'acupressure', 'curse', 'swagger', 'flatter', 'venomdrench', 'captivate', 'stockpile', 'spitup', 'swallow',
  // Two-turn charge, faints, switches out, clears your own hazards.
  'geomancy', 'meteorbeam', 'memento', 'partingshot', 'defog']);

const STAT_WORDS: [RegExp, BoostKey][] = [
  [/special attack|sp\. atk/, 'spa'], [/special defense|sp\. def/, 'spd'], [/attack/, 'atk'], [/defense/, 'def'],
  [/speed/, 'spe'], [/accuracy/, 'accuracy'], [/evasion|evasiveness/, 'evasion'],
];
const STAT_LINE = /^(?:has an? (\d+)% chance to )?(raises?|lowers?) the (user|target)'s ([a-z ,.]+?) by (\d+) stages?\.?$/;
const STATUS_LINE = /^has an? (\d+)% chance to (paralyze|burn|badly poison|poison|sleep) the (?:target|foe)\.?$/;
const STATUS_VERB: Record<string, StatusCode> = { paralyze: 'par', burn: 'brn', poison: 'psn', 'badly poison': 'tox', sleep: 'slp' };

function statsIn(list: string): BoostKey[] {
  return list.split(/,\s*(?:and\s+)?|\s+and\s+/).map((part) => STAT_WORDS.find(([re]) => re.test(part))?.[1]).filter((k): k is BoostKey => !!k);
}

/**
 * The support effect of a move, from the game's move data. Status moves: their stat or status line
 * (or the field table). Damaging moves: only a 100% secondary that helps you (Icy Wind, Snarl,
 * Nuzzle, Power-Up Punch); chance effects and drawbacks (Close Combat) are ignored.
 */
export function supportEffect(ds: Dataset, moveId: string): SupportEffect | null {
  const mv = ds.moves[moveId];
  if (!mv || NOT_PLAIN.has(moveId)) return null;
  const isStatus = mv.category === 'Status';
  if (isStatus && FIELD_MOVES[moveId]) return FIELD_MOVES[moveId];
  if (isStatus && STATUS_MOVES[moveId]) {
    const info = STATUS_MOVES[moveId];
    return { kind: 'status', status: info.status, yawn: moveId === 'yawn', powder: info.powder, typeImmune: info.typeImmune };
  }
  const self: Boosts = {};
  const target: Boosts = {};
  let status: StatusCode | undefined;
  for (const raw of mv.description.split(/(?<=\.)\s+/)) {
    const s = raw.trim().toLowerCase();
    const m = STAT_LINE.exec(s);
    if (m) {
      const chance = m[1] ? Number(m[1]) : 100;
      const up = m[2].startsWith('raise');
      const who = m[3];
      const n = Number(m[5]);
      if (chance < 100 || (isStatus && m[1])) continue;
      if (who === 'target' && up) return null; // Swagger-like: helps the target
      if (who === 'user' && !up && !isStatus) continue; // drawback of an attack (Close Combat)
      for (const k of statsIn(m[4])) {
        if (who === 'user') self[k] = (self[k] ?? 0) + (up ? n : -n);
        else target[k] = (target[k] ?? 0) - n;
      }
      continue;
    }
    const st = STATUS_LINE.exec(s);
    if (st && Number(st[1]) >= 100 && !isStatus) status = STATUS_VERB[st[2]];
  }
  if (status) return { kind: 'status', status, typeImmune: true };
  if (Object.keys(target).length) return { kind: 'debuff', target };
  if (Object.values(self).some((v) => (v ?? 0) > 0)) return { kind: 'boost', self };
  return null;
}

/* ---------------- field state from the battle log ---------------- */

export interface SideState {
  reflect?: number;
  lightscreen?: number;
  tailwind?: number;
  /** Safeguard turns left (blocks status). */
  safeguard?: number;
  stealthrock?: boolean;
  spikes?: number;
  toxicspikes?: number;
}
export interface FieldState {
  /** Your side (screens / Tailwind you set; hazards THEY set on you). */
  mine: SideState;
  /** Their side (hazards you set on them, their screens / Safeguard). */
  theirs: SideState;
  weather?: { kind: WeatherKind; turns: number };
  /** Misty Terrain: grounded Pokémon can't get a status. */
  misty?: number;
}

const DURATION: Record<string, number> = { reflect: 5, lightscreen: 5, tailwind: 4, safeguard: 5 };

/**
 * Screens, Tailwind, Safeguard, weather, Misty Terrain and hazards rebuilt from the moves in the log
 * (the battle screen shows no field state). Turns left assume the mainline durations and that
 * every logged use worked; events without a turn number are ignored for timed effects.
 */
export function fieldFromLog(events: BattleEvent[] | undefined, turn: number | undefined, moveId: (name: string) => string | undefined): FieldState {
  const f: FieldState = { mine: {}, theirs: {} };
  for (const e of events ?? []) {
    if (e.missed) continue;
    const id = moveId(e.move);
    if (!id) continue;
    const own = e.side === 'player' ? f.mine : f.theirs;
    const other = e.side === 'player' ? f.theirs : f.mine;
    const left = (d: number) => (e.turn !== undefined && turn !== undefined ? d - (turn - e.turn) : undefined);
    if (id in DURATION) {
      const l = left(DURATION[id]);
      if (l !== undefined && l > 0) own[id as 'reflect' | 'lightscreen' | 'tailwind' | 'safeguard'] = l;
    }
    const fx = FIELD_MOVES[id];
    if (fx?.kind === 'weather') {
      const l = left(fx.turns);
      f.weather = l !== undefined && l > 0 ? { kind: fx.weather, turns: l } : undefined;
    }
    if (id === 'mistyterrain') {
      const l = left(5);
      f.misty = l !== undefined && l > 0 ? l : undefined;
    }
    if (id === 'stealthrock') other.stealthrock = true;
    if (id === 'spikes') other.spikes = Math.min(3, (other.spikes ?? 0) + 1);
    if (id === 'toxicspikes') other.toxicspikes = Math.min(2, (other.toxicspikes ?? 0) + 1);
  }
  return f;
}

/* ---------------- plan A vs plan B ---------------- */

export interface BenchMon {
  name: string;
  calc: CalcPokemon;
  /** Its legal attacking moves. */
  moves: string[];
}

export interface SupportContext {
  ds: Dataset;
  rules: BattleRules;
  me: CalcPokemon;
  /** Accuracy / evasion stages (the calc only keeps atk–spe). */
  myBoosts?: Boosts;
  /** Your legal attacking moves (repeatable). */
  myMoves: string[];
  foe: CalcPokemon;
  foeName: string;
  foeBoosts?: Boosts;
  foeMoves: string[];
  /** Your other healthy Pokémon (later-Pokémon credit for effects that stay on the enemy). */
  bench?: BenchMon[];
  /** NPC Pokémon still to come (hazards). */
  foesLeft?: { name: string; calc: CalcPokemon }[];
  /** The NPC is likely to switch out: stage drops on it would be lost. */
  npcMaySwitch?: boolean;
  field?: FieldState;
}

export interface SupportRating {
  /** null = don't use it now (reason says why). */
  score: number | null;
  reason: string;
  effect: SupportEffect;
  /** Short effect label, e.g. "+2 Atk", "Paralysis", "Reflect". */
  label: string;
  /** Plan B beats attacking now (by score). */
  better: boolean;
  /** Plan A score (attack now). */
  planA: number;
}

/** Guesses (mainline): sleep lasts 1–3 turns → 2; full paralysis 25%; tox chip averaged over ~3 turns. */
export const SLEEP_TURNS = 2;
export const PAR_SKIP = 0.25;
const CHIP: Record<StatusCode, number> = { brn: 100 / 16, psn: 100 / 8, tox: 100 / 8, par: 0, slp: 0 };
/** Setup costs a turn and is riskier than it looks (crits, a switch, a miss we don't see): same −8 as switches and items. */
const SETUP_PENALTY = 8;

interface State {
  me: CalcPokemon;
  foe: CalcPokemon;
  myAcc: number;
  myEva: number;
  foeAcc: number;
  foeEva: number;
  mySpeedMul: number;
  /** Fields seen from your attacks / from theirs (sides swapped). */
  forMe: Field;
  forThem: Field;
  /** % of its max HP the foe loses each turn (burn, poison, sand/hail). */
  foeChip: number;
  /** % of your max HP you lose each turn (sand/hail). */
  myChip: number;
  /** Share of turns it can act (paralysis). */
  foeActs: number;
  /** Turns it sleeps; `sleepDelay` normal turns first (Yawn). */
  foeSleep: number;
  sleepDelay: number;
  /** Limited-time effect: after `turns` more turns, fight on in `without`. */
  expires?: { turns: number; without: State };
}

interface Fx { weather?: WeatherKind; mine: { reflect?: boolean; lightscreen?: boolean }; theirs: { reflect?: boolean; lightscreen?: boolean } }

function mkFields(fx: Fx): { forMe: Field; forThem: Field } {
  const side = (s: Fx['mine']) => ({ isReflect: !!s.reflect, isLightScreen: !!s.lightscreen });
  return {
    forMe: new Field({ gameType: 'Singles', weather: fx.weather, attackerSide: side(fx.mine), defenderSide: side(fx.theirs) }),
    forThem: new Field({ gameType: 'Singles', weather: fx.weather, attackerSide: side(fx.theirs), defenderSide: side(fx.mine) }),
  };
}

const WEATHER_IMMUNE: Partial<Record<WeatherKind, string[]>> = { Sand: ['Rock', 'Ground', 'Steel'], Hail: ['Ice'] };
const weatherChip = (w: WeatherKind | undefined, p: CalcPokemon) => {
  const immune = w ? WEATHER_IMMUNE[w] : undefined;
  return immune && !p.types.some((t) => immune.includes(t)) && p.ability !== 'Magic Guard' && p.ability !== 'Overcoat' ? 100 / 16 : 0;
};

function fxFromField(f: FieldState | undefined): Fx {
  return {
    weather: f?.weather?.kind,
    mine: { reflect: !!f?.mine.reflect, lightscreen: !!f?.mine.lightscreen },
    theirs: { reflect: !!f?.theirs.reflect, lightscreen: !!f?.theirs.lightscreen },
  };
}

function baseState(ctx: SupportContext, me: CalcPokemon, foe: CalcPokemon, fx: Fx, myBoosts?: Boosts): State {
  const fields = mkFields(fx);
  const foeStatus = foe.status as string;
  return {
    me, foe, ...fields,
    myAcc: myBoosts?.accuracy ?? 0, myEva: myBoosts?.evasion ?? 0,
    foeAcc: ctx.foeBoosts?.accuracy ?? 0, foeEva: ctx.foeBoosts?.evasion ?? 0,
    mySpeedMul: ctx.field?.mine.tailwind ? 2 : 1,
    foeChip: (CHIP[foeStatus as StatusCode] ?? 0) + weatherChip(fx.weather, foe),
    myChip: weatherChip(fx.weather, me),
    foeActs: foeStatus === 'par' ? 1 - PAR_SKIP : 1,
    foeSleep: 0, sleepDelay: 0,
  };
}

const avgPct = (d: MoveDamage | null) => (d ? (d.minPct + d.maxPct) / 2 : 0);
const curPct = (p: CalcPokemon) => (100 * p.curHP()) / p.maxHP();

/** Your expected hit: average damage × hit chance (base accuracy × accuracy/evasion stages, capped at 100%). */
function myHitOf(ds: Dataset, d: MoveDamage | null, st: State): number {
  if (!d) return 0;
  const a = ds.moves[d.moveId]?.accuracy;
  const always = a === true || typeof a !== 'number' || a <= 0;
  const chance = always ? 1 : Math.min(1, (a as number) / 100 * accuracyStageMul(st.myAcc - st.foeEva));
  return avgPct(d) * chance;
}

function hits(ctx: SupportContext, st: State, myMoves = ctx.myMoves) {
  const mine = bestMove(ctx.ds, st.me, st.foe, myMoves, st.forMe);
  const theirs = bestMove(ctx.ds, st.foe, defenderVsNpc(st.me, ctx.rules), ctx.foeMoves, st.forThem);
  // Their hit: worst case (no base accuracy) like the threat line, but your evasion / their accuracy drops count.
  const theirMul = Math.min(1, accuracyStageMul(st.foeAcc - st.myEva));
  return {
    mine, theirs,
    myHit: myHitOf(ctx.ds, mine, st) + st.foeChip,
    theirHit: avgPct(theirs) * theirMul * st.foeActs + st.myChip,
    first: order(st.me, st.foe, mine?.priority ?? 0, theirs?.priority ?? 0, st.mySpeedMul),
  };
}

/** The 1v1 from here, with sleep turns and effects that run out. */
function fight(ctx: SupportContext, st: State, myHp: number, foeHp: number, myMoves = ctx.myMoves): Projection {
  const h = hits(ctx, st, myMoves);
  if (st.foeSleep > 0 && h.myHit > 0) {
    // `sleepDelay` normal exchanges (Yawn), then free hits while it sleeps.
    let mine = myHp;
    let theirs = foeHp;
    for (let i = 0; i < st.sleepDelay; i++) {
      if (h.first === false) mine -= h.theirHit;
      theirs -= h.myHit;
      if (theirs <= 0 && mine > 0) return { win: true, myTurns: i + 1, theirTurns: Infinity, hpLeft: mine, score: 55 + 0.45 * mine };
      if (h.first !== false) mine -= h.theirHit;
      if (mine <= 0) return project(h.myHit, h.theirHit, myHp, foeHp, h.first);
    }
    const free = Math.min(st.foeSleep, Math.ceil(theirs / h.myHit));
    theirs -= free * h.myHit;
    if (theirs <= 0) return { win: true, myTurns: st.sleepDelay + free, theirTurns: Infinity, hpLeft: mine, score: 55 + 0.45 * mine };
    const p = project(h.myHit, h.theirHit, mine, theirs, h.first);
    return { ...p, myTurns: p.myTurns + st.sleepDelay + free };
  }
  let p = project(h.myHit, h.theirHit, myHp, foeHp, h.first);
  if (st.expires && Number.isFinite(p.myTurns) && p.myTurns > st.expires.turns) {
    // Blend: the effect helps for `turns` of the fight's turns, the rest is fought without it.
    const n = Math.min(p.myTurns, p.theirTurns);
    if (n > st.expires.turns) {
      const w = hits(ctx, st.expires.without, myMoves);
      const k = st.expires.turns / n;
      p = project(k * h.myHit + (1 - k) * w.myHit, k * h.theirHit + (1 - k) * w.theirHit, myHp, foeHp, h.first);
    }
  }
  return p;
}

const BOOST_LABEL: Record<BoostKey, string> = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva' };
const STATUS_NAME: Record<StatusCode, string> = { par: 'Paralysis', brn: 'Burn', psn: 'Poison', tox: 'Bad poison', slp: 'Sleep' };
const WEATHER_NAME: Record<WeatherKind, string> = { Rain: 'Rain', Sun: 'Sun', Sand: 'Sandstorm', Snow: 'Snow', Hail: 'Hail' };
const HAZARD_NAME: Record<HazardKind, string> = { stealthrock: 'Stealth Rock', spikes: 'Spikes', toxicspikes: 'Toxic Spikes' };

const boostsText = (b: Boosts) => Object.entries(b).map(([k, v]) => `${v! > 0 ? '+' : '−'}${Math.abs(v!)} ${BOOST_LABEL[k as BoostKey]}`).join(' ');

export function effectLabel(e: SupportEffect): string {
  switch (e.kind) {
    case 'boost': return boostsText(e.self);
    case 'debuff': return boostsText(e.target);
    case 'status': return e.yawn ? 'Yawn (sleep next turn)' : STATUS_NAME[e.status];
    case 'screen': return e.screen === 'reflect' ? 'Reflect' : 'Light Screen';
    case 'tailwind': return 'Tailwind';
    case 'weather': return WEATHER_NAME[e.weather];
    case 'hazard': return HAZARD_NAME[e.hazard];
  }
}

const clampStage = (n: number) => Math.max(-6, Math.min(6, n));
const grounded = (p: CalcPokemon) => !p.types.includes('Flying') && p.ability !== 'Levitate' && p.item !== 'Air Balloon';
const STAT_DROP_BLOCKERS = ['Clear Body', 'White Smoke', 'Full Metal Body', 'Mirror Armor'];
const STAT_BLOCKER: Partial<Record<BoostKey, string[]>> = { atk: ['Hyper Cutter'], def: ['Big Pecks'], accuracy: ['Keen Eye', 'Illuminate', "Mind's Eye"] };

/** Why this effect can't work now, or undefined. */
function blocked(ctx: SupportContext, moveId: string, e: SupportEffect, foeTypes: string[]): string | undefined {
  const { ds, foe, me, field } = ctx;
  const mv = ds.moves[moveId];
  const name = ctx.foeName;
  const targetsFoe = e.kind === 'debuff' || e.kind === 'status';
  const flags = gen.moves.get(toID(moveId))?.flags as Record<string, number> | undefined;
  if (targetsFoe && mv.category === 'Status') {
    if (foe.ability === 'Magic Bounce') return `${name}'s Magic Bounce sends it back.`;
    if (foe.ability === 'Good as Gold') return `${name}'s Good as Gold blocks status moves.`;
  }
  if (targetsFoe && flags?.sound && foe.ability === 'Soundproof') return `${name}'s Soundproof blocks sound moves.`;
  switch (e.kind) {
    case 'boost': {
      if (me.ability === 'Contrary') return 'Contrary turns the boost into a drop.';
      const ups = Object.entries(e.self).filter(([, v]) => v! > 0);
      const at = (k: string) => (k === 'accuracy' || k === 'evasion' ? ctx.myBoosts?.[k] ?? 0 : me.boosts[k as 'atk'] ?? 0);
      if (ups.every(([k]) => at(k) >= 6)) return 'Already at +6.';
      return undefined;
    }
    case 'debuff': {
      if (ctx.npcMaySwitch) return `${name} may switch out, and the drop would be lost.`;
      const keys = Object.keys(e.target) as BoostKey[];
      const at = (k: BoostKey) => (k === 'accuracy' || k === 'evasion' ? ctx.foeBoosts?.[k] ?? 0 : foe.boosts[k as 'atk'] ?? 0);
      if (keys.every((k) => at(k) <= -6)) return 'Already at −6.';
      if (STAT_DROP_BLOCKERS.includes(foe.ability ?? '')) return `${name}'s ${foe.ability} stops stat drops.`;
      if (keys.every((k) => STAT_BLOCKER[k]?.includes(foe.ability ?? ''))) return `${name}'s ${foe.ability} stops this drop.`;
      if (foe.ability === 'Defiant' || foe.ability === 'Competitive' || foe.ability === 'Contrary') return `${name}'s ${foe.ability} turns stat drops against you.`;
      return undefined;
    }
    case 'status': {
      if (foe.status) return `${name} already has a status.`;
      if (e.powder && (foeTypes.includes('Grass') || foe.ability === 'Overcoat')) return `${name} is immune to powder moves.`;
      if (e.typeImmune && effectiveness(ds.types, mv.type, foeTypes) === 0) return `${name} is immune to ${mv.type} moves.`;
      if (e.status === 'par' && foeTypes.includes('Electric')) return 'Electric types cannot be paralyzed.';
      if (e.status === 'brn' && foeTypes.includes('Fire')) return 'Fire types cannot be burned.';
      if ((e.status === 'psn' || e.status === 'tox') && (foeTypes.includes('Poison') || foeTypes.includes('Steel')) && me.ability !== 'Corrosion') return 'Poison and Steel types cannot be poisoned.';
      if (BLOCKING_ABILITIES[e.status].includes(foe.ability ?? '')) return `${name}'s ${foe.ability} prevents it.`;
      if (field?.theirs.safeguard) return `${name}'s side has Safeguard up.`;
      if (field?.misty && grounded(foe)) return 'Misty Terrain blocks status on grounded Pokémon.';
      return undefined;
    }
    case 'screen': return field?.mine[e.screen] ? `${e.screen === 'reflect' ? 'Reflect' : 'Light Screen'} is already up.` : undefined;
    case 'tailwind': return field?.mine.tailwind ? 'Tailwind is already up.' : undefined;
    case 'weather': return field?.weather?.kind === e.weather ? `${WEATHER_NAME[e.weather]} is already up.` : undefined;
    case 'hazard': {
      const now = e.hazard === 'stealthrock' ? (field?.theirs.stealthrock ? 1 : 0) : field?.theirs[e.hazard] ?? 0;
      if (now >= e.layers) return `${HAZARD_NAME[e.hazard]} is already set.`;
      if (!ctx.foesLeft?.length) return 'No Pokémon left on their side to switch in.';
      return undefined;
    }
  }
}

/** State after the effect lands. `turnsUsed` = turns of a timed effect already spent (incl. this one). */
function applyEffect(st: State, e: SupportEffect, fx: Fx, turnsUsed: number): { st: State; fx: Fx } {
  const me = st.me.clone();
  const foe = st.foe.clone();
  const next: State = { ...st, me, foe };
  let nfx: Fx = { ...fx, mine: { ...fx.mine }, theirs: { ...fx.theirs } };
  switch (e.kind) {
    case 'boost':
      for (const [k, v] of Object.entries(e.self) as [BoostKey, number][]) {
        if (k === 'accuracy') next.myAcc = clampStage(next.myAcc + v);
        else if (k === 'evasion') next.myEva = clampStage(next.myEva + v);
        else me.boosts[k] = clampStage((me.boosts[k] ?? 0) + v);
      }
      break;
    case 'debuff':
      for (const [k, v] of Object.entries(e.target) as [BoostKey, number][]) {
        if (k === 'accuracy') next.foeAcc = clampStage(next.foeAcc + v);
        else if (k === 'evasion') next.foeEva = clampStage(next.foeEva + v);
        else foe.boosts[k] = clampStage((foe.boosts[k] ?? 0) + v);
      }
      break;
    case 'status':
      if (e.status === 'slp') {
        next.foeSleep = SLEEP_TURNS;
        next.sleepDelay = e.yawn ? 1 : 0;
        if (!e.yawn) foe.status = 'slp';
      } else {
        foe.status = e.status;
        next.foeChip += CHIP[e.status];
        if (e.status === 'par') next.foeActs = 1 - PAR_SKIP;
      }
      break;
    case 'screen':
      nfx.mine[e.screen] = true;
      break;
    case 'tailwind':
      next.mySpeedMul = 2;
      break;
    case 'weather':
      nfx = { ...nfx, weather: e.weather };
      next.foeChip = next.foeChip - weatherChip(fx.weather, foe) + weatherChip(e.weather, foe);
      next.myChip = weatherChip(e.weather, me);
      break;
    case 'hazard':
      break;
  }
  if (nfx !== fx) Object.assign(next, mkFields(nfx));
  if (e.kind === 'screen' || e.kind === 'tailwind' || e.kind === 'weather') {
    const left = e.turns - turnsUsed;
    next.expires = left > 0 ? { turns: left, without: { ...st, me: next.me, foe: next.foe } } : undefined;
    if (left <= 0) return { st: { ...st, me: next.me, foe: next.foe }, fx };
  }
  return { st: next, fx: nfx };
}

const hitWord = (n: number) => `${n} hit${n === 1 ? '' : 's'}`;

/** Effect on your other Pokémon: debuffs, status and field effects stay after your active one is gone. */
function laterCredit(ctx: SupportContext, e: SupportEffect, fx: Fx, turnsUsed: number, foeHp: number): { bonus: number; text?: string } {
  if (!ctx.bench?.length || e.kind === 'boost' || e.kind === 'hazard') return { bonus: 0 };
  if (e.kind === 'status' && e.status === 'slp') return { bonus: 0 }; // it wakes up before they come in
  let best: { bonus: number; text: string } | undefined;
  for (const b of ctx.bench) {
    const st0 = baseState(ctx, b.calc, ctx.foe, fx);
    const { st: st1 } = applyEffect(st0, e, fx, turnsUsed);
    if (((e.kind === 'screen' || e.kind === 'tailwind' || e.kind === 'weather') && !st1.expires)) continue;
    const hp = curPct(b.calc);
    const before = fight(ctx, st0, hp, foeHp, b.moves);
    const after = fight(ctx, st1, hp, foeHp, b.moves);
    const saved = Number.isFinite(before.myTurns) && Number.isFinite(after.myTurns) ? before.myTurns - after.myTurns : 0;
    const flip = !before.win && after.win;
    // Only a matchup it then wins counts (10 hits → 5 in a lost 1v1 helps nobody).
    const bonus = after.win ? Math.min(25, 10 * Math.max(0, saved) + (flip ? 15 : 0)) : 0;
    if (bonus <= 0 || (best && best.bonus >= bonus)) continue;
    const text = saved > 0
      ? `lets ${b.name} KO in ${hitWord(after.myTurns)} instead of ${before.myTurns}${flip ? ' and win' : ''}`
      : `lets ${b.name} win its 1v1`;
    best = { bonus, text };
  }
  return best ?? { bonus: 0 };
}

/**
 * Your boosts stay while you stay in: after winning this 1v1 at `hpB` (boosted) instead of `hpA`,
 * how much better do you do against their remaining Pokémon (each comes in free after a KO)?
 */
function sweepCredit(ctx: SupportContext, stB: State, hpB: number, hpA: number): { bonus: number; text?: string } {
  const left = ctx.foesLeft ?? [];
  if (!left.length || hpB <= 0) return { bonus: 0 };
  let winsA = 0;
  let winsB = 0;
  let diff = 0;
  for (const f of left) {
    const fx: Fx = { mine: {}, theirs: {} };
    const plain = baseState(ctx, ctx.me, f.calc, fx, ctx.myBoosts);
    const boosted: State = { ...baseState(ctx, stB.me, f.calc, fx), myAcc: stB.myAcc, myEva: stB.myEva };
    const a = hpA > 0 ? fight(ctx, plain, hpA, curPct(f.calc)) : { score: 0, win: false };
    const b = fight(ctx, boosted, hpB, curPct(f.calc));
    winsA += a.win ? 1 : 0;
    winsB += b.win ? 1 : 0;
    diff += b.score - a.score;
  }
  const bonus = Math.round(Math.max(0, Math.min(20, (0.4 * diff) / left.length)));
  if (bonus <= 0) return { bonus: 0 };
  const text = winsB > winsA ? `then beats ${winsB} of their ${left.length} other Pokémon instead of ${winsA}` : 'and stronger against their next Pokémon';
  return { bonus, text };
}

function hazardChip(ctx: SupportContext, h: HazardKind, layersNow: number): { total: number; parts: string[] } {
  const parts: string[] = [];
  let total = 0;
  for (const f of ctx.foesLeft ?? []) {
    let chip = 0;
    if (h === 'stealthrock') chip = 12.5 * effectiveness(ctx.ds.types, 'Rock', f.calc.types);
    else if (h === 'spikes' && grounded(f.calc)) chip = [12.5, 16.7, 25][Math.min(2, layersNow)] - [0, 12.5, 16.7][Math.min(2, layersNow)];
    else if (h === 'toxicspikes' && grounded(f.calc) && !f.calc.types.includes('Poison') && !f.calc.types.includes('Steel') && layersNow === 0) chip = 12.5; // poison: ~1/8 a turn
    if (f.calc.ability === 'Magic Guard' || f.calc.item === 'Heavy-Duty Boots') chip = 0;
    if (chip > 0) {
      total += chip;
      parts.push(`${Math.round(chip)}% to ${f.name}`);
    }
  }
  return { total, parts };
}

/**
 * Rates one support move (or the 100% side effect of an attack). Returns null when the move has
 * no effect we model (Protect, Substitute, confusion…): leave it unscored.
 */
export function rateSupport(ctx: SupportContext, moveId: string): SupportRating | null {
  const { ds } = ctx;
  const mv = ds.moves[moveId];
  const e = supportEffect(ds, moveId);
  if (!mv || !e) return null;
  const label = effectLabel(e);
  const foeTypes = ctx.foe.types as string[];
  const fx = fxFromField(ctx.field);
  const st0 = baseState(ctx, ctx.me, ctx.foe, fx, ctx.myBoosts);
  const myHp = curPct(ctx.me);
  const foeHp = curPct(ctx.foe);
  const A = fight(ctx, st0, myHp, foeHp);
  const out = (score: number | null, reason: string, better = false): SupportRating => ({ score, reason, effect: e, label, better, planA: Math.round(A.score) });

  const why = blocked(ctx, moveId, e, foeTypes);
  if (why) return out(null, `${label}: ${why}`);

  const damaging = mv.category !== 'Status';
  const d: MoveDamage | null = damaging ? moveDamage(ds, ctx.me, ctx.foe, moveId, st0.forMe) : null;
  if (damaging && (!d || d.maxPct <= 0)) return null;
  const h0 = hits(ctx, st0);
  const prio = mv.priority ?? 0;
  const first = order(ctx.me, ctx.foe, prio, h0.theirs?.priority ?? 0, st0.mySpeedMul);
  const self = mv.target === 'self' || mv.target === 'allySide' || mv.target === 'all' || mv.target === 'foeSide' || mv.target === 'allies';
  const acc = self || mv.accuracy === true ? 1 : Math.min(1, (mv.accuracy as number) / 100 * accuracyStageMul(st0.myAcc - st0.foeEva));
  // The hit branch: full average damage (a miss is the `acc` weighting below).
  const dmg1 = d ? avgPct(d) : 0;
  if (d && d.minPct >= foeHp) return null; // it simply KOs: the attack ranking covers it

  // Their hit this turn before you move (you are slower).
  if (first === false && h0.theirHit >= myHp) return out(null, `${label}: they KO you before you can use it.`);

  const { st: stB } = applyEffect(st0, e, fx, 1);
  // You move first: the effect already changes their hit this turn (Charm, burn, Reflect, sleep).
  const hB = hits(ctx, stB);
  const theirTurn1 = first === false ? h0.theirHit : stB.foeSleep > 0 && !stB.sleepDelay ? 0 : hB.theirHit;
  const myHp1 = myHp - theirTurn1;
  const foeHp1 = foeHp - dmg1;
  const sleepSt = stB.foeSleep > 0 && !stB.sleepDelay && first !== false ? { ...stB, foeSleep: stB.foeSleep - 1 } : stB;

  // A miss (or the turn of a move that doesn't land): you took their hit for nothing.
  const missHp = myHp - h0.theirHit;
  const F = missHp > 0 ? fight(ctx, st0, missHp, foeHp) : { score: 0, myTurns: Infinity, win: false, hpLeft: 0, theirTurns: 0 };

  const later = laterCredit(ctx, e, fx, 1, Math.max(1, foeHp1));
  let hazardText = '';
  let hazardBonus = 0;
  if (e.kind === 'hazard') {
    const now = e.hazard === 'stealthrock' ? 0 : ctx.field?.theirs[e.hazard] ?? 0;
    const chip = hazardChip(ctx, e.hazard, now);
    if (!chip.total) return out(null, `${label}: none of their remaining Pokémon would take damage.`);
    hazardBonus = Math.min(20, Math.round(chip.total / 3));
    hazardText = `${chip.parts.slice(0, 3).join(', ')}${chip.parts.length > 3 ? ` (+${chip.parts.length - 3} more)` : ''} when they come in`;
  }

  if (myHp1 <= 0 || foeHp1 <= 0) {
    if (foeHp1 <= 0) return null;
    // It lands, then you go down: only worth it for what stays behind.
    const bonus = later.bonus + hazardBonus;
    if (bonus <= 0) return out(null, `${label}: they KO you right after, before it helps.`);
    const score = Math.round(Math.max(0, Math.min(100, acc * (20 + bonus))));
    return out(score, `${label}: you go down right after, but it ${later.text ?? hazardText}.`);
  }

  const B = fight(ctx, sleepSt, myHp1, foeHp1);
  const sweep = e.kind === 'boost' && B.win ? sweepCredit(ctx, stB, B.hpLeft, A.win ? A.hpLeft : 0) : { bonus: 0 };
  // Losing this 1v1 anyway, the turn costs little: no setup penalty then.
  let score = acc * B.score + (1 - acc) * F.score - (A.win ? SETUP_PENALTY : 0) + later.bonus + hazardBonus + acc * sweep.bonus;
  // Attacking KOs this turn before they move: nothing to set up for.
  const koNow = h0.mine && h0.mine.minPct >= foeHp && h0.first !== false;
  if (koNow) score = Math.min(score, A.score - 15);
  score = Math.round(Math.max(0, Math.min(100, score)));

  const foe = ctx.foeName;
  const parts: string[] = [];
  if (koNow) parts.push('you can KO it now');
  else if (B.win && !A.win) parts.push(`you win the 1v1 instead of losing${Number.isFinite(B.myTurns) ? ` (${hitWord(B.myTurns)} after this turn)` : ''}`);
  else if (B.win && Number.isFinite(A.myTurns) && B.myTurns < A.myTurns) parts.push(`KOs ${foe} in ${hitWord(B.myTurns)} instead of ${A.myTurns}${B.myTurns + 1 >= A.myTurns ? ' (no turn saved)' : ''}`);
  else if (B.win && A.win && B.hpLeft >= A.hpLeft + 10) parts.push(`ends with ~${Math.round(B.hpLeft)}% HP instead of ~${Math.round(A.hpLeft)}%`);
  else if (!B.win && !A.win && e.kind !== 'hazard' && !later.text) parts.push('still loses the 1v1');
  else if (e.kind !== 'hazard' && !later.text) parts.push('no gain over attacking now');
  if (later.text) parts.push(later.text);
  if (sweep.text) parts.push(sweep.text);
  if (hazardText) parts.push(hazardText);
  if (e.kind === 'boost' && !koNow && B.win) parts.push('lost if you switch');
  if (e.kind === 'status' && e.status === 'slp') parts.push(`sleep length is a guess (${SLEEP_TURNS} turns)`);
  let reason = `${label}: ${parts.join('; ')}.`;
  if (acc < 1) reason += ` ${Math.round(acc * 100)}% to hit.`;
  const better = !koNow && score > Math.round(A.score);
  return out(score, reason, better);
}
