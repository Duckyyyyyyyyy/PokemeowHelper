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
export const SCHEMA_VERSION = 3;

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
