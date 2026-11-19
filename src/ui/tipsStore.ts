import { signal } from '@preact/signals';
import { activeTab } from './store';

/**
 * Tips tab state. Ticked tips are a per-viewer convenience, so localStorage is enough
 * (the side panel and the floating window share the extension origin).
 */
const KEY = 'mh-tips-done';

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const doneTips = signal<string[]>(load());
/** Search text and an opened tip, set by cross-links from other tabs. */
export const tipsQuery = signal('');
export const focusTipId = signal<string | null>(null);

export function toggleDone(id: string) {
  doneTips.value = doneTips.value.includes(id) ? doneTips.value.filter((x) => x !== id) : [...doneTips.value, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(doneTips.value));
  } catch {
    /* storage unavailable: keep the in-memory state */
  }
}

/** Jump to the Tips tab showing one tip. */
export function openTip(id: string) {
  focusTipId.value = id;
  activeTab.value = 'tips';
}

/** Jump to the Tips tab with a search. */
export function searchTipsFor(query: string) {
  focusTipId.value = null;
  tipsQuery.value = query;
  activeTab.value = 'tips';
}
