import { generateTips } from './tipsGen';
import type {
  Ability, Dataset, ExploreMap, Item, Move, Npc, NpcMon, NpcTeamVariant, Species, StatTable, TypeInfo, WildData, WildEncounter,
} from '../shared/types';

/* Raw shapes from the game's wiki data (only the fields we read). */
type Raw = Record<string, any>;

const CATEGORY_TITLE: Record<string, string> = {
  gym: 'Gym Leader',
  'elite-four': 'Elite Four',
  champion: 'Champion',
};

function mon(raw: Raw): NpcMon {
  return {
    species: raw.species,
    name: raw.name,
    level: typeof raw.level === 'number' ? raw.level : undefined,
    gender: raw.gender ?? undefined,
    moves: (raw.moves ?? []).map((m: any) => (typeof m === 'string' ? m : m.id)),
    ability: raw.ability ?? undefined,
    possibleAbilities: Array.isArray(raw.abilities) ? raw.abilities : undefined,
    nature: raw.nature ?? undefined,
    item: raw.item ?? null,
    baseStats: raw.baseStats as StatTable,
    ivs: raw.ivs ?? undefined,
    evs: raw.evs ?? undefined,
  };
}

function variant(label: string, format: string | undefined, team: Raw[], medicines?: string[]): NpcTeamVariant {
  return {
    label,
    format: format === 'doubles' ? 'doubles' : 'singles',
    team: team.map(mon),
    medicines: medicines ?? [],
  };
}

/* ---------- one adapter per source ---------- */

export function fromChallenges(list: Raw[]): Npc[] {
  return list.map((c) => {
    const first = { ...variant('First battle', c.format, c.team, c.medicines), levelCap: c.levelCap ?? undefined, requirements: c.requirements ?? [] };
    const variants: NpcTeamVariant[] = [first];
    if (c.rematch?.team?.length) {
      const fmt = c.rematch.format ?? c.format;
      variants.push({
        ...variant('Rematch', fmt, c.rematch.team, c.rematch.medicines),
        // Wiki, League Rematches: "Rematches have no level cap for your team.
        // Bring at least one Pokémon for singles or two for doubles."
        levelCap: undefined,
        requirements: ['Unlocks after beating the whole League in this region.', 'No level cap.', fmt === 'doubles' ? 'Bring at least 2 Pokémon (Doubles).' : 'Bring at least 1 Pokémon.'],
        trainerName: c.rematch.name && c.rematch.name !== c.name ? c.rematch.name : undefined,
      });
    }
    return {
      id: `challenge:${c.id}`,
      name: c.name,
      title: c.title || CATEGORY_TITLE[c.category] || c.category,
      category: c.category,
      group: c.regionName,
      location: c.city || undefined,
      specialty: c.type || undefined,
      levelCap: c.levelCap ?? undefined,
      requirements: c.requirements ?? [],
      trainerSprite: c.trainerSprite || undefined,
      variants,
      badge: c.badge || undefined,
      rewardItems: Array.isArray(c.rewardItems) && c.rewardItems.length ? c.rewardItems : undefined,
    } satisfies Npc;
  });
}

export function fromTowers(list: Raw[]): Npc[] {
  return list.map((t) => ({
    id: `tower:${t.id}`,
    name: t.name,
    title: t.guardian ? `Battle Tower · ${t.guardian}` : 'Battle Tower',
    category: 'tower',
    group: t.region ? cap(t.region) : undefined,
    specialty: t.type || undefined,
    requirements: t.requirement ? [t.requirement] : [],
    trainerSprite: t.trainerSprite || undefined,
    variants: [variant('20 Pokémon', 'singles', t.team)],
  }));
}

export function fromFrontierBrains(list: Raw[]): Npc[] {
  return list.map((b) => {
    const variants: NpcTeamVariant[] = [];
    if (b.silver?.length) variants.push(variant('Silver', 'singles', b.silver));
    if (b.gold?.length) variants.push(variant('Gold', 'singles', b.gold));
    return {
      id: `frontier:${b.facility}`,
      name: b.name,
      title: `Frontier Brain · ${b.title ?? ''}`.trim(),
      category: 'frontier',
      group: 'Battle Frontier',
      location: cap(b.facility),
      requirements: [],
      trainerSprite: b.trainerSprite || undefined,
      variants,
    } satisfies Npc;
  });
}

