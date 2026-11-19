import { Generations, toID, type Pokemon as CalcPokemon } from '@smogon/calc';
import type { BoostKey, Boosts } from '../shared/battle';
import type { Dataset } from '../shared/types';
import { BLOCKING_ABILITIES } from './catchPlan';

/**
 * Critical hits and secondary effects of damaging moves, for the lookahead (lookahead.ts) and the
 * reason line. Effects come from the game's move descriptions (Showdown wording, same source as
 * supportMoves.ts), e.g. "Has a 10% chance to burn the target and a 10% chance to make it flinch.",
 * "Has a higher chance for a critical hit.", "...recoil damage equal to 33% the HP lost by the target".
 */

const gen = Generations.get(9);

/* ---------------- critical hits ---------------- */

/**
 * Mainline Gen 7+ crit chance per crit stage (0, +1, +2, +3 and up) and the damage multiplier.
 * One constant so a Gen III ruleset (Battle Frontier) can swap it: Gen III is 1/16, 1/8, 1/4, 1/3, 1/2 and ×2.
 */
export const CRIT_TABLE = { chance: [1 / 24, 1 / 8, 1 / 2, 1], mul: 1.5 } as const;

const CRIT_ITEMS: Record<string, number> = { 'Scope Lens': 1, 'Razor Claw': 1 };
/** Species-only items: Leek / Stick (Farfetch'd line), Lucky Punch (Chansey). */
const SPECIES_CRIT_ITEMS: Record<string, [string[], number]> = {
  Leek: [["Farfetch’d", "Farfetch'd", "Farfetch’d-Galar", "Farfetch'd-Galar", "Sirfetch’d", "Sirfetch'd"], 2],
  Stick: [["Farfetch’d", "Farfetch'd"], 2],
  'Lucky Punch': [['Chansey'], 2],
};
const CRIT_BLOCKERS = ['Battle Armor', 'Shell Armor'];

export interface CritInfo {
  /** 0–1 chance this hit is a critical hit. */
  chance: number;
  /** The move always crits (Frost Breath, Storm Throw…): the calc's damage already is crit damage. */
  always: boolean;
  /** Crit damage multiplier (Sniper: 2.25). */
  mul: number;
}

/** Crit stage of the move itself: +1 for "higher chance for a critical hit". */
export function moveCritStage(ds: Dataset, moveId: string): number {
  return /higher chance for a critical hit/i.test(ds.moves[moveId]?.description ?? '') ? 1 : 0;
}

export function alwaysCrits(ds: Dataset, moveId: string): boolean {
  return !!(gen.moves.get(toID(moveId)) as { willCrit?: boolean } | undefined)?.willCrit || /always a critical hit/i.test(ds.moves[moveId]?.description ?? '');
}

/**
 * Crit chance of `atk` hitting `def` with a move. `focusEnergy`: the attacker used Focus Energy
 * (or Dire Hit) and is still in (+2). Merciless crits poisoned targets; Battle/Shell Armor block.
 */
export function critInfo(ds: Dataset, atk: CalcPokemon, def: CalcPokemon, moveId: string, focusEnergy = false): CritInfo {
  const mul = atk.ability === 'Sniper' ? CRIT_TABLE.mul * 1.5 : CRIT_TABLE.mul;
  if (CRIT_BLOCKERS.includes(def.ability ?? '') && atk.ability !== 'Mold Breaker') return { chance: 0, always: false, mul };
  const always = alwaysCrits(ds, moveId);
  if (always) return { chance: 1, always, mul };
  if (atk.ability === 'Merciless' && (def.status === 'psn' || def.status === 'tox')) return { chance: 1, always: false, mul };
  let stage = moveCritStage(ds, moveId) + (focusEnergy ? 2 : 0) + (atk.ability === 'Super Luck' ? 1 : 0);
  if (atk.item) {
    stage += CRIT_ITEMS[atk.item] ?? 0;
    const sp = SPECIES_CRIT_ITEMS[atk.item];
    if (sp && sp[0].some((n) => n.toLowerCase() === atk.name.toLowerCase())) stage += sp[1];
  }
  const t = CRIT_TABLE.chance;
  return { chance: t[Math.min(t.length - 1, stage)], always: false, mul };
}

/* ---------------- secondary effects ---------------- */

export type SecStatus = 'par' | 'brn' | 'frz' | 'psn' | 'tox' | 'slp';

