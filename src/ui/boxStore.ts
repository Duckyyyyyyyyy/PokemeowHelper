import { signal } from '@preact/signals';
import type { BoxSyncMeta } from '../shared/types';
import { BoxSyncError, fetchCollection, mergeBox, toBoxMons } from '../data/boxSync';
import { loadBoxMeta, saveBoxMeta } from '../data/db';
import { box, dataset, isExtension, setBox } from './store';

/** Box sync state (kept apart from store.ts so the two can evolve independently). */
export const boxMeta = signal<BoxSyncMeta | null>(null);
export const boxSync = signal<{ busy: boolean; step?: string; error?: string; done?: string }>({ busy: false });

/** Auto-refresh when the panel opens, at most this often. */
export const AUTO_SYNC_MIN_MS = 5 * 60 * 1000;
const AUTO_KEY = 'md-box-autosync';

export function autoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setAutoSync(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export async function initBoxSync() {
  boxMeta.value = (await loadBoxMeta()) ?? null;
}

export async function runBoxSync() {
  const ds = dataset.value;
  if (boxSync.value.busy) return;
  if (!ds) {
    boxSync.value = { busy: false, error: 'Sync the wiki data first (Settings ⚙), so MeowDex knows every Pokémon.' };
    return;
  }
  boxSync.value = { busy: true, step: 'Reading your box…' };
  try {
    const raw = await fetchCollection({
      onProgress: (n, page) => (boxSync.value = { busy: true, step: `Reading your box… page ${page} (${n} Pokémon)` }),
    });
    const synced = toBoxMons(ds, raw);
    await setBox(mergeBox(box.value, synced));
    const meta = { syncedAt: Date.now(), count: synced.length };
    await saveBoxMeta(meta);
    boxMeta.value = meta;
    boxSync.value = { busy: false, done: `Synced ${synced.length} Pokémon from your box.` };
  } catch (e) {
    const msg = e instanceof BoxSyncError ? e.message : e instanceof Error ? e.message : String(e);
    boxSync.value = {
      busy: false,
      error: /Failed to fetch|NetworkError/i.test(msg) ? 'Could not reach pokemeowrpg.com. Check your connection.' : msg,
    };
  }
}

/** Called once when the side panel opens. */
export async function maybeAutoSyncBox() {
  if (!isExtension || !autoSyncEnabled() || !dataset.value) return;
  const last = boxMeta.value?.syncedAt ?? 0;
  if (!last) return; // first sync is always manual, so the user sees what it does
  if (Date.now() - last < AUTO_SYNC_MIN_MS) return;
  await runBoxSync();
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}
