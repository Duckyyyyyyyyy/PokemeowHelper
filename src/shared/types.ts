// ---------- Normalized dataset used by the whole extension ----------

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StatTable = Record<StatKey, number>;

export interface TypeInfo {
  name: string; // "Fire"
  /** Attacking with this type deals x2 / x0.5 / x0 against these defending types. */
  double: string[];
  half: string[];
  none: string[];
}

export interface SpeciesAbility {
  id: string;
  name: string;
  hidden: boolean;
}

export interface Species {
  id: number;
  name: string;
  types: string[];
  baseStats: StatTable;
  abilities: SpeciesAbility[];
  /** Level-up moves: [moveId, level]. */
  levelMoves: [string, number][];
  machineMoves: string[];
  eggMoves: string[];
  /** Wild catch data (schema 4+, missing in older cached data). Mainline-style catch rate 1–255. */
  catchRate?: number;
  /** Game rarity tier when found in the wild: common, rare, extremely-rare, legendary. */
  rarity?: string | null;
  /** How the game says it is obtained: wild, fishing, evolution, event, world-boss… */
  availability?: string;
  /** Extra condition for its spawn (seasonal forms etc.), from the wiki. */
  spawnRequirement?: string | null;
}

/** One wild encounter row of an explore map (rows with the same species + method are merged). */
export interface WildEncounter {
  species: number;
  rarity: string;
  /** walking, surf, oldrod, goodrod, superrod */
  method: string;
  levels: [number, number];
  /** Best chance per encounter, by day / by night, in the best spot of this map (0–1). */
  day: number;
  night: number;
  /** Sub-areas where it appears ("Walking · northwestern flower clearing"). */
  labels: string[];
  sections: string[];
}

export interface ExploreMap {
  id: string;
  name: string;
  /** Map theme from the wiki: grass, water, rock, fire… */
  theme: string;
  levels: [number, number];
  description: string;
  encounters: WildEncounter[];
}

/** Explore data (schema 4+). */
export interface WildData {
  maps: ExploreMap[];
  /** Species that evolve with a Moon Stone (Moon Ball). */
  moonStone: number[];
  /** mechanics.encounterChance etc. from the wiki. */
  encounterChance?: number;
}

export interface Move {
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  power: number;
  accuracy: number | true;
  pp: number;
  priority: number;
  target: string;
  description: string;
}

export interface Ability {
  id: string;
  name: string;
  summary: string;
}

export interface Item {
  id: string;
  name: string;
  effect: string;
  /** Schema 4+: bag category (balls, held, berries…), full description, wild holders. */
  category?: string;
  description?: string;
  /** Wild Pokémon that can hold this item: chance 0–1, on these maps. */
  wildSources?: { species: number; chance: number; mapIds: string[] }[];
  /** Prose rule for type/map-wide wild drops ("Fairy-type wild Pokémon … 5%"). */
  wildRule?: string;
  /** Wiki notes (e.g. "not currently awarded"). */
  notes?: string[];
}

export type NpcCategory =
  | 'gym'
  | 'elite-four'
  | 'champion'
  | 'tower'
  | 'frontier'
  | 'mega'
  | 'rival'
  | 'rocket'
  | 'boss';

export interface NpcMon {
  species: number;
  name: string;
  level?: number;
  gender?: string;
  moves: string[];
  /** Known ability (display name). */
  ability?: string;
  /** When the ability is one of several (Frontier Brains). */
  possibleAbilities?: string[];
  nature?: string;
  item?: string | null;
  baseStats: StatTable;
  ivs?: StatTable;
  evs?: Partial<StatTable>;
}

export interface NpcTeamVariant {
  label: string; // "First battle", "Rematch", "Silver", "Gold"
  format: 'singles' | 'doubles';
  team: NpcMon[];
  medicines: string[];
  /** Cap for YOUR team in this variant (rematches have none). */
  levelCap?: number;
  requirements?: string[];
  /** Set when this variant is fought against a different trainer (e.g. alternate Champion rematch). */
  trainerName?: string;
}

export interface Npc {
  id: string;
  name: string;
  title: string; // "Gym Leader", "Elite Four", ...
  category: NpcCategory;
  group?: string; // region name, chamber name, facility
  location?: string;
  specialty?: string; // type theme
  levelCap?: number;
  requirements: string[];
  trainerSprite?: string;
  variants: NpcTeamVariant[];
}

/** Bump when normalize() output changes, so cached data is rebuilt on next sync. */
export const SCHEMA_VERSION = 4;

export interface Dataset {
  /** `${SCHEMA_VERSION}:${hashed wiki data file name}` – changes on every game deploy or schema change. */
  version: string;
  syncedAt: number;
  types: Record<string, TypeInfo>;
  species: Record<number, Species>;
  moves: Record<string, Move>;
  abilities: Record<string, Ability>;
  items: Record<string, Item>;
  npcs: Npc[];
  /** Explore maps and wild data (schema 4+; undefined until the user syncs again). */
  wild?: WildData;
}

// ---------- The user's own Pokémon (synced from the game or entered by hand) ----------

export interface BoxMon {
  uid: string;
  species: number;
  level?: number;
  /** Optional known moves; empty = use STAB types only. */
  moves: string[];
  /** 'game' = read from the game by box sync (replaced on every sync); 'manual' = typed by the user. */
  source?: 'game' | 'manual';
  /** The game's own id for this Pokémon (box sync only). */
  gameId?: string;
  nature?: string;
  /** Ability display name when known (resolved from the game's ability slot). */
  ability?: string;
  item?: string | null;
  gender?: string;
  shiny?: boolean;
  ivs?: Partial<StatTable>;
  evs?: Partial<StatTable>;
}

export interface BoxSyncMeta {
  syncedAt: number;
  count: number;
}
