import { computed, signal } from '@preact/signals';
import type { BoxMon, Dataset } from '../shared/types';
import { clearDataset, loadBox, loadDataset, saveBox, saveDataset } from '../data/db';
import { syncDataset } from '../data/sync';

export type TabId = 'npc' | 'team' | 'battle' | 'explore' | 'tips' | 'settings';

export const dataset = signal<Dataset | null>(null);
export const box = signal<BoxMon[]>([]);
export const activeTab = signal<TabId>('npc');
export const selectedNpcId = signal<string | null>(null);
export const selectedVariant = signal(0);
export const loading = signal(true);
export const sync = signal<{ busy: boolean; step?: string; error?: string; done?: string }>({ busy: false });

export const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

export const selectedNpc = computed(() => dataset.value?.npcs.find((n) => n.id === selectedNpcId.value) ?? null);

export async function init() {
  try {
    const [ds, b] = await Promise.all([loadDataset(), loadBox()]);
    dataset.value = ds ?? null;
    box.value = b;
  } finally {
    loading.value = false;
  }
}

export async function runSync() {
  if (sync.value.busy) return;
  sync.value = { busy: true, step: 'Starting…' };
  try {
    const ds = await syncDataset(dataset.value?.version, (step) => (sync.value = { busy: true, step }));
    if (!ds) {
      sync.value = { busy: false, done: 'Data is already up to date.' };
      return;
    }
    await saveDataset(ds);
    dataset.value = ds;
    sync.value = { busy: false, done: `Synced ${ds.npcs.length} NPCs, ${Object.keys(ds.species).length} Pokémon.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sync.value = { busy: false, error: /Failed to fetch|NetworkError/i.test(msg) ? 'Could not reach pokemeowrpg.com. Check your connection or the extension\'s site access.' : msg };
  }
}

/** Dev harness only: load the trimmed fixture so the UI can be previewed outside Chrome. */
export async function loadDevFixture() {
  if (import.meta.env.DEV) {
    const mod = await import('../../tests/fixtures/wiki-mini.json');
    const ds = { ...(mod.default as unknown as Dataset), version: 'dev-fixture', syncedAt: Date.now() };
    await addDevExplore(ds);
    await saveDataset(ds);
    dataset.value = ds;
  }
}

export async function resetDataset() {
  await clearDataset();
  dataset.value = null;
  selectedNpcId.value = null;
}

export async function setBox(next: BoxMon[]) {
  box.value = next;
  await saveBox(next);
}

export function openNpc(id: string) {
  selectedNpcId.value = id;
  selectedVariant.value = 0;
  activeTab.value = 'npc';
}

/** Dev harness only: adds the explore-map subset (tests/fixtures/wiki-explore-raw.json). */
async function addDevExplore(ds: Dataset) {
  const [{ default: raw }, { fromWild, itemExtras, wildSpeciesFields }] = await Promise.all([
    import('../../tests/fixtures/wiki-explore-raw.json') as Promise<{ default: any }>,
    import('../data/normalize'),
  ]);
  for (const s of raw.species) if (ds.species[s.id]) Object.assign(ds.species[s.id], wildSpeciesFields(s));
  for (const i of raw.items) ds.items[i.id] = { id: i.id, name: i.name, effect: i.heldEffect ?? i.itemEffect ?? i.description ?? '', ...itemExtras(i) };
  ds.wild = fromWild(raw);
}
