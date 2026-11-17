import type { Dataset, NpcMon, NpcTeamVariant } from '../shared/types';
import { ALL_TYPES, effectiveness } from './typeChart';

export function monTypes(ds: Dataset, m: { species: number }): string[] {
  return ds.species[m.species]?.types ?? [];
}

export function monAbilities(m: NpcMon): string[] | undefined {
  if (m.ability) return [m.ability];
  return m.possibleAbilities;
}

/** Points for how much an attacking type hurts one defender. */
function weaknessPoints(mult: number): number {
  if (mult === 0) return -3;
  if (mult >= 4) return 2;
  if (mult >= 2) return 1;
  if (mult <= 0.25) return -2;
  if (mult <= 0.5) return -1;
  return 0;
}

export interface AttackTypeScore {
  type: string;
  score: number;
  perMon: number[]; // multiplier vs each NPC mon, same order as team
  superEffective: number;
  resisted: number;
}

/** Which attacking types work best against this NPC team (type chart + known abilities). */
export function bestAttackTypes(ds: Dataset, v: NpcTeamVariant): AttackTypeScore[] {
  return ALL_TYPES.map((type) => {
    const perMon = v.team.map((m) => effectiveness(ds.types, type, monTypes(ds, m), monAbilities(m)));
    return {
      type,
      perMon,
      score: perMon.reduce((s, x) => s + weaknessPoints(x), 0),
      superEffective: perMon.filter((x) => x > 1).length,
      resisted: perMon.filter((x) => x < 1).length,
    };
  }).sort((a, b) => b.score - a.score || b.superEffective - a.superEffective);
}

export interface ThreatMove {
  moveId: string;
  name: string;
  type: string;
  power: number;
  priority: number;
  users: string[];
}

/** Damaging moves the NPC team carries, grouped by move. */
export function npcThreats(ds: Dataset, v: NpcTeamVariant): ThreatMove[] {
  const byId = new Map<string, ThreatMove>();
  for (const m of v.team) {
    for (const id of m.moves) {
      const mv = ds.moves[id];
      if (!mv || mv.category === 'Status') continue;
      const t = byId.get(id) ?? { moveId: id, name: mv.name, type: mv.type, power: mv.power, priority: mv.priority, users: [] };
      t.users.push(m.name);
      byId.set(id, t);
    }
  }
  return [...byId.values()].sort((a, b) => b.users.length - a.users.length || b.power - a.power);
}

export interface DefenseTypeScore {
  type: string;
  resisted: number;
  weak: number;
  score: number;
}

/** Which single defending types take the NPC's damaging moves best. */
export function bestDefensiveTypes(ds: Dataset, v: NpcTeamVariant): DefenseTypeScore[] {
  const threats = npcThreats(ds, v);
  return ALL_TYPES.map((type) => {
    let resisted = 0;
    let weak = 0;
    let score = 0;
    for (const t of threats) {
      const mult = effectiveness(ds.types, t.type, [type]);
      const w = t.users.length;
      if (mult < 1) resisted += w;
      if (mult > 1) weak += w;
      score += w * -weaknessPoints(mult);
    }
    return { type, resisted, weak, score };
  }).sort((a, b) => b.score - a.score);
}

export interface TeamNote {
  kind: 'priority' | 'setup' | 'item' | 'medicine';
  text: string;
}

/** Short, factual notes worth knowing before the fight. */
export function teamNotes(ds: Dataset, v: NpcTeamVariant): TeamNote[] {
  const notes: TeamNote[] = [];
  for (const m of v.team) {
    for (const id of m.moves) {
      const mv = ds.moves[id];
      if (!mv) continue;
      if (mv.priority > 0 && mv.category !== 'Status') notes.push({ kind: 'priority', text: `${m.name} has priority move ${mv.name} (+${mv.priority})` });
      if (mv.category === 'Status' && /raises the user's/i.test(mv.description)) notes.push({ kind: 'setup', text: `${m.name} can boost stats with ${mv.name}` });
    }
  }
  if (v.medicines.length) {
    const counts = new Map<string, number>();
    for (const i of v.medicines) counts.set(i, (counts.get(i) ?? 0) + 1);
    const list = [...counts].map(([i, n]) => `${ds.items[i]?.name ?? i}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    notes.push({ kind: 'medicine', text: `NPC carries medicine: ${list}` });
  }
  return notes;
}
