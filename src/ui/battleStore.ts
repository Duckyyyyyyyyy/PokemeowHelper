import { signal } from '@preact/signals';
import type { BattleSnapshot } from '../shared/battle';
import { isExtension } from './store';

/** Latest battle screen read by the content script (chrome.storage.local key "mdBattle"). */
export const battle = signal<BattleSnapshot | null>(null);
const KEY = 'mdBattle';

export function initBattle() {
  if (!isExtension || !chrome.storage?.local) return;
  chrome.storage.local.get(KEY).then((r) => (battle.value = (r[KEY] as BattleSnapshot | null) ?? null)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) battle.value = (changes[KEY].newValue as BattleSnapshot | null) ?? null;
  });
}

/** Dev harness only: the reconstructed Brock battle, so the tab can be previewed outside Chrome. */
export async function loadSampleBattle() {
  if (!import.meta.env.DEV) return;
  const [{ default: html }, { readBattle }] = await Promise.all([
    import('../../tests/fixtures/battle/brock-turn3.reconstructed.html?raw'),
    import('../content/battleReader'),
  ]);
  battle.value = readBattle(new DOMParser().parseFromString(html, 'text/html'));
}
