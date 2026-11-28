import type { Dataset, ExploreMap } from '../shared/types';
import { STATS, type StatKey } from './evPlan';
import type { MapAccess } from './hunt';

/**
 * Session Route: the wild maps that serve the most goals in one trip: catches on your hunt list,
 * EVs your Farm sessions need, and foes near your team's level for EXP.
 * Reachability is the Hunt & Grind guess (`mapAccess`); locked maps are left out. Maps only: no exact
 * parts or time of day.
 */

export interface RouteInput {
  /** Species on your hunt list. */
  hunt: ReadonlySet<number>;
  /** EVs still needed per stat (Train → Farm). */
  needs: ReadonlyMap<StatKey, number>;
  /** Average level of your strongest Pokémon; undefined = no EXP lane. */
  teamLevel?: number;
  access: (mapId: string) => MapAccess['access'];
}

export interface RouteStop {
  map: ExploreMap;
  access: MapAccess['access'];
  catches: { species: number; name: string; rarity: string }[];
  evs: { species: number; name: string; stat: StatKey; amount: number; rarity: string }[];
  /** Its top level is within 10 of your team's level: worth the EXP. */
  exp: boolean;
  goals: number;
}

/** "Worth the EXP" window below your team's level. */
export const EXP_WINDOW = 10;

export function sessionRoutes(ds: Dataset, input: RouteInput, limit = 3): RouteStop[] {
  const out: RouteStop[] = [];
  for (const map of ds.wild?.maps ?? []) {
    const access = input.access(map.id);
    if (access === 'locked') continue;
    const catches = new Map<number, RouteStop['catches'][number]>();
    const best = new Map<StatKey, RouteStop['evs'][number]>();
    for (const e of map.encounters) {
      const s = ds.species[e.species];
      if (!s) continue;
      if (input.hunt.has(e.species) && !catches.has(e.species)) catches.set(e.species, { species: e.species, name: s.name, rarity: e.rarity });
      for (const k of STATS) {
        const amount = s.evYield?.[k] ?? 0;
        if (!amount || !input.needs.get(k)) continue;
        const cur = best.get(k);
        if (!cur || amount > cur.amount) best.set(k, { species: e.species, name: s.name, stat: k, amount, rarity: e.rarity });
      }
    }
    const exp = input.teamLevel !== undefined && map.levels[1] >= input.teamLevel - EXP_WINDOW;
    const evs = [...best.values()];
    const goals = (catches.size ? 1 : 0) + (evs.length ? 1 : 0) + (exp ? 1 : 0);
    if (goals) out.push({ map, access, catches: [...catches.values()], evs, exp, goals });
  }
  const evTotal = (r: RouteStop) => r.evs.reduce((a, e) => a + e.amount, 0);
  return out.sort((a, b) => b.goals - a.goals || b.catches.length - a.catches.length || evTotal(b) - evTotal(a)).slice(0, limit);
}
