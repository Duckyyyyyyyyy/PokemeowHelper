import type { NpcCategory } from '../shared/types';

/**
 * Friendship, your side only. Rule text from the game's Battle Simulator guide (2026-11-22):
 * at 180 or more a hit that would KO your Pokémon has a 10% chance to leave it at 1 HP (15% at 220,
 * 20% at 255); at 255 your crit chance doubles and the opponent's moves lose 10 accuracy.
 * Applies in trainer battles (Gyms, Elite Four, Champions, rematches, Rivals, Battle Towers, other
 * NPC trainers), League, Mega Chamber and wild battles; not in Player Battles or World Boss battles.
 */

/** Chance a KO hit leaves your Pokémon at 1 HP instead. */
export function friendshipSurvival(f: number | undefined): number {
  if (f === undefined) return 0;
  return f >= 255 ? 0.2 : f >= 220 ? 0.15 : f >= 180 ? 0.1 : 0;
}

/** Max friendship: crit chance ×2, their moves −10 accuracy. */
export const friendshipMax = (f: number | undefined) => (f ?? 0) >= 255;

/** Kinds that have it. The real `data-kind` values are confirmed only for "gym"; the rest are guesses. */
const HAS = /gym|league|elite|champion|rival|rocket|trainer|rematch|tower|mega|chamber|wild/i;
/** Player Battles and World Boss: no friendship. Battle Frontier is not mentioned: none (Gen III rules, a guess). */
const NONE = /player|pvp|boss|frontier/i;
const HAS_CATEGORY: NpcCategory[] = ['gym', 'elite-four', 'champion', 'tower', 'mega', 'rival', 'rocket'];

/**
 * Whether friendship effects apply in this battle: vetoes first (Player Battle, World Boss, Frontier /
 * Gen III rules), then the matched NPC's category, then the arena kind. Unknown → none (conservative).
 */
export function friendshipApplies(kind: string | undefined, category?: NpcCategory, gen3?: boolean): boolean {
  if (gen3 || category === 'boss' || category === 'frontier') return false;
  if (kind && NONE.test(kind)) return false;
  if (category && HAS_CATEGORY.includes(category)) return true;
  return !!kind && HAS.test(kind);
}

/** Battle tab note, e.g. "Friendship 220: 15% to survive a KO hit at 1 HP." (undefined below 180). */
export function friendshipNote(name: string, f: number | undefined): string | undefined {
  const p = friendshipSurvival(f);
  if (!p) return undefined;
  const max = friendshipMax(f) ? ' Your crit chance is doubled and their moves have 10 less accuracy.' : '';
  return `Friendship ${f}: ${Math.round(p * 100)}% to survive a KO hit at 1 HP (${name}).${max} Counted in the odds; not checked in a real battle.`;
}
