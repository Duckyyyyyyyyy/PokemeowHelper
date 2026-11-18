// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mini from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import type { WildSnapshot } from '../src/shared/wild';
import { readWild } from '../src/content/wildReader';
import { carryTeamHp } from '../src/shared/wildTeam';
import { defeatPlan, wildParty } from '../src/engine/wildDefeat';

/**
 * Regression (live, 2026-11-19, Power Plant 5 vs wild Zebstrika Lv 31): after "Go, Slaking!" the
 * Defeat view kept Hawlucha (slot 1 starter) as "active" and listed Slaking's move buttons under it.
 */
const turn2 = readFileSync(resolve(__dirname, 'fixtures/explore/wild-battle-switch.reconstructed.html'), 'utf8');
const turn1 = turn2
  .replace('alt="Slaking"></div></div>', 'alt="Hawlucha"></div></div>')
  .replace('<span>Slaking</span><svg class="pokemon-gender pokemon-gender-F" aria-label="Female"></svg><span class="battle-pokemon-level">Lv. 52</span>', '<span>Hawlucha</span><svg class="pokemon-gender pokemon-gender-F" aria-label="Female"></svg><span class="battle-pokemon-level">Lv. 18</span>')
  .replace('214/225 HP', '22/58 HP')
  .replace(/<ol class="battle-log">[\s\S]*?<\/ol>/, '<ol class="battle-log"><li><span class="battle-log-turn">Turn 1</span><span class="battle-log-pokemon"><span>Wild Zebstrika</span></span> used Stomp! It dealt 36 damage.</li><li><span class="battle-log-pokemon"><span>Hawlucha</span></span> used Encore!</li></ol>')
  .replace(/<div class="battle-controls">[\s\S]*?<\/div>/, `<div class="battle-controls">
    <button class="battle-move-button" aria-label="Wing Attack · Flying · Physical · Power 60 · Accuracy 100% · 35/35 PP">Wing Attack</button>
    <button class="battle-move-button" aria-label="Detect · Fighting · Status · 5/5 PP">Detect</button>
    <button class="battle-move-button" aria-label="Aerial Ace · Flying · Physical · Power 60 · 20/20 PP">Aerial Ace</button>
    <button class="battle-move-button" aria-label="Encore · Normal · Status · 4/5 PP">Encore</button></div>`);
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};

describe('wild battle: switching your Pokémon (regression)', () => {
  const s1 = carryTeamHp(null, readWild(load(turn1), 1))!;
  const s2 = carryTeamHp(s1, readWild(load(turn2), 2))!;

  it('reads the battle card: wild HP, your Pokémon in front, the log and the move buttons', () => {
    expect(s2).toMatchObject({ view: 'battle', map: 'Power Plant 5', name: 'Zebstrika', level: 31, gender: 'F', hp: 87, maxHp: 87, sentOut: 'Slaking' });
    expect(s2.lead).toMatchObject({ name: 'Slaking', level: 52, gender: 'F', hp: 214, maxHp: 225 });
    expect(s2.moves?.map((m) => m.name)).toEqual(['Yawn', 'Throat Chop', 'Take Down', 'Slash']);
    expect(s1.lead).toMatchObject({ name: 'Hawlucha', level: 18, hp: 22, maxHp: 58 });
  });

  it('turn 1: Hawlucha is active at 22/58', () => {
    const p = wildParty(s1);
    expect(p[0]).toMatchObject({ name: 'Hawlucha', active: true, hp: 22, maxHp: 58 });
  });

  it('turn 2: Slaking is active with the card HP; Hawlucha is back on the bench with its 22/58', () => {
    const p = wildParty(s2);
    expect(p.map((r) => [r.name, r.active, r.hp, r.maxHp])).toEqual([
      ['Slaking', true, 214, 225], ['Hawlucha', false, 22, 58], ['Crocalor', false, undefined, undefined], ['Snorlax', false, undefined, undefined],
    ]);
  });

  it('the wild HP follows the card after it takes damage', () => {
    const hit = readWild(load(turn2.replace('87/87 HP', '41/87 HP').replace('width: 100%', 'width: 47%')))!;
    expect(hit).toMatchObject({ hp: 41, maxHp: 87 });
    const noNumbers = readWild(load(turn2.replace('<span class="battle-hp-numbers">87/87 HP</span>', '<div class="battle-health"><strong>30/87 HP</strong></div>')))!;
    expect(noNumbers).toMatchObject({ hp: 30, maxHp: 87 });
  });

  it('never gives the move buttons to slot 1 when the card cannot be read', () => {
    // As seen live: team-panel party with nobody active, Slaking's buttons, no readable lead.
    const blind: WildSnapshot = { ...s2, lead: undefined, sentOut: undefined, party: s2.party!.map((r) => ({ ...r, hp: undefined, maxHp: undefined })) };
    expect(wildParty(blind).some((r) => r.active)).toBe(false);
    // The log's "Go, Slaking!" is enough.
    expect(wildParty({ ...blind, sentOut: 'Slaking' })[0]).toMatchObject({ name: 'Slaking', active: true });
    // So are the move buttons, matched against what each one knows.
    const known: Record<string, string[]> = { Hawlucha: ['Wing Attack', 'Detect', 'Aerial Ace', 'Encore'], Slaking: ['Yawn', 'Throat Chop', 'Take Down', 'Slash'] };
    expect(wildParty(blind, (r) => known[r.name] ?? [])[0]).toMatchObject({ name: 'Slaking', active: true });
  });

  it('a card name with extra words still finds Slaking in the team', () => {
    const messy: WildSnapshot = { ...s2, lead: { name: 'Slaking Female', level: 52, hp: 214, maxHp: 225 } };
    expect(wildParty(messy)[0]).toMatchObject({ name: 'Slaking', active: true, hp: 214 });
  });

  it('does not carry HP into a new encounter', () => {
    const next = carryTeamHp(s2, readWild(load(turn2.replace(/Zebstrika/g, 'Magnemite').replace('Lv. 31', 'Lv. 30')), 3))!;
    expect(next.party?.find((r) => r.name === 'Hawlucha')?.hp).toBeUndefined();
  });
});

describe('Defeat it with the move buttons but no readable card', () => {
  const ds = mini as unknown as Dataset;
  const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
  const mon = (name: string, moves: string[], level: number): BoxMon => ({ uid: name, species: sp(name), moves, level, source: 'game' });
  const box = [mon('Squirtle', ['watergun', 'tackle'], 20), mon('Bulbasaur', ['vinewhip', 'tackle', 'growl'], 20)];
  const w: WildSnapshot = {
    v: 1, at: 1, view: 'battle', name: 'Geodude', level: 12, shiny: false, balls: [],
    party: [
      { name: 'Squirtle', level: 20, active: false, fainted: false, slot: 1 },
      { name: 'Bulbasaur', level: 20, active: false, fainted: false, slot: 2 },
    ],
    moves: [{ name: 'Vine Whip', disabled: false }, { name: 'Tackle', disabled: false }, { name: 'Growl', disabled: false }],
  };

  it('pairs the buttons with the Pokémon that knows them, not slot 1', () => {
    const plan = defeatPlan(ds, box, w);
    expect(plan.options[0].member).toMatchObject({ name: 'Bulbasaur', active: true });
    const squirtle = plan.options.find((o) => o.member.name === 'Squirtle')!;
    expect(squirtle.member.active).toBe(false);
    expect(squirtle.moves.map((m) => m.label).join(' ')).not.toContain('Vine Whip');
  });
});
