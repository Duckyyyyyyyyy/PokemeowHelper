import { Generations, toID } from '@smogon/calc';
import type { BoxMon, Dataset, Move, Species, TypeInfo } from '../shared/types';

/**
 * Battle Frontier uses Generation III rules (wiki "Frontier battle rules", read 2026-11-19):
 *  - no Fairy type: species and moves use their Gen III typing (Gardevoir pure Psychic, Charm Normal);
 *  - the move's TYPE decides physical vs special (Shadow Ball uses Attack, Crunch uses Sp. Atk);
 *  - Gen III move power/accuracy, species base stats and abilities (a later ability, Hidden ones
 *    included, becomes one of the species' Gen III abilities);
 *  - Steel resists Ghost and Dark;
 *  - only Gen I–III moves and held items can be registered (no Life Orb, Choice Scarf/Specs,
 *    Focus Sash, Assault Vest…); no Mega, Z, Dynamax or Tera.
 *
 * `gen3View(ds)` derives a Dataset with all of that applied (species types/stats/abilities, moves,
 * type chart) and `ruleset: 'gen3'`, which makes damage.ts run @smogon/calc with gen 3 mechanics
 * (crit ×2, Gen III items and abilities). Every scorer then works unchanged on the derived data.
 */
export const GEN3 = Generations.get(3);

/** Types whose damaging moves use Attack in Gen III (the rest use Sp. Atk). */
export const GEN3_PHYSICAL_TYPES: ReadonlySet<string> = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);
export const gen3Category = (type: string): 'Physical' | 'Special' => (GEN3_PHYSICAL_TYPES.has(type) ? 'Physical' : 'Special');

/** Last national dex number of Generation III. */
export const GEN3_LAST_DEX = 386;

/**
 * Restricted species. The wiki only says "restricted species … are excluded" and that the entry
 * picker shows exact eligibility. This list is Pokémon Emerald's Battle Frontier ban list
 * (UNCONFIRMED for PokeMeowRPG – labelled as a guess in the UI).
 */
export const RESTRICTED_GUESS: ReadonlySet<number> = new Set([150, 151, 249, 250, 251, 382, 383, 384, 385, 386]);

const views = new WeakMap<Dataset, Dataset>();
const bases = new WeakMap<Dataset, Dataset>();

/** The normal (Gen 9) data behind a Gen III view; the dataset itself otherwise. */
export function baseOf(ds: Dataset): Dataset {
  return bases.get(ds) ?? ds;
}

export function isGen3(ds: Dataset): boolean {
  return ds.ruleset === 'gen3';
}

/** The Gen III species entry for a game species (by name, as the calc dex knows it). */
export function gen3Species(name: string | undefined) {
  if (!name) return undefined;
  const fixed = name.replace(/♀/g, '-F').replace(/♂/g, '-M'); // Nidoran♀ → Nidoran-F (calc dex name)
  for (const cand of [fixed, fixed.replace(/\s+/g, '-')]) {
    const sp = GEN3.species.get(toID(cand));
    if (sp) return sp;
  }
  return undefined;
}

export function gen3Move(id: string) {
  return GEN3.moves.get(toID(id));
}
export function gen3Item(id: string | null | undefined) {
  return id ? GEN3.items.get(toID(id)) : undefined;
}
export function gen3Ability(name: string | undefined) {
  return name ? GEN3.abilities.get(toID(name)) : undefined;
}

/** Gen III type chart in the Dataset's shape (no Fairy; Steel resists Ghost and Dark). */
export function gen3TypeTable(): Record<string, TypeInfo> {
  const out: Record<string, TypeInfo> = {};
  for (const t of GEN3.types) {
    if (t.name === '???') continue;
    const info: TypeInfo = { name: t.name, double: [], half: [], none: [] };
    for (const [def, m] of Object.entries(t.effectiveness as Record<string, number>)) {
      if (def === '???') continue;
      if (m === 0) info.none.push(def);
      else if (m === 2) info.double.push(def);
      else if (m === 0.5) info.half.push(def);
    }
    out[t.name] = info;
  }
  return out;
}

