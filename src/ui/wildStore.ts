import { signal } from '@preact/signals';
import type { WildSnapshot } from '../shared/wild';
import { isExtension } from './store';

/** The wild encounter card on the Explore page, read by the content script (key "mdWild"). */
export const wild = signal<WildSnapshot | null>(null);
const KEY = 'mdWild';

export function initWild() {
  if (!isExtension || !chrome.storage?.local) return;
  chrome.storage.local.get(KEY).then((r) => (wild.value = (r[KEY] as WildSnapshot | null) ?? null)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) wild.value = (changes[KEY].newValue as WildSnapshot | null) ?? null;
  });
}

/** Dev harness only: the reconstructed Doduo encounter. */
export async function loadSampleWild() {
  if (!import.meta.env.DEV) return;
  const [{ default: html }, { readWild }] = await Promise.all([
    import('../../tests/fixtures/explore/doduo-intro.reconstructed.html?raw'),
    import('../content/wildReader'),
  ]);
  wild.value = readWild(new DOMParser().parseFromString(html, 'text/html'));
}
