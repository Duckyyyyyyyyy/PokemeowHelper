// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWild } from '../src/content/wildReader';

const html = readFileSync(resolve(__dirname, 'fixtures/explore/doduo-intro.reconstructed.html'), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};

describe('wild encounter reader (Doduo intro, Grasslands 3)', () => {
  const snap = readWild(load(html), 1)!;

  it('reads the wild Pokémon', () => {
    expect(snap).toMatchObject({ v: 1, at: 1, view: 'intro', map: 'Grasslands 3', name: 'Doduo', gender: 'F', level: 6, rarity: 'Common', shiny: false, registered: true, inBox: 0 });
    expect(snap.item).toBeUndefined();
    expect(snap.status).toBeUndefined();
  });

  it('reads the quick-catch balls and your lead', () => {
    expect(snap.balls).toEqual([
      { name: 'Poké Ball', count: 15 },
      { name: 'Great Ball', count: 26 },
      { name: 'Ultra Ball', count: 18 },
      { name: 'Quick Ball', count: 5 },
    ]);
    expect(snap.lead).toEqual({ name: 'Charizard', level: 56, hp: 166, maxHp: 166, item: 'Fire Gem' });
  });

  it('returns null without an encounter card', () => {
    expect(readWild(load('<div class="page-title">Grasslands 3</div>'))).toBeNull();
  });

  it('reads a held item, shiny tag and unregistered Pokédex icon', () => {
    const variant = html
      .replace('<span class="battle-pokemon-level">Lv. 6</span>', '<span class="battle-pokemon-level">Lv. 6</span><button type="button" class="item-info-link item-info-link-icon battle-held-item" aria-label="Held item: Sharp Beak. View item information" title="About Sharp Beak"></button>')
      .replace('encounter-rarity encounter-rarity-common" aria-label="Encounter rarity: Common">Common', 'encounter-rarity encounter-rarity-shiny" aria-label="Encounter rarity: Shiny">Shiny')
      .replace('dex-caught-status dex-status-caught', 'dex-caught-status dex-status-uncaught');
    const s = readWild(load(variant))!;
    expect(s).toMatchObject({ name: 'Doduo', item: 'Sharp Beak', shiny: true, registered: false });
  });

  it('reads HP and status once the battle runs (layout from the game stylesheet, not seen live)', () => {
    const battle = `<h1 class="page-title">Grasslands 3</h1><div class="encounter-card"><div class="wild-encounter" data-view="battle">
      <div class="encounter-combatants">
        <div class="encounter-opponent"><div class="battle-combatant-heading"><div class="battle-combatant-name"><strong title="Doduo">Doduo<svg class="pokemon-gender pokemon-gender-F" aria-label="Female"></svg><span class="battle-pokemon-level">Lv. 6<span class="battle-status" data-status="par">PAR</span></span></strong></div><small class="encounter-owned-count">[in box: 0]</small></div><div class="health-track"><span style="width: 42%"></span></div></div>
        <div class="battle-partner"><div class="battle-combatant-heading"><div class="battle-combatant-name"><strong title="Charizard">Charizard<span class="battle-pokemon-level">Lv. 56</span></strong></div><span class="battle-hp-numbers">150/166 HP</span></div></div>
      </div></div></div>`;
    const s = readWild(load(battle))!;
    expect(s).toMatchObject({ view: 'battle', name: 'Doduo', level: 6, gender: 'F', status: 'par', hpPct: 42, inBox: 0 });
    expect(s.lead).toMatchObject({ name: 'Charizard', level: 56, hp: 150, maxHp: 166 });
  });
});
