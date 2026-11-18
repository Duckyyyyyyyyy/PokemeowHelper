import type { BagItem, BagSnapshot } from '../shared/bag';

/**
 * Reads the game's Bag page (READ-ONLY, no requests). Structure checked live 2026-11-18:
 *   section.bag-page-panel[aria-labelledby="bag-<pocket>-title"]
 *     li.bag-page-item
 *       button.bag-item-favorite[data-favorite-item="<item id>"]
 *       button.bag-page-item-link > span "<name>"
 *       span.bag-page-item-count "×10"
 * Returns null when the Bag page is not open, or when the search box is filtering the list
 * (a partial list must not overwrite the stored bag).
 */
export const BAG_SEL = {
  page: '.bag-page',
  search: '.bag-page-search input, input[aria-label="Search your items"]',
  pocket: 'section.bag-page-panel',
  item: 'li.bag-page-item',
  id: '[data-favorite-item]',
  name: '.bag-page-item-link',
  count: '.bag-page-item-count',
};

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function readBag(doc: Document, now = Date.now()): { snap: BagSnapshot; pockets: string[] } | null {
  const page = doc.querySelector(BAG_SEL.page);
  if (!page) return null;
  const search = doc.querySelector<HTMLInputElement>(BAG_SEL.search);
  if (search && search.value.trim()) return null;
  const items: BagItem[] = [];
  const pockets: string[] = [];
  for (const sec of page.querySelectorAll(BAG_SEL.pocket)) {
    const pocket = (sec.getAttribute('aria-labelledby') ?? '').match(/^bag-(.+)-title$/)?.[1];
    if (!pocket || pocket === 'key') continue;
    pockets.push(pocket);
    for (const li of sec.querySelectorAll(BAG_SEL.item)) {
      const link = li.querySelector(BAG_SEL.name);
      const name = clean(link?.querySelector('span')?.textContent) || clean(link?.getAttribute('aria-label')?.match(/^Item:\s*(.+?)\.\s/)?.[1]);
      const id = li.querySelector(BAG_SEL.id)?.getAttribute('data-favorite-item') || name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const count = parseInt(clean(li.querySelector(BAG_SEL.count)?.textContent).replace(/[^\d]/g, ''), 10);
      if (id && name) items.push({ id, name, count: Number.isFinite(count) ? count : 1, pocket });
    }
  }
  if (!pockets.length) return null;
  return { snap: { v: 1, at: now, items }, pockets };
}

/** Replaces the pockets that were on screen, keeps the others (e.g. when a pocket filter is on). */
export function mergeBag(old: BagSnapshot | null | undefined, read: { snap: BagSnapshot; pockets: string[] }): BagSnapshot {
  const kept = (old?.items ?? []).filter((it) => !read.pockets.includes(it.pocket));
  return { v: 1, at: read.snap.at, items: [...kept, ...read.snap.items] };
}
