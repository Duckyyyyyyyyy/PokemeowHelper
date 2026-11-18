// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { monName, parseBoostLine, parseHp, parseMoveLabel, readBattle, switchSide } from '../src/content/battleReader';

const html = readFileSync(resolve(__dirname, 'fixtures/battle/brock-turn3.reconstructed.html'), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};

describe('battle reader (Brock, turn 3)', () => {
  const snap = readBattle(load(html), 1)!;

  it('reads the battle header', () => {
    expect(snap).toMatchObject({ v: 1, status: 'active', kind: 'gym', opponentName: 'Brock', turn: 3 });
  });

  it('reads both active Pokémon with exact HP, status and item', () => {
    expect(snap.player).toEqual({ name: 'Cottonee', level: 19, hp: 45, maxHp: 45, status: undefined, item: 'Fairy Feather' });
    expect(snap.opponent).toEqual({ name: 'Onix', level: 14, hp: 38, maxHp: 38, status: 'par', item: undefined });
  });

  it('reads the four moves from their labels', () => {
    expect(snap.moves).toHaveLength(4);
    expect(snap.moves[0]).toEqual({ name: 'Fairy Wind', type: 'Fairy', category: 'Special', power: 40, accuracy: 100, pp: 30, maxPp: 30, disabled: false });
    expect(snap.moves[1]).toMatchObject({ name: 'Stun Spore', type: 'Grass', category: 'Status', power: undefined, accuracy: 75, pp: 29 });
  });

  it('reads your bench and the opponent roster', () => {
    expect(snap.bench.map((b) => [b.name, b.level, b.hp, b.maxHp, b.active])).toEqual([
      ['Cottonee', 19, 45, 45, true],
      ['Timburr', 16, 51, 51, false],
      ['Turtwig', 14, 41, 41, false],
      ['Pancham', 14, 43, 43, false],
      ['Flapple', 11, 38, 38, false],
    ]);
    expect(snap.bench[0].moves?.map((m) => m.name)).toEqual(['Fairy Wind', 'Stun Spore', 'Mega Drain', 'Razor Leaf']);
    expect(snap.opponentTeam).toEqual([
      { name: 'Geodude', level: 12, hp: 0, maxHp: 35, active: false, fainted: true },
      { name: 'Onix', level: 14, hp: 38, maxHp: 38, active: true, fainted: false },
    ]);
  });

  it('rebuilds stat stages from the log and resets them on switch-in', () => {
    // Geodude's +1 Defense is gone (it fainted, Onix came in); Cottonee is at -2 Defense from Screech.
    expect(snap.boosts).toEqual({ player: { def: -2 }, opponent: {} });
    expect(snap.log.at(-1)).toBe('Your Cottonee\'s Defense fell harshly!');
  });

  it('returns null outside a battle', () => {
    expect(readBattle(load('<main>Explore</main>'))).toBeNull();
  });

  it('reads the end of the battle', () => {
    const won = readBattle(load(html.replace('data-status="active"', 'data-status="won"')))!;
    expect(won.status).toBe('won');
  });
});

describe('text parsers', () => {
  it('Pokémon names ignore gender labels, buttons and level/state words (live markup)', () => {
    const el = (h: string) => { const d = document.createElement('div'); d.innerHTML = h; return d; };
    expect(monName(el('<span>Geodude<span>Male</span></span><span>Lv. 12</span><span>Active</span>'))).toBe('Geodude');
    expect(monName(el('Cottonee<button aria-label="Weaknesses">x</button><span aria-hidden="true">♀</span>'))).toBe('Cottonee');
    expect(monName(el('<span>Mr. Mime<span>Female</span></span>'))).toBe('Mr. Mime');
  });

  it('HP in all three formats seen in the game', () => {
    expect(parseHp('43/43 HP')).toEqual({ hp: 43, maxHp: 43 });
    expect(parseHp('30 / 30 HP')).toEqual({ hp: 30, maxHp: 30 });
    expect(parseHp('Switch to Timburr, level 16, 51 of 51 HP')).toEqual({ hp: 51, maxHp: 51 });
  });

  it('move labels', () => {
    expect(parseMoveLabel('Razor Leaf · Grass · Physical · Power 55 · Accuracy 95% · 25/25 PP. High critical hit ratio.'))
      .toEqual({ name: 'Razor Leaf', type: 'Grass', category: 'Physical', power: 55, accuracy: 95, pp: 25, maxPp: 25 });
  });

  it('stat-stage lines (real wording from the game, plus mainline variants)', () => {
    expect(parseBoostLine("Your Timburr's Defense fell harshly!")).toEqual({ side: 'player', stats: ['def'], delta: -2 });
    expect(parseBoostLine("Your Turtwig's Speed fell!")).toEqual({ side: 'player', stats: ['spe'], delta: -1 });
    expect(parseBoostLine("Opponent’s Onix's Attack rose sharply!")).toEqual({ side: 'opponent', stats: ['atk'], delta: 2 });
    expect(parseBoostLine("Opponent’s Gyarados's Attack and Speed rose!")).toEqual({ side: 'opponent', stats: ['atk', 'spe'], delta: 1 });
    expect(parseBoostLine("Your Lapras's Sp. Atk rose drastically!")).toEqual({ side: 'player', stats: ['spa'], delta: 3 });
    expect(parseBoostLine("Your Lapras's Special Defense fell severely!")).toEqual({ side: 'player', stats: ['spd'], delta: -3 });
    expect(parseBoostLine('Opponent’s Onix used Rock Tomb! It dealt 12 damage.')).toBeNull();
    expect(parseBoostLine("Your Onix's Attack won't go any higher!")).toBeNull();
  });

  it('switch-in lines', () => {
    expect(switchSide('Go, Turtwig!')).toBe('player');
    expect(switchSide('Brock sent out Onix!')).toBe('opponent');
    expect(switchSide('Your Turtwig used Razor Leaf!')).toBeNull();
  });
});
