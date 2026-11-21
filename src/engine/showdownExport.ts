import type { BoxMon, Dataset, NpcMon, StatKey, StatTable } from '../shared/types';

/**
 * Pokémon Showdown team text, for the game wiki's Battle Simulator "Text" import. Pure text: the
 * extension makes no request, the user pastes it. Same field meanings as boxToCalc / npcToCalc.
 */

export interface ShowdownSet {
  species: string;
  gender?: string; // 'M' | 'F'; anything else is left out
  item?: string;
  ability?: string;
  level?: number;
  shiny?: boolean;
  happiness?: number;
  evs?: Partial<StatTable>;
  nature?: string;
  ivs?: Partial<StatTable>;
  moves: string[];
}

const STATS: [StatKey, string][] = [['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'], ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe']];

const statLine = (label: string, t: Partial<StatTable> | undefined, skip: number) => {
  const parts = STATS.filter(([k]) => (t?.[k] ?? skip) !== skip).map(([k, l]) => `${t![k]} ${l}`);
  return parts.length ? `${label}: ${parts.join(' / ')}` : '';
};

export function toShowdownSet(s: ShowdownSet): string {
  const g = s.gender === 'M' || s.gender === 'F' ? ` (${s.gender})` : '';
  const lines = [`${s.species}${g}${s.item ? ` @ ${s.item}` : ''}`];
  if (s.ability) lines.push(`Ability: ${s.ability}`);
  if (s.level) lines.push(`Level: ${s.level}`);
  if (s.shiny) lines.push('Shiny: Yes');
  if (s.happiness !== undefined) lines.push(`Happiness: ${s.happiness}`);
  lines.push(statLine('EVs', s.evs, 0));
  if (s.nature) lines.push(`${s.nature} Nature`);
  lines.push(statLine('IVs', s.ivs, 31));
  for (const m of s.moves) lines.push(`- ${m}`);
  return lines.filter(Boolean).join('\n');
}

export const toShowdownTeam = (sets: ShowdownSet[]) => sets.map(toShowdownSet).join('\n\n');

const nature = (n?: string) => (n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : undefined);

function common(ds: Dataset, m: { species: number; item?: string | null; moves: string[]; ability?: string; nature?: string }) {
  return {
    species: ds.species[m.species]?.name ?? '',
    item: m.item ? ds.items[m.item]?.name ?? m.item : undefined,
    ability: m.ability || undefined,
    nature: nature(m.nature),
    moves: m.moves.map((id) => ds.moves[id]?.name ?? id),
  };
}

/** Your box Pokémon. Manual entries without IVs are average (15), like boxToCalc. */
export function boxToShowdown(ds: Dataset, b: BoxMon, defaultLevel = 50): ShowdownSet {
  const avg = { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 };
  return {
    ...common(ds, b),
    gender: b.gender,
    level: b.level ?? defaultLevel,
    shiny: b.shiny,
    evs: b.evs,
    ivs: b.ivs ?? (b.source === 'game' ? undefined : avg),
  };
}

/** An NPC Pokémon. Missing nature or ability stays out of the text; a variable ability uses the first one, like npcToCalc. */
export function npcToShowdown(ds: Dataset, m: NpcMon, assumedLevel = 50): ShowdownSet {
  return {
    ...common(ds, { ...m, ability: m.ability ?? m.possibleAbilities?.[0] }),
    species: ds.species[m.species]?.name ?? m.name,
    gender: m.gender,
    level: m.level ?? assumedLevel,
    evs: m.evs,
    ivs: m.ivs,
  };
}