/**
 * The Gen III view of the game data (memoized per Dataset). Species and moves that do not exist in
 * Gen III keep their entry but are marked (`gen3: false` via gen3Issues) – species with Fairy typing
 * lose it, so a stray later Pokémon on the screen still gets a sane type.
 */
export function gen3View(ds: Dataset): Dataset {
  if (isGen3(ds)) return ds;
  const hit = views.get(ds);
  if (hit) return hit;
  const species: Record<number, Species> = {};
  for (const [k, s] of Object.entries(ds.species)) {
    const g = s.id <= GEN3_LAST_DEX ? gen3Species(s.name) : undefined;
    if (g) {
      const abilities = Object.values(g.abilities ?? {}).filter(Boolean).map((a) => ({ id: toID(a as string), name: a as string, hidden: false }));
      species[+k] = { ...s, types: [...g.types], baseStats: { ...g.baseStats }, abilities };
    } else {
      const types = s.types.filter((t) => t !== 'Fairy');
      species[+k] = { ...s, types: types.length ? types : ['Normal'] };
    }
  }
  const moves: Record<string, Move> = {};
  for (const [id, m] of Object.entries(ds.moves)) {
    const g = gen3Move(id);
    if (!g) continue; // later moves cannot be registered: not scored (flagged by gen3Issues)
    const status = m.category === 'Status' || (g as { category?: string }).category === 'Status';
    moves[id] = {
      ...m,
      type: g.type,
      category: status ? 'Status' : gen3Category(g.type),
      power: status ? 0 : g.basePower ?? m.power,
    };
  }
  const view: Dataset = { ...ds, species, moves, types: gen3TypeTable(), ruleset: 'gen3' };
  views.set(ds, view);
  bases.set(view, ds);
  return view;
}

export interface Gen3Issue {
  kind: 'species' | 'restricted' | 'move' | 'item' | 'ability';
  text: string;
  /** true = this Pokémon cannot be registered at all. */
  blocking: boolean;
}

/**
 * What stops (or changes) one of your Pokémon under Frontier rules. `ds` is the normal (Gen 9) data
 * so names read as the game writes them.
 */
export function gen3Issues(ds: Dataset, mon: BoxMon): Gen3Issue[] {
  const out: Gen3Issue[] = [];
  const s = ds.species[mon.species];
  const name = s?.name ?? `#${mon.species}`;
  const g = mon.species <= GEN3_LAST_DEX ? gen3Species(s?.name) : undefined;
  if (!g) out.push({ kind: 'species', text: `${name} is not a Generation I–III Pokémon (or form)`, blocking: true });
  else if (RESTRICTED_GUESS.has(mon.species)) out.push({ kind: 'restricted', text: `${name} is probably restricted (Emerald's Frontier ban list – the wiki gives no list)`, blocking: true });
  const later = mon.moves.filter((id) => ds.moves[id] && !gen3Move(id));
  if (later.length) out.push({ kind: 'move', text: `Not in Gen III, cannot be registered: ${later.map((id) => ds.moves[id]?.name ?? id).join(', ')}`, blocking: false });
  if (mon.item && !gen3Item(mon.item)) out.push({ kind: 'item', text: `${ds.items[mon.item]?.name ?? mon.item} is not a Gen III item: swap it before registering`, blocking: false });
  if (g && mon.ability) {
    const legal = Object.values(g.abilities ?? {}) as string[];
    if (!legal.includes(mon.ability)) out.push({ kind: 'ability', text: `${mon.ability} becomes ${legal.join(' or ')} (Gen III ability)`, blocking: false });
  }
  return out;
}

/** The ability a Pokémon battles with under Gen III rules (a later ability maps to the species' first Gen III one). */
export function gen3AbilityFor(speciesName: string | undefined, ability: string | undefined): string | undefined {
  const g = gen3Species(speciesName);
  const legal = g ? (Object.values(g.abilities ?? {}) as string[]) : [];
  if (ability && legal.includes(ability)) return ability;
  if (legal.length) return legal[0];
  return gen3Ability(ability)?.name;
}
