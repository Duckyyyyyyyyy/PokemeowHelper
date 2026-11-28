import { toID } from '@smogon/calc';
import type { BoxMon, Dataset, Npc, NpcTeamVariant, StatTable } from '../shared/types';
import { bestMove, boxToCalc, gen, makeField, npcToCalc } from './damage';
import { EV_MAX_STAT, EV_MAX_TOTAL, STATS, attackSide, lowerNeeded, type EvChange, type StatKey } from './evPlan';
import { statsAtLevel, targetLevel } from './potential';
import { dsFor, rulesFor } from './rules';
import { outcomeOf, scoreAgainstTeam } from './teamSuggest';

/**
 * EV roles for the Train tab: which spread each Pokémon in the box should grind toward, by play style.
 * No damage calc, so the whole box can be listed. Scoring spreads against one NPC stays in evPlan.ts.
 *
 * GUESS: `autoRole` picks a role from base stats only (thresholds below); it is not checked in real battles.
 * The spreads are the common 252/252 ones (the last 6 EVs are left out: worth at most 1 point).
 */

export type EvRole = 'fast' | 'bulky' | 'pwall' | 'swall';
export const ROLES: readonly EvRole[] = ['fast', 'bulky', 'pwall', 'swall'];
export const ROLE_LABEL: Record<EvRole, string> = { fast: 'Fast attacker', bulky: 'Bulky attacker', pwall: 'Physical wall', swall: 'Special wall' };
/** Below this level 252 EVs add 15 points or fewer: level first. */
export const LATER_LEVEL = 25;

const zero = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
const full = (p: Partial<StatTable>): StatTable => ({ ...zero(), ...p });

/** The attack stat it trains: from its damaging moves, else the higher base stat. */
export function mainSide(ds: Dataset, mon: BoxMon): 'atk' | 'spa' {
  const sides = attackSide(ds, mon);
  if (sides.length === 1) return sides[0];
  const b = ds.species[mon.species]?.baseStats;
  return b && b.spa > b.atk ? 'spa' : 'atk';
}

/** GUESS (heuristic): a wall when its attack stat is low and a defence is high, fast at base Speed 80+, else bulky. */
export function autoRole(ds: Dataset, mon: BoxMon): EvRole {
  const b = ds.species[mon.species]?.baseStats;
  if (!b) return 'bulky';
  if (b[mainSide(ds, mon)] < 90 && Math.max(b.def, b.spd) >= 110) return b.spd > b.def ? 'swall' : 'pwall';
  return b.spe >= 80 ? 'fast' : 'bulky';
}

export function roleSpread(role: EvRole, side: 'atk' | 'spa'): StatTable {
  if (role === 'fast') return full({ [side]: EV_MAX_STAT, spe: EV_MAX_STAT });
  if (role === 'bulky') return full({ hp: EV_MAX_STAT, [side]: EV_MAX_STAT });
  if (role === 'pwall') return full({ hp: EV_MAX_STAT, def: EV_MAX_STAT });
  return full({ hp: EV_MAX_STAT, spd: EV_MAX_STAT });
}

/** One Train tab row: the role it trains for and where it stands. */
export interface TrainRow {
  mon: BoxMon;
  role: EvRole;
  /** The role came from the heuristic, not from you. */
  auto: boolean;
  target: StatTable;
  status: EvStatus;
  nature: StatKey | null;
}

/** `pick` 'own' = the role you saved for it, else the auto role; a role = show it as that role. */
export function trainRow(ds: Dataset, mon: BoxMon, pick: EvRole | 'own', saved: Record<string, EvRole>): TrainRow {
  const own = saved[mon.uid];
  const role = pick !== 'own' ? pick : own ?? autoRole(ds, mon);
  const target = roleSpread(role, mainSide(ds, mon));
  return { mon, role, auto: pick === 'own' && !own, target, status: evStatus(mon, target), nature: natureAgainst(mon.nature, target) };
}

export type EvState = 'done' | 'grind' | 'reset' | 'unknown' | 'later';

export interface EvStatus {
  state: EvState;
  /** EVs still to earn. */
  need: number;
  raise: EvChange[];
  /** Only the lowering needed to fit 510 (same rule as the NPC EV advice). */
  lower: EvChange[];
}

/**
 * Where it stands against a target spread. Unknown = EVs not known (typed by hand); later = below
 * LATER_LEVEL with work left; reset = the target does not fit next to what it has.
 */
export function evStatus(mon: BoxMon, target: StatTable): EvStatus {
  if (!mon.evs) return { state: 'unknown', need: 0, raise: [], lower: [] };
  const cur = full(mon.evs);
  const raise = STATS.filter((k) => target[k] > cur[k]).map((k) => ({ stat: k, from: cur[k], to: target[k] }));
  const need = raise.reduce((s, c) => s + c.to - c.from, 0);
  const lower = lowerNeeded(cur, target);
  const state: EvState = !need ? 'done' : mon.level !== undefined && mon.level < LATER_LEVEL ? 'later' : lower.length ? 'reset' : 'grind';
  return { state, need, raise, lower };
}

