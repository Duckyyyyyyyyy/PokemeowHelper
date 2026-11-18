import { computed, signal } from '@preact/signals';
import { tmMove, type BagSnapshot } from '../shared/bag';
import { isExtension } from './store';

/** Your bag, read by the content script whenever you open the game's Bag page (key "mdBag"). */
export const bag = signal<BagSnapshot | null>(null);
const KEY = 'mdBag';

/** Move ids of the TMs in your bag (null = bag not read yet). */
export const ownedTms = computed<ReadonlySet<string> | null>(() => {
  const b = bag.value;
  if (!b) return null;
  return new Set(b.items.filter((i) => i.count > 0).map(tmMove).filter((x): x is string => !!x));
});

/** Item id → count, for held items, berries and medicine. */
export const ownedItems = computed<ReadonlyMap<string, number>>(() => new Map((bag.value?.items ?? []).filter((i) => i.count > 0).map((i) => [i.id, i.count])));

export function initBag() {
  if (!isExtension || !chrome.storage?.local) return;
  chrome.storage.local.get(KEY).then((r) => (bag.value = (r[KEY] as BagSnapshot | undefined) ?? null)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) bag.value = (changes[KEY].newValue as BagSnapshot | undefined) ?? null;
  });
}

export async function forgetBag() {
  bag.value = null;
  if (isExtension && chrome.storage?.local) await chrome.storage.local.remove(KEY).catch(() => {});
}

/** Dev harness only: a small sample bag. */
export function loadSampleBag() {
  if (!import.meta.env.DEV) return;
  const it = (id: string, name: string, count: number, pocket: string) => ({ id, name, count, pocket });
  bag.value = {
    v: 1,
    at: Date.now(),
    items: [
      it('potion', 'Potion', 10, 'medicine'), it('revive', 'Revive', 12, 'medicine'), it('maxrevive', 'Max Revive', 1, 'medicine'),
      it('grassgem', 'Grass Gem', 1, 'held'), it('electricgem', 'Electric Gem', 4, 'held'), it('hardstone', 'Hard Stone', 1, 'held'),
      it('widelens', 'Wide Lens', 1, 'held'), it('lightclay', 'Light Clay', 1, 'held'), it('salacberry', 'Salac Berry', 1, 'berries'),
      it('figyberry', 'Figy Berry', 2, 'berries'), it('tmgigadrain', 'TM19 · Giga Drain', 1, 'tms'), it('tmrocktomb', 'TM39 · Rock Tomb', 2, 'tms'),
    ],
  };
}
