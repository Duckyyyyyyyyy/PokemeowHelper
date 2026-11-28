import { computed, effect, signal } from '@preact/signals';
import { mapIdForTitle } from '../engine/hunt';
import { dataset, isExtension } from './store';
import { wild } from './wildStore';

/** One Pokémon you want to catch for an NPC (Prep → Hunt & grind → "Hunt list"). */
export interface HuntEntry {
  /** Species you meet in the wild (before it evolves). */
  species: number;
  npcId: string;
  npcName: string;
  at: number;
}

interface HuntState {
  v: 1;
  list: HuntEntry[];
  /** Explore map ids seen on the game's encounter card (best signal of a reachable map). */
  seenMaps: string[];
}

/** chrome.storage.local "mdHunt" (new key; never rename it: that would wipe the list). */
const KEY = 'mdHunt';
const EMPTY: HuntState = { v: 1, list: [], seenMaps: [] };
export const hunt = signal<HuntState>(EMPTY);

/** Species id → NPC name, for Explore's marker and the wild CATCH rule. */
export const huntBySpecies = computed(() => new Map(hunt.value.list.map((e) => [e.species, e.npcName])));
export const seenMaps = computed<ReadonlySet<string>>(() => new Set(hunt.value.seenMaps));

/** "All maps unlocked": you unlocked every map, so no map is treated as locked. Per browser. */
const ALL_KEY = 'md-all-maps';
function readAll(): boolean {
  try {
    return localStorage.getItem(ALL_KEY) === '1';
  } catch {
    return false;
  }
}
export const allMapsOpen = signal<boolean>(readAll());
export function setAllMapsOpen(on: boolean) {
  allMapsOpen.value = on;
  try {
    localStorage.setItem(ALL_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

const valid = (x: unknown): HuntState => {
  const s = x as Partial<HuntState> | null | undefined;
  return { v: 1, list: Array.isArray(s?.list) ? s!.list : [], seenMaps: Array.isArray(s?.seenMaps) ? s!.seenMaps : [] };
};

function save(next: HuntState) {
  hunt.value = next; // in memory first: dev mode has no chrome.storage
  if (isExtension && chrome.storage?.local) chrome.storage.local.set({ [KEY]: next }).catch(() => {});
}

export const onHuntList = (species: number, npcId: string) => hunt.value.list.some((e) => e.species === species && e.npcId === npcId);

export function toggleHunt(species: number, npcId: string, npcName: string) {
  const s = hunt.value;
  const list = onHuntList(species, npcId)
    ? s.list.filter((e) => !(e.species === species && e.npcId === npcId))
    : [...s.list, { species, npcId, npcName, at: Date.now() }];
  save({ ...s, list });
}

/** Stored list loaded (so recording a seen map can't overwrite it with an empty one). */
const loaded = signal(!isExtension);

export function initHunt() {
  if (isExtension && chrome.storage?.local) {
    chrome.storage.local.get(KEY).then((r) => (hunt.value = valid(r[KEY]))).catch(() => {}).finally(() => (loaded.value = true));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && KEY in changes) hunt.value = valid(changes[KEY].newValue);
    });
  }
  // Remember the maps the encounter card shows (read-only: only what the content script already read).
  effect(() => {
    const ds = dataset.value;
    const title = wild.value?.map;
    if (!loaded.value || !ds) return;
    const id = mapIdForTitle(ds, title);
    const s = hunt.peek();
    if (id && !s.seenMaps.includes(id)) save({ ...s, seenMaps: [...s.seenMaps, id] });
  });
}
