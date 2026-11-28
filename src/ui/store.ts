import { computed, signal } from '@preact/signals';
import type { BoxMon, Dataset } from '../shared/types';
import { clearDataset, loadBox, loadDataset, saveBox, saveDataset } from '../data/db';
import { syncDataset } from '../data/sync';

/** Top tabs: Battle / Wild / Prep / Guide, plus Settings (gear). Prep holds the NPC → Team → Hunt & grind steps. */
export type TabId = 'battle' | 'wild' | 'prep' | 'train' | 'guide' | 'settings';
export type PrepStep = 'npc' | 'team' | 'hunt';

export const dataset = signal<Dataset | null>(null);
export const box = signal<BoxMon[]>([]);
export const activeTab = signal<TabId>('prep');
export const prepStep = signal<PrepStep>('npc');

/** Open Prep at one of its steps. */
export function goPrep(step: PrepStep) {
  prepStep.value = step;
  activeTab.value = 'prep';
}
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
    addSampleBattleSpecies(ds);
    addDevEvYields(ds);
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
  goPrep('npc');
}

/**
 * Dev harness only: the sample battle (Brock turn 3) uses Pokémon the trimmed fixture lacks.
 * Same mainline base stats the tests add (tests/turnAdvisor.test.ts).
 */
function addSampleBattleSpecies(ds: Dataset) {
  const add = (id: number, name: string, types: string[], b: number[]) => {
    if (ds.species[id]) return;
    ds.species[id] = { id, name, types, baseStats: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] } as unknown as Dataset['species'][number];
  };
  add(546, 'Cottonee', ['Grass', 'Fairy'], [40, 27, 60, 37, 50, 66]);
  add(387, 'Turtwig', ['Grass'], [55, 68, 64, 45, 55, 31]);
  add(532, 'Timburr', ['Fighting'], [75, 80, 55, 25, 35, 35]);
  add(674, 'Pancham', ['Fighting'], [67, 82, 62, 46, 48, 43]);
  add(841, 'Flapple', ['Grass', 'Dragon'], [70, 110, 80, 95, 60, 70]);
}

/** Dev harness only: adds the explore-map subset (tests/fixtures/wiki-explore-raw.json). */
/** Dev harness only: a few EV yields (as the wiki's EV Training table gives them) so the EV panel can be previewed. */
function addDevEvYields(ds: Dataset) {
  const Y: Record<number, Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>> = {
    41: { spe: 1 }, 74: { def: 1 }, 76: { def: 3 }, 95: { def: 1 }, 139: { def: 2 }, 141: { atk: 2 }, 369: { hp: 1, def: 1 }, 409: { atk: 2 },
    63: { spa: 1 }, 54: { spa: 1 }, 109: { def: 1 }, 89: { hp: 1, atk: 1 }, 110: { def: 2 }, 66: { atk: 1 }, 68: { atk: 3 }, 43: { spa: 1 },
  };
  for (const [id, y] of Object.entries(Y)) {
    const s = ds.species[+id];
    if (s) s.evYield = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...y };
  }
}

async function addDevExplore(ds: Dataset) {
  const [{ default: raw }, { fromWild, itemExtras, wildSpeciesFields }] = await Promise.all([
    import('../../tests/fixtures/wiki-explore-raw.json') as Promise<{ default: any }>,
    import('../data/normalize'),
  ]);
  for (const s of raw.species) if (ds.species[s.id]) Object.assign(ds.species[s.id], wildSpeciesFields(s));
  for (const i of raw.items) ds.items[i.id] = { id: i.id, name: i.name, effect: i.heldEffect ?? i.itemEffect ?? i.description ?? '', ...itemExtras(i) };
  ds.wild = fromWild(raw);
}
