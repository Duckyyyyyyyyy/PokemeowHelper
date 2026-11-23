import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { BoxMon, Dataset, NpcTeamVariant } from '../shared/types';
import { evolvedAt, potentialFor, targetLevel, type PotentialOptions } from './potential';
import { outcomeOf, type Candidate, type PairResult } from './teamSuggest';

/**
 * Grind ladder: one Pokémon scored at levels between where it is now and the fight's level (or cap),
 * with the best moves it can have by each level (same scorer as Worth grinding). Shows the levels where
 * it starts beating each NPC Pokémon, evolves or learns a move it would use.
 *
 * A "win" is the card header's (`outcomeOf(...) === 'win'`). Wins can also disappear at a higher level
 * (another moveset, an evolution changes its types), so every rung keeps its own pairs.
 */

export interface LadderRung {
  level: number;
  /** NPC team indexes it beats 1v1 at this level. */
  won: number[];
  /** Beats now that it did not at the previous rung (names). */
  gained: string[];
  /** Beat at the previous rung, not at this one (names). */
  lost: string[];
  /** Species it is by this level, when it evolved since the previous rung. */
  evolvedTo?: number;
  /** Moves it picks that it learns since the previous rung. */
  learns: string[];
  pairs: PairResult[];
}

export interface GrindLadder {
  uid: string;
  from: number;
  target: number;
  /** Rung at its current level, with its best moves by now. */
  start: LadderRung;
  /** Only the rungs where something changes (wins, evolution, a move it would use), up to the target. */
  steps: LadderRung[];
  /** Every scored rung (for the team plan). */
  all: LadderRung[];
}

export interface LadderOptions extends PotentialOptions {
  /** Battle Tower scoring (closer outcomes count). */
  tower?: boolean;
  /** Levels between grid rungs (default 5). */
  step?: number;
}

const wonIdx = (pairs: PairResult[], tower: boolean) => pairs.map((p, j) => (outcomeOf(p, tower) === 'win' ? j : -1)).filter((j) => j >= 0);

/** Levels to score: now, every `step` levels, each level-based evolution in range, and the target. */
export function ladderLevels(ds: Dataset, mon: BoxMon, from: number, target: number, step = 5): number[] {
  const out = new Set<number>([from, target]);
  for (let l = Math.ceil((from + 1) / step) * step; l < target; l += step) out.add(l);
  for (let l = from + 1; l <= target; l++) if (evolvedAt(ds, mon.species, l) !== evolvedAt(ds, mon.species, l - 1)) out.add(l);
  return [...out].filter((l) => l >= from && l <= target).sort((a, b) => a - b);
}

/** Null when it can't be trained further for this fight (already at the target level, or level unknown). */
export function grindLadder(ds: Dataset, mon: BoxMon, v: NpcTeamVariant, opts: LadderOptions = {}, npcCalc?: CalcPokemon[]): GrindLadder | null {
  const target = targetLevel(v);
  const from = mon.level;
  if (from === undefined || from >= target) return null;
  const tower = !!opts.tower;
  const all: LadderRung[] = [];
  let prev: LadderRung | undefined;
  let prevSpecies = mon.species;
  let prevMoves = new Set<string>();
  for (const level of ladderLevels(ds, mon, from, target, opts.step)) {
    const p = potentialFor(ds, mon, v, opts, npcCalc, level);
    const won = wonIdx(p.pairs, tower);
    const species = p.evolvedTo ?? mon.species;
    const moves = p.moves.map((m) => m.moveId);
    const rung: LadderRung = {
      level,
      won,
      gained: won.filter((j) => !prev?.won.includes(j)).map((j) => v.team[j].name),
      lost: (prev?.won ?? []).filter((j) => !won.includes(j)).map((j) => v.team[j].name),
      ...(prev && species !== prevSpecies ? { evolvedTo: species } : {}),
      learns: prev ? p.moves.filter((m) => !prevMoves.has(m.moveId) && m.source === 'level' && (m.level ?? 0) > prev!.level).map((m) => m.name) : [],
      pairs: p.pairs,
    };
    if (!prev) rung.gained = [];
    all.push(rung);
    prev = rung;
    prevSpecies = species;
    prevMoves = new Set(moves);
  }
  const steps = all.slice(1).filter((r) => r.gained.length || r.lost.length || r.evolvedTo !== undefined || r.learns.length || r.level === target);
  return { uid: mon.uid, from, target, start: all[0], steps, all };
}

export interface PlanStep {
  uid: string;
  name: string;
  from: number;
  toLevel: number;
  /** NPC Pokémon the team answers after this step that it did not before. */
  beats: string[];
  /** Team answers (of the NPC team) after this step. */
  answers: number;
}

export interface TeamGrindPlan {
  /** Team answers now (card header rule). */
  now: number;
  steps: PlanStep[];
  /** NPC Pokémon nobody on the team beats even at the fight's level. */
  unreachable: string[];
}

/**
 * Who to train next and how far: repeatedly takes the step with the fewest levels that makes the team
 * answer an NPC Pokémon it doesn't yet. Coverage is recomputed from the real pairs at each member's
 * planned level (a win can be lost at a higher level), never added up.
 */
export function teamGrindPlan(team: readonly Candidate[], ladders: ReadonlyMap<string, GrindLadder>, v: NpcTeamVariant, ds: Dataset, tower = false): TeamGrindPlan {
  const n = v.team.length;
  // Planned rung per member (undefined = as it is now: the header's pairs).
  const planned = new Map<string, LadderRung>();
  const answered = () => {
    const s = new Set<number>();
    for (const c of team) {
      const r = planned.get(c.mon.uid);
      const pairs = r ? r.pairs : c.pairs;
      pairs.forEach((p, j) => outcomeOf(p, tower) === 'win' && s.add(j));
    }
    return s;
  };
  const now = answered().size;
  const steps: PlanStep[] = [];
  for (let guard = 0; guard < n; guard++) {
    const have = answered();
    if (have.size >= n) break;
    let best: { c: Candidate; rung: LadderRung; cost: number; gain: number } | undefined;
    for (const c of team) {
      const lad = ladders.get(c.mon.uid);
      if (!lad) continue;
      const at = planned.get(c.mon.uid)?.level ?? lad.from;
      for (const rung of lad.all) {
        if (rung.level <= at) continue;
        // Answers with this member moved to this rung, the rest as planned.
        const prevRung = planned.get(c.mon.uid);
        planned.set(c.mon.uid, rung);
        const after = answered();
        if (prevRung) planned.set(c.mon.uid, prevRung);
        else planned.delete(c.mon.uid);
        const gain = after.size - have.size;
        if (gain <= 0) continue;
        const cost = rung.level - at;
        if (!best || cost < best.cost || (cost === best.cost && gain > best.gain)) best = { c, rung, cost, gain };
        break; // the lowest rung that gains anything is this member's cheapest step
      }
    }
    if (!best) break;
    const from = planned.get(best.c.mon.uid)?.level ?? ladders.get(best.c.mon.uid)!.from;
    planned.set(best.c.mon.uid, best.rung);
    const after = answered();
    steps.push({
      uid: best.c.mon.uid,
      name: ds.species[best.c.mon.species]?.name ?? '?',
      from,
      toLevel: best.rung.level,
      beats: [...after].filter((j) => !have.has(j)).map((j) => v.team[j].name),
      answers: after.size,
    });
  }
  const done = answered();
  return { now, steps, unreachable: v.team.filter((_, j) => !done.has(j)).map((m) => m.name) };
}
