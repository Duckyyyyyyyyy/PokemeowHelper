import type { Dataset, GameTip, TipCategory, TipSource } from '../shared/types';
import { CURATED_TIPS, REGION_STAGE, WIKI } from '../data/tips';

export const CATEGORY_LABEL: Record<TipCategory, string> = {
  start: 'Getting started',
  hm: 'HMs & field moves',
  key: 'Key items',
  maps: 'Map unlocks',
  catching: 'Catching',
  battling: 'Battling',
  daily: 'Daily/weekly',
  evolution: 'Evolution',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as TipCategory[];

/** Curated tips plus the ones generated from the synced wiki data (old caches have none). */
export function allTips(ds: Dataset | null): GameTip[] {
  const gen = ds?.tips ?? [];
  const ids = new Set(CURATED_TIPS.map((t) => t.id));
  return [...CURATED_TIPS, ...gen.filter((t) => !ids.has(t.id))];
}

export function sourceUrl(s: TipSource): string | null {
  return s.kind === 'page' ? WIKI + s.ref : null;
}

export function sourceLabel(s: TipSource): string {
  return s.kind === 'page' ? `wiki ${s.ref.replace(/^#\//, '')}` : `wiki data: ${s.ref}`;
}

/* ---------- search ---------- */

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Everything a tip can be found by: its words plus the names of its items, maps, NPCs, moves and species. */
export function haystack(t: GameTip, ds: Dataset | null): string {
  const parts = [t.title, ...t.steps, ...(t.requires ?? []), ...(t.keywords ?? []), CATEGORY_LABEL[t.category]];
  if (ds) {
    for (const id of t.items ?? []) parts.push(ds.items[id]?.name ?? id);
    for (const id of t.moves ?? []) parts.push(ds.moves[id]?.name ?? id);
    for (const id of t.species ?? []) parts.push(ds.species[id]?.name ?? '');
    for (const id of t.maps ?? []) parts.push(ds.wild?.maps.find((m) => m.id === id)?.name ?? '');
    for (const id of t.npcs ?? []) {
      const n = ds.npcs.find((x) => x.id === id);
      if (n) parts.push(n.name, n.title, n.group ?? '');
    }
  }
  return norm(parts.join(' '));
}

/**
 * Tips matching every word of the query (in any field), best first: title hits, then
 * hits in names of related things, then step text. An empty query keeps the given order.
 */
export function searchTips(tips: GameTip[], ds: Dataset | null, query: string, category?: TipCategory | ''): GameTip[] {
  const words = norm(query).split(' ').filter(Boolean);
  const pool = category ? tips.filter((t) => t.category === category) : tips;
  if (!words.length) return pool;
  const scored: [GameTip, number][] = [];
  for (const t of pool) {
    const hay = haystack(t, ds);
    if (!words.every((w) => hay.includes(w))) continue;
    const title = norm(t.title);
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 10;
      if (new RegExp(`(^| )${w}( |$)`).test(title)) score += 5;
    }
    if (t.category === 'hm' || t.category === 'maps' || t.category === 'key') score += 1;
    scored.push([t, score]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/* ---------- progress path ---------- */

export interface PathStage {
  stage: number;
  label: string;
  tips: GameTip[];
}

/** Tips placed on the suggested progress path, grouped by stage (start, then one per regional Champion). */
export function progressPath(tips: GameTip[], ds: Dataset | null): PathStage[] {
  const byStage = new Map<number, GameTip[]>();
  for (const t of tips) {
    if (t.stage === undefined) continue;
    if (!byStage.has(t.stage)) byStage.set(t.stage, []);
    byStage.get(t.stage)!.push(t);
  }
  const regionOf = Object.fromEntries(Object.entries(REGION_STAGE).map(([r, n]) => [n, r]));
  return [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stage, list]) => {
      let label = 'Getting started';
      if (stage > 0) {
        const region = regionOf[stage] ?? `stage ${stage}`;
        const champ = ds?.npcs.find((n) => n.category === 'champion' && n.id.startsWith(`challenge:${region}-`));
        const name = region.charAt(0).toUpperCase() + region.slice(1);
        label = champ ? `${champ.group ?? name}: League, then Champion ${champ.name}` : `${name} League`;
      }
      return { stage, label, tips: list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)) };
    });
}

/* ---------- cross-links ---------- */

/** Tips about reaching or using a map (map unlocks and field moves first). */
export function tipsForMap(tips: GameTip[], mapId: string): GameTip[] {
  const rank: Partial<Record<TipCategory, number>> = { maps: 0, hm: 1, key: 2, catching: 3 };
  return tips
    .filter((t) => t.maps?.includes(mapId) && (t.category in rank))
    .sort((a, b) => (rank[a.category] ?? 9) - (rank[b.category] ?? 9));
}

export interface MapNeed {
  label: string;
  /** The generated how-to tip (present after a schema-5 sync). */
  tipId: string;
  /** Search text that finds the how-to tip otherwise. */
  query: string;
}

/** What a map's encounter list itself says you need (Surf / rods), from the wiki data. */
export function mapNeeds(ds: Dataset, mapId: string): MapNeed[] {
  const m = ds.wild?.maps.find((x) => x.id === mapId);
  if (!m) return [];
  const methods = new Set(m.encounters.map((e) => e.method));
  const out: MapNeed[] = [];
  if (methods.has('surf')) out.push({ label: 'Surf (deep-water encounters)', tipId: 'hm:hmsurf', query: 'Surf' });
  for (const [method, item, name] of [['oldrod', 'oldrod', 'Old Rod'], ['goodrod', 'goodrod', 'Good Rod'], ['superrod', 'superrod', 'Super Rod']] as const) {
    if (methods.has(method)) out.push({ label: `${ds.items[item]?.name ?? name} (fishing)`, tipId: `item:${item}`, query: ds.items[item]?.name ?? name });
  }
  return out;
}

/** Tips that mention an NPC as the way to unlock something (HMs, Key Items, maps, spawns). */
export function tipsForNpc(tips: GameTip[], npcId: string): GameTip[] {
  return tips.filter((t) => t.npcs?.includes(npcId) && !t.id.startsWith('league:') && !t.id.startsWith('source:'));
}
