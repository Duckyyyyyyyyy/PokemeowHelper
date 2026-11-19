// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTeamPanel, readWild } from '../src/content/wildReader';
import { wildParty } from '../src/engine/wildDefeat';

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
    expect(snap.lead).toEqual({ name: 'Charizard', level: 56, hp: 166, maxHp: 166, item: 'Fire Gem', gender: 'M' });
  });

  it('reads the weekly Catchlist marker (stylesheet: .encounter-announcement > .catchlist-target-button; not seen live)', () => {
    expect(snap.catchlist).toBe(false);
    const marked = readFileSync(resolve(__dirname, 'fixtures/explore/doduo-catchlist.reconstructed.html'), 'utf8');
    expect(readWild(load(marked))!.catchlist).toBe(true);
    expect(readWild(load(html.replace(/<div class="encounter-announcement">[\s\S]*?<\/h2><\/div>/, '')))!.catchlist).toBeUndefined();
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

  it('reads your party from the battle switch cards and your move buttons (battle markup as in Gym battles)', () => {
    const battle = `<div class="encounter-card"><div class="wild-encounter" data-view="battle">
      <div class="encounter-opponent"><div class="battle-combatant-name"><strong title="Doduo">Doduo<span class="battle-pokemon-level">Lv. 6</span></strong></div></div>
      <button class="battle-move-button" aria-label="Flamethrower · Fire · Special · Power 90 · Accuracy 100% · 15/15 PP">Flamethrower</button>
      <div class="battle-switch-card"><button class="battle-switch-button" aria-label="Active: Charizard, level 56, 150 of 166 HP">Charizard</button></div>
      <div class="battle-switch-card" data-fainted="true"><button class="battle-switch-button" aria-label="Switch to Pidgey, level 12, 0 of 35 HP, fainted">Pidgey</button></div>
    </div></div>`;
    const s = readWild(load(battle))!;
    expect(s.party).toEqual([
      expect.objectContaining({ name: 'Charizard', level: 56, hp: 150, maxHp: 166, active: true, fainted: false }),
      expect.objectContaining({ name: 'Pidgey', level: 12, hp: 0, active: false, fainted: true }),
    ]);
    expect(s.moves?.[0]).toMatchObject({ name: 'Flamethrower', type: 'Fire', power: 90, disabled: false });
  });

  it('reads the Explore team panel before a battle (class names from the stylesheet)', () => {
    const panel = `<ul class="starter-options"><li data-explore-team-slot="0"><img class="pokemon-sprite" alt="Charizard"><span class="explore-team-level">Lv. 56</span><span>166/166 HP</span></li>
      <li data-explore-team-slot="1"><img class="pokemon-sprite" alt="Pidgey"><span class="explore-team-level">Lv. 12</span><span>0/35 HP</span></li></ul>`;
    const s = readWild(load(panel + html))!;
    expect(s.party?.map((r) => [r.name, r.level, r.hp, r.active, r.fainted])).toEqual([['Charizard', 56, 166, false, false], ['Pidgey', 12, 0, false, true]]);
    expect(s.moves).toBeUndefined();
  });
});

describe('Explore team panel with the starter (regression: slot 1 was dropped)', () => {
  const panel = readFileSync(resolve(__dirname, 'fixtures/explore/team-panel-starter.reconstructed.html'), 'utf8');
  // The encounter card with Slaking ♀ Lv. 43 as lead, as in the user's screenshot.
  const card = html.replace(/<strong title="Charizard">[\s\S]*?<\/strong>/, '<strong title="Slaking">Slaking<svg class="pokemon-gender pokemon-gender-F" aria-label="Female"></svg><span class="battle-pokemon-level">Lv. 43</span></strong>').replace('166/166 HP', '187/187 HP');

  it('reads the starter block plus slots 2–6, in slot order', () => {
    const team = readTeamPanel(load(panel));
    expect(team.map((r) => [r.slot, r.name, r.level, r.gender])).toEqual([
      [1, 'Slaking', 43, 'F'], [2, 'Crocalor', 19, 'M'], [3, 'Snorlax', 51, 'M'], [4, 'Slowbro', 43, 'F'], [5, 'Hawlucha', 17, 'F'], [6, 'Electivire', 44, 'M'],
    ]);
    expect(team.every((r) => !r.active && !r.fainted && r.hp === undefined)).toBe(true);
  });

  it('makes the card lead the active one, with the HP from the card', () => {
    const w = readWild(load(panel + card))!;
    expect(w.lead).toMatchObject({ name: 'Slaking', level: 43, gender: 'F', hp: 187, maxHp: 187 });
    const party = wildParty(w);
    expect(party.map((r) => r.name)).toEqual(['Slaking', 'Crocalor', 'Snorlax', 'Slowbro', 'Hawlucha', 'Electivire']);
    expect(party[0]).toMatchObject({ active: true, hp: 187, maxHp: 187 });
    expect(party.filter((r) => r.active)).toHaveLength(1);
  });

  it('follows the lead when it is not slot 1; a lead missing from the panel is still the one in front', () => {
    const w = readWild(load(panel + card.replace(/Slaking/g, 'Snorlax').replace('Lv. 43', 'Lv. 51')))!;
    expect(wildParty(w).map((r) => r.name)).toEqual(['Snorlax', 'Slaking', 'Crocalor', 'Slowbro', 'Hawlucha', 'Electivire']);
    const none = readWild(load(panel + card.replace(/Slaking/g, 'Mew')))!;
    expect(wildParty(none).map((r) => [r.name, r.active])).toEqual([['Mew', true], ['Slaking', false], ['Crocalor', false], ['Snorlax', false], ['Slowbro', false], ['Hawlucha', false], ['Electivire', false]]);
    // Without a card lead (and no battle buttons) slot 1 leads.
    expect(wildParty({ ...none, lead: undefined })[0]).toMatchObject({ name: 'Slaking', active: true });
  });
});