export interface MoveFx {
  /** Chance (0–1) to make the target flinch: only works when the user moves first. */
  flinch: number;
  /** Chance per status (Tri Attack / Dire Claw split their chance evenly). */
  status: { status: SecStatus; chance: number }[];
  confuse: number;
  /** Stage drop on the target with its chance (Crunch 20% −1 Def, Icy Wind 100% −1 Spe). */
  targetDrop?: { boosts: Boosts; chance: number };
  /** Stage raise on the user with its chance (Metal Claw 10% +1 Atk, Power-Up Punch 100%). */
  userRaise?: { boosts: Boosts; chance: number };
  /** Sure stage drop on the user (Close Combat, Draco Meteor). */
  userDrop?: Boosts;
  /** Share of the damage dealt the user loses (Double-Edge 0.33) or regains (Giga Drain 0.5). */
  recoil: number;
  drain: number;
  /** Fails unless it is the user's first turn on the field (Fake Out, First Impression). */
  firstTurnOnly: boolean;
}

const EMPTY: MoveFx = { flinch: 0, status: [], confuse: 0, recoil: 0, drain: 0, firstTurnOnly: false };

const STAT_WORDS: [RegExp, BoostKey][] = [
  [/special attack|sp\. atk/, 'spa'], [/special defense|sp\. def/, 'spd'], [/attack/, 'atk'], [/defense/, 'def'],
  [/speed/, 'spe'], [/accuracy/, 'accuracy'], [/evasion|evasiveness/, 'evasion'],
];
function statsIn(list: string): BoostKey[] {
  return list.split(/,\s*(?:and\s+)?|\s+and\s+/).map((part) => STAT_WORDS.find(([re]) => re.test(part))?.[1]).filter((k): k is BoostKey => !!k);
}
const STATUS_WORD: [RegExp, SecStatus][] = [
  [/badly poison/, 'tox'], [/paralyz/, 'par'], [/burn/, 'brn'], [/freez/, 'frz'], [/poison/, 'psn'], [/sleep|fall asleep/, 'slp'],
];

const fracOf = (s: string) => {
  const pct = /(\d+)%/.exec(s);
  if (pct) return Number(pct[1]) / 100;
  const f = /(\d+)\/(\d+)/.exec(s);
  return f ? Number(f[1]) / Number(f[2]) : 0;
};

const cache = new WeakMap<Dataset, Map<string, MoveFx>>();

