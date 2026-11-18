import type { BoxMon, Dataset } from '../shared/types';
import { ORIGIN } from './sync';

/**
 * Reads the signed-in player's own Pokémon, read-only, using the same
 * endpoint and parameters the game's own team picker uses:
 *   GET /api/collection?egg=false&sort=level&order=desc&limit=30[&cursor=…]
 *
 * Runs only when the user presses "Sync box" (or once when the panel opens,
 * at most every few minutes). Pages are fetched one at a time with a pause in
 * between, and the sync stops immediately if the game asks us to wait (429).
 */

export class BoxSyncError extends Error {}

export interface BoxSyncOptions {
  fetcher?: typeof fetch;
  /** Pause between page requests (ms). */
  delayMs?: number;
  maxPages?: number;
  onProgress?: (loaded: number, page: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Shape of one Pokémon in the game's /api/collection response (fields we read). */
export interface RawCollectionMon {
  id: string;
  species: number;
  name?: string;
  level?: number;
  moves?: string[];
  nature?: string;
  abilitySlot?: string;
  heldItem?: string | null;
  gender?: string;
  shiny?: boolean;
  ivs?: Record<string, number>;
  evs?: Record<string, number>;
  egg?: unknown;
}

const PAGE_SIZE = 30;

export async function fetchCollection(opts: BoxSyncOptions = {}): Promise<RawCollectionMon[]> {
  const fetcher = opts.fetcher ?? fetch;
  const delay = opts.delayMs ?? 800;
  const maxPages = opts.maxPages ?? 40;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const all: RawCollectionMon[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ egg: 'false', sort: 'level', order: 'desc', limit: String(PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const res = await fetcher(`${ORIGIN}/api/collection?${params}`, { credentials: 'include', headers: { accept: 'application/json' } });

    if (res.status === 401 || res.status === 403) {
      throw new BoxSyncError('You are not signed in. Sign in to pokemeowrpg.com in Chrome, then sync again.');
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      throw new BoxSyncError(`The game asked us to slow down. Please wait${Number.isFinite(wait) && wait > 0 ? ` ${Math.ceil(wait)} s` : ' a minute'} before syncing again.`);
    }
    if (!res.ok) throw new BoxSyncError(`The game returned error ${res.status} while reading your box.`);

    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new BoxSyncError('Unexpected response from the game (not JSON). Are you signed in?');
    }
    if (!Array.isArray(body?.pokemon)) throw new BoxSyncError('Unexpected response format from the game. MeowHelper may need an update.');

    all.push(...body.pokemon);
    opts.onProgress?.(all.length, page);

    const next: string | null = body.nextCursor ?? null;
    if (!next) return all;
    if (next === cursor || seenCursors.has(next)) throw new BoxSyncError('The game returned the same page twice; stopped to be safe.');
    seenCursors.add(next);
    cursor = next;
    await sleep(delay);
  }
  throw new BoxSyncError(`Stopped after ${maxPages} pages to stay gentle on the game. Your box was not fully read.`);
}

/** Ability from the game's slot: "0"/"1" = regular abilities in order, anything else (e.g. "H"/"2") = hidden. */
export function resolveAbility(ds: Dataset, species: number, slot?: string): string | undefined {
  const list = ds.species[species]?.abilities;
  if (!list?.length || slot == null) return undefined;
  const regular = list.filter((a) => !a.hidden);
  const hidden = list.find((a) => a.hidden);
  const n = Number(slot);
  if (Number.isInteger(n) && n >= 0 && n < regular.length) return regular[n].name;
  return hidden?.name;
}

export function toBoxMons(ds: Dataset, raw: RawCollectionMon[]): BoxMon[] {
  return raw
    .filter((p) => !p.egg && typeof p.species === 'number' && p.species > 0)
    .map((p) => ({
      uid: `game:${p.id}`,
      gameId: p.id,
      source: 'game' as const,
      species: p.species,
      level: typeof p.level === 'number' ? p.level : undefined,
      moves: (p.moves ?? []).filter((m) => typeof m === 'string').slice(0, 4),
      nature: p.nature,
      ability: resolveAbility(ds, p.species, p.abilitySlot),
      item: p.heldItem ?? null,
      gender: p.gender,
      shiny: !!p.shiny,
      ivs: p.ivs,
      evs: p.evs,
    }));
}

/** Synced Pokémon replace the previous synced set; Pokémon you typed in by hand are kept. */
export function mergeBox(current: BoxMon[], synced: BoxMon[]): BoxMon[] {
  return [...synced, ...current.filter((b) => b.source !== 'game')];
}