export function fromMegaChambers(list: Raw[]): Npc[] {
  return list.flatMap((ch) =>
    (ch.trainers ?? []).map((t: Raw, i: number) => ({
      id: `mega:${t.id ?? `${ch.id}-${i}`}`,
      name: t.name,
      title: 'Mega Chamber',
      category: 'mega' as const,
      group: ch.name,
      specialty: ch.types?.join(' / '),
      requirements: [],
      trainerSprite: t.trainerSprite || undefined,
      variants: [variant(`Trainer ${i + 1}`, 'singles', t.team)],
    })),
  );
}

export function fromRivals(list: Raw[]): Npc[] {
  return list.map((r) => ({
    id: `rival:${r.id}`,
    name: r.name,
    title: 'Rival',
    category: 'rival',
    group: r.regionName,
    requirements: [],
    trainerSprite: r.trainerSprite || undefined,
    variants: [variant('Team', 'singles', r.team)],
  }));
}

export function fromRocket(list: Raw[]): Npc[] {
  return list.map((r) => ({
    id: `rocket:${r.id}`,
    name: r.name,
    title: r.title || 'Team Rocket',
    category: 'rocket',
    group: "Rocket's Hideout",
    requirements: [],
    trainerSprite: r.trainerSprite || undefined,
    variants: [variant('Team', 'singles', r.team)],
  }));
}

