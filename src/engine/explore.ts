import type { BoxMon, Dataset, ExploreMap, NpcTeamVariant, Species, WildEncounter } from '../shared/types';
import { bestAttackTypes, npcThreats } from './analysis';
import { effectiveness } from './typeChart';

/** Rarity tiers you can realistically farm (extremely rare ≈ 1%, legendary ≈ 0.02%). */
export const FINDABLE_RARITIES: ReadonlySet<string> = new Set(['common', 'rare']);
const NOT_WILD: ReadonlySet<string> = new Set(['event', 'unavailable', 'world-boss', 'quest', 'achievement']);

export const METHOD_LABEL: Record<string, string> = { walking: 'Walking', surf: 'Surf', oldrod: 'Old Rod', goodrod: 'Good Rod', superrod: 'Super Rod' };
export const RARITY_LABEL: Record<string, string> = { common: 'Common', rare: 'Rare', 'extremely-rare': 'Extremely rare', legendary: 'Legendary' };

export const isFishing = (method: string) => /rod$/.test(method);

/** A row is findable when its tier is common/rare, it actually spawns, and the species is a normal wild one. */
export function isFindable(ds: Dataset, e: WildEncounter): boolean {
  if (!FINDABLE_RARITIES.has(e.rarity)) return false;
  if (Math.max(e.day, e.night) <= 0) return false;
  const s = ds.species[e.species];
  return !s?.availability || !NOT_WILD.has(s.availability);
}

export interface EncounterRow {
  map: ExploreMap;
  enc: WildEncounter;
  species: Species | undefined;
}