/** The stat its nature lowers, when the role invests in it (e.g. Modest on a physical attacker). */
export function natureAgainst(nature: string | undefined, target: StatTable): StatKey | null {
  const n = nature ? gen.natures.get(toID(nature)) : undefined;
  if (!n?.minus || n.plus === n.minus) return null;
  const minus = n.minus as StatKey;
  return target[minus] > 0 ? minus : null;
}

export interface FoeSpeed {
  name: string;
  spe: number;
}

/** Each NPC Pokémon's Speed from its wiki set (no Choice Scarf, paralysis, stages or Trick Room). */
export function foeSpeeds(ds: Dataset, v: NpcTeamVariant): FoeSpeed[] {
  return v.team.map((n) => ({ name: n.name, spe: npcToCalc(ds, n).stats.spe }));
}

export type SpeedVerdict = 'faster' | 'tie' | 'slower';
export const speedVerdict = (mine: number, theirs: number): SpeedVerdict => (mine > theirs ? 'faster' : mine === theirs ? 'tie' : 'slower');

export interface LeanPlan {
  /** The fastest foe it can pass with 252 Spe EVs or fewer, that it does not pass with none. */
  foe: FoeSpeed;
  spread: StatTable;
}

/**
 * "Lean": the fewest Spe EVs (a multiple of 4) that move first against one threat at `level`,
 * 252 in its attack stat and the rest in HP (within 510). Null when no foe needs Spe EVs to pass
 * or none can be passed.
 */
export function leanPlan(ds: Dataset, mon: BoxMon, level: number, foes: FoeSpeed[]): LeanPlan | null {
  const speAt = (e: number) => statsAtLevel(ds, { ...mon, evs: { spe: e } }, level).spe;
  const lo = speAt(0);
  const hi = speAt(EV_MAX_STAT);
  const foe = foes.filter((f) => f.spe >= lo && f.spe < hi).sort((a, b) => b.spe - a.spe)[0];
  if (!foe) return null;
  let spe = 0;
  while (speAt(spe) <= foe.spe) spe += 4;
  const side = mainSide(ds, mon);
  const hp = Math.min(EV_MAX_STAT, Math.floor((EV_MAX_TOTAL - EV_MAX_STAT - spe) / 4) * 4);
  return { foe, spread: full({ [side]: EV_MAX_STAT, spe, hp }) };
}

/* ---------------- Hits taken (Build card) ---------------- */

export interface HitTaken {
  name: string;
  move: string;
  minPct: number;
  maxPct: number;
}

/** Each NPC Pokémon's strongest move into this Pokémon with `evs` at `level`, from full HP (no crit, no field). */
export function hitsTaken(ds: Dataset, mon: BoxMon, evs: StatTable, level: number, v: NpcTeamVariant): HitTaken[] {
  const me = boxToCalc(ds, { ...mon, evs, level });
  const field = makeField(v.format);
  return v.team.map((n) => {
    const d = bestMove(ds, npcToCalc(ds, n), me, n.moves, field);
    return { name: n.name, move: d?.name ?? '—', minPct: d?.minPct ?? 0, maxPct: d?.maxPct ?? 0 };
  });
}

/* ---------------- Goal scoring (on tap) ---------------- */

export type EvGoal = 'rematch' | 'rival' | 'tower';
export const GOAL_LABEL: Record<EvGoal, string> = { rematch: 'League rematches', rival: 'Rivals', tower: 'Battle Tower' };

/** The NPC teams a goal scores against: rematch teams of Gyms / Elite Four / Champions, every rival team, every tower. */
export function goalTeams(ds: Dataset, goal: EvGoal): { npc: Npc; v: NpcTeamVariant }[] {
  const out: { npc: Npc; v: NpcTeamVariant }[] = [];
  for (const npc of ds.npcs) {
    if (goal === 'rematch' && ['gym', 'elite-four', 'champion'].includes(npc.category)) {
      for (const v of npc.variants) if (/rematch/i.test(v.label)) out.push({ npc, v });
    } else if ((goal === 'rival' && npc.category === 'rival') || (goal === 'tower' && npc.category === 'tower')) {
      for (const v of npc.variants) out.push({ npc, v });
    }
  }
  return out;
}

export interface GoalScore {
  label: string;
  role?: EvRole;
  /** 1v1 wins summed over every team it may enter. */
  wins: number;
  /** NPC Pokémon faced (teams over its level cap are left out). */
  total: number;
  avg: number;
}

