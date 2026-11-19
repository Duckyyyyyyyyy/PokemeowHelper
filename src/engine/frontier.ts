import type { BoxMon, Dataset, Npc, NpcTeamVariant } from '../shared/types';
import { gen3Issues, gen3Species } from './gen3';

/**
 * Battle Frontier facilities, summarised from the wiki (read 2026-11-19):
 * "Battle Frontier" (#/challenges/battle-frontier), "Frontier battle rules"
 * (#/challenges/battle-frontier/battle-rules) and one page per facility
 * (#/challenges/battle-frontier/<id>). Every field below is stated there unless marked otherwise.
 *
 * Common to all facilities (Battle Frontier page):
 *  - unlocks after Hoenn Champion Wallace; Level 50 or Open Level category, separate streaks;
 *  - only eligible Gen I–III Pokémon, moves and held items; restricted species, Megas and later
 *    forms excluded; duplicate species and duplicate held items are restricted (clauses);
 *  - Level 50 accepts Pokémon at level 50 or below WITHOUT scaling them; Open Level opponents
 *    match your highest registered level, minimum 60;
 *  - Brain teams are fixed (moves/items/natures/IVs/EVs), the ability is random among the
 *    species' Gen III abilities; Brain level = 50, or Open Level rule above;
 *  - new Hardcore runs permanently lose owned Pokémon that faint (Factory rentals exempt);
 *  - a Brain win adds 10 BP; the wallet holds up to 9,999 BP.
 * Opponents other than the Brains use Pokémon Emerald's Frontier teams and AI: the wiki data file
 * has NO pool of them, so MeowRPGAdvisor can only plan against the Brains plus general Gen III advice.
 */
export type LevelMode = 'lv50' | 'open';

export interface Facility {
  id: string;
  name: string;
  /** Pokémon you register / use per battle. */
  register: number;
  battleWith: number;
  /** Your team is fully restored between battles. */
  restored: boolean;
  /** HP, status and PP carry from one battle (room/floor) to the next. */
  carryOver: boolean;
  /** You may switch during battles. */
  switching: boolean;
  /** Registered Pokémon may hold items. */
  heldItems: boolean;
  /** Uses your own Pokémon (false = rentals). */
  ownTeam: boolean;
  round: string;
  symbols: string;
  bp: string;
  rules: string[];
  source: string;
}

const W = '#/challenges/battle-frontier/';

export const FACILITIES: Record<string, Facility> = {
  tower: {
    id: 'tower', name: 'Battle Tower', register: 3, battleWith: 3, restored: true, carryOver: false, switching: true, heldItems: true, ownTeam: true,
    round: '7 singles battles', symbols: 'Silver at 35 wins, Gold at 70 (Salon Maiden Anabel), then she returns every 35 wins',
    bp: '1 BP for the first set, +1 per set up to 15; Anabel +10',
    rules: ['Full 3-on-3 singles; your team is fully restored after every battle, so use your strongest moves freely.', 'Bag items cannot be used.'],
    source: `${W}tower`,
  },
  dome: {
    id: 'dome', name: 'Battle Dome', register: 3, battleWith: 2, restored: true, carryOver: false, switching: true, heldItems: true, ownTeam: true,
    round: '4-match tournament', symbols: 'Silver at 5 tournaments, Gold at 10 (Dome Ace Tucker in the final)',
    bp: '1 BP for the first two tournaments, rising to 15; Tucker +10',
    rules: ['You see the opponent\'s species and scouting notes, then pick 2 of your 3 for that match.', 'Restored between matches; Bag items cannot be used.'],
    source: `${W}dome`,
  },
  palace: {
    id: 'palace', name: 'Battle Palace', register: 3, battleWith: 3, restored: true, carryOver: false, switching: true, heldItems: true, ownTeam: true,
    round: '7 battles', symbols: 'Silver at 21, Gold at 42 (Palace Maven Spenser)',
    bp: '4 BP for the first two sets, rising to 15; Spenser +10',
    rules: ['You cannot pick moves: each Pokémon picks by its ORIGINAL nature (mints do not count); you can switch.', 'Mostly attacking movesets waste fewer turns. Move advice below is about damage only.'],
    source: `${W}palace`,
  },
  arena: {
    id: 'arena', name: 'Battle Arena', register: 3, battleWith: 3, restored: true, carryOver: false, switching: false, heldItems: true, ownTeam: true,
    round: '7 battles', symbols: 'Silver at 28, Gold at 56 (Arena Tycoon Greta)',
    bp: '1 BP for the first three sets, rising to 15; Greta +10',
    rules: ['Fixed order, no switching; Baton Pass, Roar and Whirlwind fail.', 'After 3 turns judges score Mind (attacks), Skill (super-effective hits) and Body (HP kept): the loser faints.'],
    source: `${W}arena`,
  },
  factory: {
    id: 'factory', name: 'Battle Factory', register: 3, battleWith: 3, restored: true, carryOver: false, switching: true, heldItems: true, ownTeam: false,
    round: '7 battles', symbols: 'Silver at 21, Gold at 42 (Factory Head Noland, random team)',
    bp: '3 BP for the first two sets, rising to 15; Noland +10',
    rules: ['Rental Pokémon only (level 50, or 100 in Open Level); your own Pokémon stay outside.', 'Restored between battles (assumed: the page does not say).'],
    source: `${W}factory`,
  },
  pike: {
    id: 'pike', name: 'Battle Pike', register: 3, battleWith: 3, restored: false, carryOver: true, switching: true, heldItems: true, ownTeam: true,
    round: '14 rooms', symbols: 'Silver at 28 rooms, Gold at 140 (Pike Queen Lucy)',
    bp: '1 BP for the first two rounds, rising to 15; Lucy +10',
    rules: ['HP, status and PP carry between rooms; party order stays fixed between battles.', 'Rooms: battles (one tougher trainer restores you after a win), doubles, wild corridors, healing or status attacks.'],
    source: `${W}pike`,
  },
  pyramid: {
    id: 'pyramid', name: 'Battle Pyramid', register: 3, battleWith: 3, restored: false, carryOver: true, switching: true, heldItems: false, ownTeam: true,
    round: '7 floors', symbols: 'Silver at 21 floors, Gold at 70 (Pyramid King Brandon)',
    bp: '5 BP for the first two rounds, rising to 15; Brandon +10',
    rules: ['Register Pokémon WITHOUT held items; a separate Battle Bag (items found on the floors) heals or equips them.', 'HP, status and PP carry between floors; poisoned Pokémon lose HP while walking.'],
    source: `${W}pyramid`,
  },
};