export interface EncounterFilter {
  /** Species name (substring, case-insensitive). */
  query?: string;
  type?: string;
  mapId?: string;
  findableOnly?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function filterEncounters(ds: Dataset, f: EncounterFilter = {}): EncounterRow[] {
  const q = f.query ? norm(f.query) : '';
  const out: EncounterRow[] = [];
  for (const map of ds.wild?.maps ?? []) {
    if (f.mapId && map.id !== f.mapId) continue;
    for (const enc of map.encounters) {
      const species = ds.species[enc.species];
      if (q && !norm(species?.name ?? '').includes(q)) continue;
      if (f.type && !species?.types.includes(f.type)) continue;
      if (f.findableOnly && !isFindable(ds, enc)) continue;
      out.push({ map, enc, species });
    }
  }
  return out.sort((a, b) => Math.max(b.enc.day, b.enc.night) - Math.max(a.enc.day, a.enc.night));
}

/** "Where do I find X?": every map/method for one species, most likely first. */
export function whereToFind(ds: Dataset, speciesId: number): EncounterRow[] {
  const out: EncounterRow[] = [];
  for (const map of ds.wild?.maps ?? []) for (const enc of map.encounters) if (enc.species === speciesId) out.push({ map, enc, species: ds.species[speciesId] });
  return out.sort((a, b) => Math.max(b.enc.day, b.enc.night) - Math.max(a.enc.day, a.enc.night));
}

/** Species ids that appear as findable encounters on some map. */
export function findableSpecies(ds: Dataset): Set<number> {
  const out = new Set<number>();
  for (const map of ds.wild?.maps ?? []) for (const e of map.encounters) if (isFindable(ds, e)) out.add(e.species);
  return out;
}

export const ownedSpecies = (box: BoxMon[]) => new Set(box.map((b) => b.species));

/* ---------- "wanted" species vs the selected NPC ---------- */

export interface WantedSpecies {
  species: Species;
  score: number;
  /** Its types that hit the NPC team hard. */
  attackTypes: string[];
  /** NPC moves it resists (count of NPC users). */
  resists: number;
  weakTo: number;
  owned: boolean;
}

function points(mult: number): number {
  if (mult === 0) return -3;
  if (mult >= 4) return 2;
  if (mult >= 2) return 1;
  if (mult <= 0.25) return -2;
  if (mult <= 0.5) return -1;
  return 0;
}

/**
 * Scores findable wild species by TYPE MATCHUP against an NPC team (own types of the
 * catchable form, not its evolutions): best STAB attack type score ×2, plus how well its
 * types take the NPC's damaging moves. Read-only use of analysis.ts, no team-builder coupling.
 */
export function wantedSpecies(ds: Dataset, v: NpcTeamVariant, box: BoxMon[], limit = 30): WantedSpecies[] {
  const attack = new Map(bestAttackTypes(ds, v).map((a) => [a.type, a]));
  const threats = npcThreats(ds, v);
  const owned = ownedSpecies(box);
  const out: WantedSpecies[] = [];
  for (const id of findableSpecies(ds)) {
    const s = ds.species[id];
    if (!s) continue;
    const off = Math.max(...s.types.map((t) => attack.get(t)?.score ?? 0));
    const attackTypes = s.types.filter((t) => (attack.get(t)?.score ?? 0) > 0 && (attack.get(t)?.superEffective ?? 0) > 0);
    let def = 0;
    let resists = 0;
    let weakTo = 0;
    for (const t of threats) {
      const m = effectiveness(ds.types, t.type, s.types);
      def -= points(m) * t.users.length;
      if (m < 1) resists += t.users.length;
      if (m > 1) weakTo += t.users.length;
    }
    const score = off * 2 + def;
    if (score <= 0 || !attackTypes.length) continue;
    out.push({ species: s, score, attackTypes, resists, weakTo, owned: owned.has(id) });
  }
  return out.sort((a, b) => b.score - a.score || a.species.id - b.species.id).slice(0, limit);
}

/* ---------- wild held items ---------- */

export interface HeldChance {
  itemId: string;
  name: string;
  chance: number;
  /** Map-specific source; undefined = any map. */
  mapIds?: string[];
  category?: string;
}

/** Items this species can hold in the wild (specific sources only; type-wide rules are prose). */
export function wildHeldItems(ds: Dataset, speciesId: number, mapId?: string): HeldChance[] {
  const out: HeldChance[] = [];
  for (const it of Object.values(ds.items)) {
    for (const w of it.wildSources ?? []) {
      if (w.species !== speciesId) continue;
      if (mapId && w.mapIds.length && !w.mapIds.includes(mapId)) continue;
      out.push({ itemId: it.id, name: it.name, chance: w.chance, mapIds: w.mapIds, category: it.category });
    }
  }
  return out.sort((a, b) => b.chance - a.chance);
}

/* ---------- fight or catch ---------- */

export interface WildTarget {
  species: number;
  level?: number;
  /** Item id or display name it holds, when the battle screen shows one. */
  item?: string | null;
  shiny?: boolean;
  /** The user says its IVs look good. */
  goodIvs?: boolean;
  /** From the game's encounter card: "[in box: N]" (owned now, team and reserved included). */
  inBox?: number;
  /** From the game's encounter card: Pokédex icon (registered as obtained). */
  registered?: boolean;
  /** From the game's encounter card: on this week's Catchlist. */
  catchlist?: boolean;
}

export interface CatchDecision {
  verdict: 'catch' | 'fight';
  reasons: string[];
  /** Short line for the badge. */
  summary: string;
  /** Things that may still make a catch worth it; they never change the verdict. */
  hints: string[];
}

/** Items not worth a ball on their own (common medicine the shop sells). */
const CHEAP_ITEMS: ReadonlySet<string> = new Set(['potion', 'oranberry', 'berryjuice']);

/**
 * CATCH only when it is on this week's Catchlist or not registered in your Pokédex (the card's
 * icon); anything else is FIGHT for EXP. Shiny, a held item, good IVs or countering the NPC you
 * selected are listed as hints but never flip the verdict. Without the card (manual mode) the
 * Pokédex is unknown, so your box stands in for it.
 */
export function fightOrCatch(ds: Dataset, t: WildTarget, box: BoxMon[], wanted: ReadonlySet<number> = new Set(), opts: { npcName?: string } = {}): CatchDecision {
  const s = ds.species[t.species];
  const name = s?.name ?? 'It';
  const hints: string[] = [];
  if (t.shiny) hints.push('shiny');
  if (t.item) {
    const it = ds.items[t.item] ?? Object.values(ds.items).find((i) => norm(i.name) === norm(t.item!));
    const id = it?.id ?? norm(t.item);
    if (!CHEAP_ITEMS.has(id)) hints.push(`holds ${it?.name ?? t.item}`);
  }
  if (t.goodIvs) hints.push('good IVs');
  if (wanted.has(t.species)) hints.push(`counters ${opts.npcName ?? 'the NPC you selected'}`);
  if (s?.rarity === 'legendary') hints.push('legendary');

  const catchIt = (why: string): CatchDecision => ({ verdict: 'catch', reasons: [why], summary: 'CATCH', hints });
  if (t.catchlist) return catchIt("On this week's Catchlist.");
  if (t.registered === false) return catchIt(`Not in your Pokédex yet: ${name} is a new entry.`);
  if (t.registered === undefined && !ownedSpecies(box).has(t.species)) {
    return catchIt(`${name} is not in your box (MeowRPGAdvisor can't see your Pokédex here): likely a new entry.`);
  }
  const why = t.registered === undefined
    ? `You have ${name} in your box → fight for EXP.`
    : t.catchlist === undefined ? 'Registered (no Catchlist marker read) → fight for EXP.' : 'Registered, not on Catchlist → fight for EXP.';
  return { verdict: 'fight', reasons: [why], summary: 'FIGHT', hints };
}

/* ---------- matching the game's encounter card ---------- */

/** Species from the card name; forms may read "Deerling-Autumn" or "Autumn Deerling". */
export function speciesByCardName(ds: Dataset, name: string) {
  const all = Object.values(ds.species);
  const words = name.split(/\s+/);
  const cands = [name, words.length > 1 ? `${words.slice(1).join(' ')}-${words[0]}` : '', name.replace(/\s+/g, '-')].filter(Boolean).map(norm);
  for (const c of cands) {
    const hit = all.find((x) => norm(x.name) === c);
    if (hit) return hit;
  }
  return undefined;
}

/** Explore map for the page title ("Grasslands 3" → Grasslands), preferring one where this species spawns. */
export function mapForCard(ds: Dataset, title: string | undefined, speciesId: number) {
  const where = whereToFind(ds, speciesId);
  const t = norm(title ?? '');
  const byTitle = where.filter((w) => t && t.startsWith(norm(w.map.name))).sort((a, b) => b.map.name.length - a.map.name.length);
  const pick = byTitle.find((w) => w.enc.method === 'walking') ?? byTitle[0] ?? where[0];
  return pick ? { mapId: pick.map.id, method: pick.enc.method, top: pick.enc.levels[1] } : undefined;
}