/**
 * Its current EVs and each role's spread, scored 1v1 against every team of a goal (same scorer as
 * Prep → Team). At the fight's level when it is below it; teams whose level cap it is over are skipped.
 */
export function scoreGoal(ds: Dataset, mon: BoxMon, goal: EvGoal): { now: GoalScore; roles: GoalScore[]; teams: number } {
  const side = mainSide(ds, mon);
  const sets: { label: string; role?: EvRole; evs: StatTable }[] = [
    { label: 'EVs now', evs: full(mon.evs ?? {}) },
    ...ROLES.map((r) => ({ label: ROLE_LABEL[r], role: r, evs: roleSpread(r, side) })),
  ];
  const acc = sets.map((s) => ({ label: s.label, role: s.role, wins: 0, total: 0, sum: 0 }));
  let teams = 0;
  for (const { npc, v } of goalTeams(ds, goal)) {
    if (v.levelCap && (mon.level ?? 0) > v.levelCap) continue;
    teams++;
    const rules = rulesFor(npc.category);
    const fds = dsFor(ds, rules);
    const fight = targetLevel(v);
    const level = (mon.level ?? 0) < fight ? fight : mon.level;
    const tower = npc.category === 'tower';
    const foes = v.team.map((n) => npcToCalc(fds, n));
    sets.forEach((s, i) => {
      const pairs = scoreAgainstTeam(fds, { ...mon, level, evs: s.evs }, v, { levelCap: v.levelCap, rules }, foes);
      acc[i].wins += pairs.filter((p) => outcomeOf(p, tower) === 'win').length;
      acc[i].total += pairs.length;
      acc[i].sum += pairs.reduce((a, p) => a + p.score, 0);
    });
  }
  const res = acc.map(({ sum, ...a }) => ({ ...a, avg: a.total ? sum / a.total : 0 }));
  return { now: res[0], roles: res.slice(1).sort((a, b) => b.wins - a.wins || b.avg - a.avg), teams };
}

/* ---------------- Speed ladder (Prep → Team) ---------------- */

export interface Rung {
  name: string;
  spe: number;
  side: 'me' | 'foe' | 'ghost';
  uid?: string;
}

/** Most extra Spe EVs a ghost rung may suggest ("a few EVs" only). */
export const GHOST_MAX = 128;

/**
 * Your Pokémon and the NPC's, by Speed at the fight's level (yours at its own level when above it).
 * Ghost rungs: the fewest extra Spe EVs (up to GHOST_MAX, max 252) that pass the next faster foe.
 */
export function speedLadder(ds: Dataset, mons: BoxMon[], v: NpcTeamVariant): Rung[] {
  const fight = targetLevel(v);
  const foes = foeSpeeds(ds, v);
  const out: Rung[] = foes.map((f) => ({ name: f.name, spe: f.spe, side: 'foe' }));
  for (const m of mons) {
    const level = (m.level ?? 0) < fight ? fight : m.level!;
    const name = ds.species[m.species]?.name ?? '?';
    const from = m.evs?.spe ?? 0;
    const speAt = (e: number) => statsAtLevel(ds, { ...m, evs: { ...m.evs, spe: e } }, level).spe;
    const mine = speAt(from);
    out.push({ name, spe: mine, side: 'me', uid: m.uid });
    const next = foes.filter((f) => f.spe >= mine).sort((a, b) => a.spe - b.spe)[0];
    if (!next) continue;
    for (let e = from + 4 - (from % 4); e <= Math.min(EV_MAX_STAT, from + GHOST_MAX); e += 4) {
      const s = speAt(e);
      if (s > next.spe) {
        out.push({ name: `${name} +${e - from} Spe EVs passes ${next.name}`, spe: s, side: 'ghost', uid: m.uid });
        break;
      }
    }
  }
  return out.sort((a, b) => b.spe - a.spe || (a.side === 'foe' ? -1 : 1));
}

/* ---------------- Farm sessions (Train → Farm) ---------------- */

export interface FarmGroup {
  stat: StatKey;
  total: number;
  /** Who needs it, most first. */
  who: { mon: BoxMon; need: number }[];
}

/** Rows that can grind now (grind / reset), grouped by the stat they still need, biggest total first. */
export function farmGroups(rows: TrainRow[]): FarmGroup[] {
  const by = new Map<StatKey, FarmGroup>();
  for (const r of rows) {
    if (r.status.state !== 'grind' && r.status.state !== 'reset') continue;
    for (const c of r.status.raise) {
      const g = by.get(c.stat) ?? { stat: c.stat, total: 0, who: [] };
      g.total += c.to - c.from;
      g.who.push({ mon: r.mon, need: c.to - c.from });
      by.set(c.stat, g);
    }
  }
  for (const g of by.values()) g.who.sort((a, b) => b.need - a.need);
  return [...by.values()].sort((a, b) => b.total - a.total);
}