/** Secondary effects of a damaging move, parsed from its description (cached per dataset). */
export function moveFx(ds: Dataset, moveId: string): MoveFx {
  let byId = cache.get(ds);
  if (!byId) cache.set(ds, (byId = new Map()));
  const hit = byId.get(moveId);
  if (hit) return hit;
  const mv = ds.moves[moveId];
  const fx: MoveFx = { ...EMPTY, status: [] };
  if (mv && mv.category !== 'Status') {
    for (const raw of mv.description.split(/(?<=\.)\s+/)) {
      const s = raw.trim().toLowerCase();
      if (/fails unless it is the user's first turn on the field/.test(s)) fx.firstTurnOnly = true;
      if (/recoil damage equal to/.test(s)) fx.recoil = fracOf(s.split('equal to')[1]);
      if (/the user recovers .* the hp lost by the target/.test(s)) fx.drain = fracOf(s.split('recovers')[1]);
      // Sure drawback on the user: "Lowers the user's Defense and Special Defense by 1 stage."
      const own = /^lowers the user's ([a-z ,.]+?) by (\d+) stages?/.exec(s);
      if (own) {
        const b: Boosts = {};
        for (const k of statsIn(own[1])) b[k] = -Number(own[2]);
        fx.userDrop = b;
      }
      // Chance clauses; a condition ("if it had a stat stage raised this turn") makes it unmodelled.
      // "…burn the target and a 10% chance to make it flinch", "…, a 30% chance to make it flinch, and a higher…"
      for (const part of s.split(/,?\s+(?:and\s+)?(?=a \d+% chance|a higher chance)/)) {
        const c = /(\d+)% chance to (.+?)\.?$/.exec(part);
        if (!c) continue;
        const chance = Number(c[1]) / 100;
        const what = c[2];
        if (/\bif\b|terrain|hit two|hit four|power is doubled|either .*restored/.test(what)) continue;
        if (/flinch/.test(what)) {
          fx.flinch = chance;
          continue;
        }
        if (/confuse/.test(what)) {
          fx.confuse = chance;
          continue;
        }
        const st = /^(?:lower|raise)s? the (target|user)'s ([a-z ,.]+?) by (\d+) stages?/.exec(what);
        if (st) {
          const b: Boosts = {};
          const up = what.startsWith('raise');
          for (const k of statsIn(st[2])) b[k] = (up ? 1 : -1) * Number(st[3]);
          if (st[1] === 'target' && !up) fx.targetDrop = { boosts: b, chance };
          else if (st[1] === 'user' && up) fx.userRaise = { boosts: b, chance };
          continue;
        }
        if (/either/.test(what)) {
          const found = STATUS_WORD.filter(([re]) => re.test(what)).map(([, k]) => k);
          const list = found.filter((k, i) => found.indexOf(k) === i && !(k === 'psn' && found.includes('tox')));
          for (const k of list) fx.status.push({ status: k, chance: chance / list.length });
          continue;
        }
        const one = STATUS_WORD.find(([re]) => re.test(what));
        if (one) fx.status.push({ status: one[1], chance });
      }
    }
  }
  byId.set(moveId, fx);
  return fx;
}

/** Abilities that change secondary chances: Serene Grace doubles, Sheer Force removes them, Shield Dust blocks them. */
export function fxChanceMul(atk: CalcPokemon, def: CalcPokemon): number {
  if (atk.ability === 'Sheer Force') return 0;
  if (def.ability === 'Shield Dust' || def.item === 'Covert Cloak') return 0;
  return atk.ability === 'Serene Grace' ? 2 : 1;
}

/** Can `def` get this status from `atk`'s move? Types, abilities, an existing status. */
export function canGetStatus(def: CalcPokemon, status: SecStatus, moveType: string, atk?: CalcPokemon, currentStatus?: string): boolean {
  if (currentStatus) return false;
  const t = def.types as string[];
  if (status === 'par' && t.includes('Electric')) return false;
  if (status === 'brn' && t.includes('Fire')) return false;
  if (status === 'frz' && (t.includes('Ice') || def.ability === 'Magma Armor')) return false;
  if ((status === 'psn' || status === 'tox') && (t.includes('Poison') || t.includes('Steel')) && atk?.ability !== 'Corrosion') return false;
  if (status !== 'frz' && BLOCKING_ABILITIES[status].includes(def.ability ?? '')) return false;
  void moveType;
  return true;
}

/** Inner Focus and Shield Dust stop flinching. */
export const canFlinch = (def: CalcPokemon) => def.ability !== 'Inner Focus' && def.ability !== 'Shield Dust' && def.item !== 'Covert Cloak';

const NAME: Record<SecStatus, string> = { par: 'paralysis', brn: 'burn', frz: 'freeze', psn: 'poison', tox: 'bad poison', slp: 'sleep' };
const BOOST_LABEL: Record<BoostKey, string> = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva' };
const boostTxt = (b: Boosts) => Object.entries(b).map(([k, v]) => `${v! > 0 ? '+' : '−'}${Math.abs(v!)} ${BOOST_LABEL[k as BoostKey]}`).join(' ');
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Short effect notes for the reason line, e.g. "30% flinch – you're faster", "10% burn",
 * "drains ~20% HP". `youFirst`: you strictly outspeed this turn (a tie counts as slower).
 */
export function fxNotes(ds: Dataset, moveId: string, o: { atk: CalcPokemon; def: CalcPokemon; youFirst: boolean | null; dmgPct: number; defStatus?: string; firstTurn?: boolean; attackerMaxHp?: number; defMaxHp?: number }): string[] {
  const fx = moveFx(ds, moveId);
  const mul = fxChanceMul(o.atk, o.def);
  const out: string[] = [];
  const mvType = ds.moves[moveId]?.type ?? '';
  if (fx.firstTurnOnly && !o.firstTurn) out.push('fails: only on its first turn out');
  if (fx.flinch && mul && canFlinch(o.def)) {
    const c = Math.min(1, fx.flinch * mul);
    out.push(o.youFirst === true ? `${pct(c)} flinch – you're faster` : `no flinch – they move first`);
  }
  if (mul) {
    for (const s of fx.status) if (canGetStatus(o.def, s.status, mvType, o.atk, o.defStatus)) out.push(`${pct(Math.min(1, s.chance * mul))} ${NAME[s.status]}`);
    if (fx.confuse) out.push(`${pct(Math.min(1, fx.confuse * mul))} confusion`);
    if (fx.targetDrop) out.push(`${pct(Math.min(1, fx.targetDrop.chance * mul))} ${boostTxt(fx.targetDrop.boosts)} to it`);
    if (fx.userRaise) out.push(`${pct(Math.min(1, fx.userRaise.chance * mul))} ${boostTxt(fx.userRaise.boosts)}`);
  }
  if (fx.userDrop) out.push(`${boostTxt(fx.userDrop)} to you`);
  // Damage dealt in the attacker's own % (HP lost by the target, in raw HP, over the attacker's max HP).
  const raw = o.defMaxHp && o.attackerMaxHp ? (o.dmgPct / 100) * o.defMaxHp / o.attackerMaxHp * 100 : o.dmgPct;
  if (fx.drain && raw > 0) out.push(`heals ~${Math.round(raw * fx.drain)}%`);
  if (fx.recoil && raw > 0 && o.atk.ability !== 'Rock Head' && o.atk.ability !== 'Magic Guard') out.push(`~${Math.round(raw * fx.recoil)}% recoil`);
  return out;
}
