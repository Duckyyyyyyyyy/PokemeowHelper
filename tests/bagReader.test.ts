// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mergeBag, readBag } from '../src/content/bagReader';
import { tmMove } from '../src/shared/bag';

// Rebuilt from the structure of the live Bag page (2026-11-18); icons and buttons trimmed.
const li = (id: string, name: string, n: number) => `
  <li class="bag-page-item"><span class="bag-page-item-identity">
    <button class="bag-item-favorite" data-favorite-item="${id}"><svg></svg></button>
    <button class="item-info-link bag-page-item-link" aria-label="Item: ${name}. View item information"><img class="item-icon"><span>${name}</span></button>
    <span class="bag-page-item-count">×${n}</span></span>
    <span class="bag-item-actions"><button class="text-button bag-item-give">Give</button></span></li>`;
const section = (pocket: string, items: string) =>
  `<section class="bag-page-panel" aria-labelledby="bag-${pocket}-title"><div class="bag-page-section-heading"><h2>${pocket}</h2></div><ul class="bag-page-items">${items}</ul></section>`;
const page = (search = '') => `
  <div class="bag-page bag-view-rows"><div class="bag-page-search"><input type="search" aria-label="Search your items" value="${search}"></div>
  <div class="bag-page-results">
    ${section('medicine', li('potion', 'Potion', 10) + li('maxrevive', 'Max Revive', 1))}
    ${section('held', li('electricgem', 'Electric Gem', 4))}
    ${section('tms', li('tmgigadrain', 'TM19 · Giga Drain', 1) + li('tmtakedown', 'TM01 · Take Down', 1))}
    ${section('key', li('oldrod', 'Old Rod', 1))}
  </div></div>`;

describe('bag reader', () => {
  it('reads every pocket with ids and counts, skipping key items', () => {
    document.body.innerHTML = page();
    const r = readBag(document, 5)!;
    expect(r.pockets).toEqual(['medicine', 'held', 'tms']);
    expect(r.snap.items).toContainEqual({ id: 'potion', name: 'Potion', count: 10, pocket: 'medicine' });
    expect(r.snap.items).toContainEqual({ id: 'electricgem', name: 'Electric Gem', count: 4, pocket: 'held' });
    expect(r.snap.items.map(tmMove).filter(Boolean)).toEqual(['gigadrain', 'takedown']);
    expect(r.snap.items.some((i) => i.id === 'oldrod')).toBe(false);
  });

  it('does nothing outside the Bag page or while searching', () => {
    document.body.innerHTML = '<div class="battle-arena"></div>';
    expect(readBag(document)).toBeNull();
    document.body.innerHTML = page('pot');
    expect(readBag(document)).toBeNull();
  });

  it('only replaces the pockets on screen', () => {
    document.body.innerHTML = page();
    const full = readBag(document, 1)!.snap;
    document.body.innerHTML = `<div class="bag-page">${section('medicine', li('potion', 'Potion', 9))}</div>`;
    const merged = mergeBag(full, readBag(document, 2)!);
    expect(merged.items.find((i) => i.id === 'potion')!.count).toBe(9);
    expect(merged.items.some((i) => i.id === 'maxrevive')).toBe(false); // used up
    expect(merged.items.some((i) => i.id === 'tmgigadrain')).toBe(true); // other pocket kept
  });
});