export function facilityOf(npc: Npc | null | undefined): Facility | undefined {
  if (!npc || npc.category !== 'frontier') return undefined;
  return FACILITIES[npc.id.replace(/^frontier:/, '')] ?? FACILITIES[(npc.location ?? '').toLowerCase()];
}

/** Brain level: 50 in the Level 50 category; Open Level = your highest registered level, minimum 60. */
export function brainLevel(mode: LevelMode, highestRegistered?: number): number {
  return mode === 'lv50' ? 50 : Math.max(60, highestRegistered ?? 60);
}

/** The variant with every unlevelled NPC Pokémon set to `level` (Brain sets carry no level). */
export function withLevel(v: NpcTeamVariant, level: number): NpcTeamVariant {
  return { ...v, team: v.team.map((m) => (m.level ? m : { ...m, level })) };
}

/** Why one of your Pokémon can't enter (blocking) and what changes for it (notes), under Frontier rules. */
export interface Entry {
  blocking: string[];
  notes: string[];
}

export function frontierEntry(ds: Dataset, mon: BoxMon, f: Facility, mode: LevelMode): Entry {
  const out: Entry = { blocking: [], notes: [] };
  for (const i of gen3Issues(ds, mon)) (i.blocking ? out.blocking : out.notes).push(i.text);
  if (mode === 'lv50' && (mon.level ?? 0) > 50) out.blocking.push(`Lv ${mon.level}: the Level 50 category takes level 50 or below (no downscaling)`);
  if (!f.heldItems && mon.item) out.notes.push('Pyramid: register it without a held item');
  return out;
}

/** Highest level among Pokémon that may enter (Open Level opponents scale to your highest registered one). */
export function highestEligible(ds: Dataset, box: BoxMon[], f: Facility, mode: LevelMode): number | undefined {
  let top: number | undefined;
  for (const m of box) {
    if (frontierEntry(ds, m, f, mode).blocking.length) continue;
    if (m.level !== undefined && (top === undefined || m.level > top)) top = m.level;
  }
  return top;
}

/** Item clause: held items that appear twice on the team. */
export function itemClause(ds: Dataset, team: BoxMon[]): string[] {
  const seen = new Map<string, number>();
  for (const m of team) if (m.item) seen.set(m.item, (seen.get(m.item) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id]) => ds.items[id]?.name ?? id);
}

/** Gen III species check used by the NPC tab (Brains' Pokémon always pass). */
export const inGen3 = (ds: Dataset, species: number) => !!gen3Species(ds.species[species]?.name);
