import { signal } from '@preact/signals';
import type { BoxMon, Dataset, Npc, NpcTeamVariant } from '../shared/types';
import { brainLevel, facilityOf, highestEligible, withLevel, type LevelMode } from '../engine/frontier';

/** Battle Frontier level category picked in the NPC / Team tabs (remembered per browser). */
const KEY = 'mh-frontier-level';
function read(): LevelMode {
  try {
    return localStorage.getItem(KEY) === 'open' ? 'open' : 'lv50';
  } catch {
    return 'lv50';
  }
}
export const levelMode = signal<LevelMode>(read());
export function setLevelMode(m: LevelMode) {
  levelMode.value = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* private window */
  }
}

/**
 * The Brain team at the level it really has: 50 in Level 50; in Open Level your highest registered
 * level (minimum 60) – estimated from your highest Pokémon that may enter.
 */
export function frontierVariant(ds: Dataset, box: BoxMon[], npc: Npc, v: NpcTeamVariant, mode: LevelMode): { v: NpcTeamVariant; level: number; estimated: boolean } {
  const f = facilityOf(npc);
  if (!f) return { v, level: 0, estimated: false };
  const top = mode === 'open' ? highestEligible(ds, box, f, mode) : undefined;
  const level = brainLevel(mode, top);
  return { v: withLevel(v, level), level, estimated: mode === 'open' };
}