export function fromWorldBosses(list: Raw[]): Npc[] {
  return list.map((b) => ({
    id: `boss:${b.id}`,
    name: b.name,
    title: 'World Boss',
    category: 'boss',
    group: 'World Boss',
    specialty: b.types?.join(' / '),
    requirements: b.hp ? [`Shared HP: ${Number(b.hp).toLocaleString('en-US')}`] : [],
    variants: [variant('Boss', 'singles', [b])],
  }));
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* ---------- reference data ---------- */

export function normalizeDataset(raw: Raw, version: string, syncedAt = Date.now()): Dataset {
  const types: Record<string, TypeInfo> = {};
  for (const t of raw.types ?? []) {
    types[t.name] = { name: t.name, double: t.offense.double, half: t.offense.half, none: t.offense.none };
  }

  const species: Record<number, Species> = {};
  for (const s of raw.species ?? []) {
    species[s.id] = {
      id: s.id,
      name: s.name,
      types: s.types,
      baseStats: s.baseStats,
      abilities: (s.abilities ?? []).map((a: Raw) => ({ id: a.id, name: a.name, hidden: !!a.hidden })),
      levelMoves: (s.naturalMoves ?? []).map((m: Raw) => [m.id, m.level ?? 1] as [string, number]),
      machineMoves: s.machineMoves ?? [],
      eggMoves: s.eggMoves ?? [],
      ...wildSpeciesFields(s),
    };
  }

  const moves: Record<string, Move> = {};
  for (const m of raw.moves ?? []) {
    moves[m.id] = {
      id: m.id,
      name: m.name,
      type: m.type,
      category: m.category,
      power: m.power ?? 0,
      accuracy: m.accuracy === true || m.accuracy == null ? true : m.accuracy,
      pp: m.pp,
      priority: m.priority ?? 0,
      target: m.target,
      description: m.description ?? '',
    };
  }

  const abilities: Record<string, Ability> = {};
  for (const a of raw.abilities ?? []) abilities[a.id] = { id: a.id, name: a.name, summary: a.summary ?? a.description ?? '' };

  const items: Record<string, Item> = {};
  for (const i of raw.items ?? []) items[i.id] = { id: i.id, name: i.name, effect: i.heldEffect ?? i.itemEffect ?? i.description ?? '', ...itemExtras(i) };

  const npcs: Npc[] = [
    ...fromChallenges(raw.challenges ?? []),
    ...fromTowers(raw.battleTowers ?? []),
    ...fromFrontierBrains(raw.frontierBrains ?? []),
    ...fromMegaChambers(raw.megaChambers ?? []),
    ...fromRivals(raw.rivals ?? []),
    ...fromRocket(raw.rocketHideout ?? []),
    ...fromWorldBosses(raw.worldBosses ?? []),
  ];

  return { version, syncedAt, types, species, moves, abilities, items, npcs, wild: fromWild(raw), tips: generateTips(raw) };
}

/* ---------- explore maps and wild data (schema 4) ---------- */

export function wildSpeciesFields(s: Raw): Partial<Species> {
  const out: Partial<Species> = {};
  if (typeof s.catchRate === 'number') out.catchRate = s.catchRate;
  if (s.rarity !== undefined) out.rarity = s.rarity;
  if (typeof s.availability === 'string') out.availability = s.availability;
  if (s.spawnRequirement) out.spawnRequirement = String(s.spawnRequirement);
  const evo = (Array.isArray(s.evolutions) ? s.evolutions : [])
    .filter((e: Raw) => e && e.from === s.id && e.supported === true && typeof e.to === 'number')
    .map((e: Raw) => {
      const methods = (e.methods ?? []).filter((x: unknown): x is string => typeof x === 'string');
      const lv = methods.map((x: string) => /Level (\d+) or higher/i.exec(x)).find(Boolean);
      return { to: e.to as number, methods, ...(lv ? { level: Number(lv[1]) } : {}) };
    });
  if (evo.length) out.evolvesTo = evo;
  return out;
}

export function itemExtras(i: Raw): Partial<Item> {
  const out: Partial<Item> = {};
  if (i.category) out.category = i.category;
  if (i.description) out.description = i.description;
  if (typeof i.sprite === 'string' && i.sprite.startsWith('/')) out.sprite = i.sprite;
  if (Array.isArray(i.wildSources) && i.wildSources.length) {
    out.wildSources = i.wildSources.map((w: Raw) => ({ species: w.species, chance: w.chance, mapIds: w.mapIds ?? [] }));
  }
  if (i.universalWildSource) out.wildRule = String(i.universalWildSource);
  if (Array.isArray(i.notes) && i.notes.length) out.notes = i.notes;
  return out;
}

/**
 * Wiki encounter rows are per labelled sub-area and overlap by section, so their
 * odds are never summed: rows of one species + method are merged keeping the BEST
 * day/night chance (one spot), the level span, and every label/section.
 */
export function mergeEncounters(rows: Raw[]): WildEncounter[] {
  const byKey = new Map<string, WildEncounter>();
  for (const r of rows) {
    if (typeof r?.species !== 'number') continue;
    const key = `${r.species}|${r.method}`;
    const lv: [number, number] = Array.isArray(r.levels) ? [r.levels[0], r.levels[1] ?? r.levels[0]] : [0, 0];
    const label: string | undefined = r.label ?? r.summaryLabel ?? r.method;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        species: r.species,
        rarity: r.rarity ?? 'common',
        method: r.method ?? 'walking',
        levels: lv,
        day: r.day ?? 0,
        night: r.night ?? 0,
        labels: label ? [label] : [],
        sections: [...(r.sections ?? [])],
      });
      continue;
    }
    cur.levels = [Math.min(cur.levels[0], lv[0]), Math.max(cur.levels[1], lv[1])];
    cur.day = Math.max(cur.day, r.day ?? 0);
    cur.night = Math.max(cur.night, r.night ?? 0);
    if (label && !cur.labels.includes(label)) cur.labels.push(label);
    for (const sec of r.sections ?? []) if (!cur.sections.includes(sec)) cur.sections.push(sec);
  }
  return [...byKey.values()];
}

export function fromWild(raw: Raw): WildData | undefined {
  if (!Array.isArray(raw.maps)) return undefined;
  const maps: ExploreMap[] = raw.maps.map((m: Raw) => ({
    id: m.id,
    name: m.name,
    theme: m.theme ?? '',
    levels: Array.isArray(m.levels) ? [m.levels[0], m.levels[1]] : [0, 0],
    description: m.description ?? '',
    encounters: mergeEncounters(m.encounters ?? []),
  }));
  const moonStone = new Set<number>();
  for (const e of raw.evolutionMethods ?? []) {
    if ((e.methods ?? []).some((x: unknown) => typeof x === 'string' && /moon stone/i.test(x))) moonStone.add(e.from);
  }
  for (const s of raw.species ?? []) {
    for (const e of s.evolutions ?? []) {
      if (e.from === s.id && (e.methods ?? []).some((x: unknown) => typeof x === 'string' && /moon stone/i.test(x))) moonStone.add(s.id);
    }
  }
  return {
    maps,
    moonStone: [...moonStone].sort((a, b) => a - b),
    encounterChance: typeof raw.mechanics?.encounterChance === 'number' ? raw.mechanics.encounterChance : undefined,
  };
}
