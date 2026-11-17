import type { TypeInfo } from '../shared/types';

export type TypeTable = Record<string, TypeInfo>;

/** Abilities that change how a defender takes a type (display names, as the game writes them). */
const ABILITY_MODIFIERS: Record<string, Record<string, number>> = {
  Levitate: { Ground: 0 },
  'Earth Eater': { Ground: 0 },
  'Flash Fire': { Fire: 0 },
  'Well-Baked Body': { Fire: 0 },
  'Water Absorb': { Water: 0 },
  'Storm Drain': { Water: 0 },
  'Dry Skin': { Water: 0, Fire: 1.25 },
  'Volt Absorb': { Electric: 0 },
  'Lightning Rod': { Electric: 0 },
  'Motor Drive': { Electric: 0 },
  'Sap Sipper': { Grass: 0 },
  'Thick Fat': { Fire: 0.5, Ice: 0.5 },
  Heatproof: { Fire: 0.5 },
  'Water Bubble': { Fire: 0.5 },
  'Purifying Salt': { Ghost: 0.5 },
  Fluffy: { Fire: 2 },
};

/** Multiplier of an attacking type against a list of defending types (pure type chart). */
export function typeEffectiveness(table: TypeTable, attack: string, defend: string[]): number {
  const info = table[attack];
  if (!info) return 1;
  let mult = 1;
  for (const d of defend) {
    if (info.none.includes(d)) return 0;
    if (info.double.includes(d)) mult *= 2;
    else if (info.half.includes(d)) mult *= 0.5;
  }
  return mult;
}

/**
 * Type chart plus the defender's ability. When the ability is uncertain
 * (several possible), a modifier is applied only if ALL candidates agree,
 * so the advice never assumes an immunity that might not be there.
 */
export function effectiveness(table: TypeTable, attack: string, defend: string[], abilities?: string[]): number {
  let mult = typeEffectiveness(table, attack, defend);
  if (abilities && abilities.length) {
    const mods = abilities.map((a) => ABILITY_MODIFIERS[a]?.[attack]);
    if (mods.every((m) => m !== undefined)) mult *= Math.max(...(mods as number[]));
    if (abilities.every((a) => a === 'Wonder Guard') && mult <= 1) mult = 0;
  }
  return mult;
}

export function formatMult(m: number): string {
  if (m === 0) return '×0';
  if (m === 0.25) return '×¼';
  if (m === 0.5) return '×½';
  return `×${+m.toFixed(2)}`;
}

export const ALL_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];
