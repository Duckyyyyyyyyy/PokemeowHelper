// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { monName, parseBoostLine, parseHp, parseLog, parseMoveLabel, readBattle, switchSide, switchedIn } from '../src/content/battleReader';

const html = readFileSync(resolve(__dirname, 'fixtures/battle/brock-turn3.reconstructed.html'), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};

describe('battle reader (Brock, turn 3)', () => {
  const snap = readBattle(load(html), 1)!;

  it('reads the battle header', () => {
    expect(snap).toMatchObject({ v: 2, status: 'active', kind: 'gym', opponentName: 'Brock', turn: 3 });
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

describe('log events (real lines from two Brock battles, 2026-11-18)', () => {
  // Battle 1 (whole log) – gender already stripped as the reader does.
  const battle1 = [
    ['Go, Cottonee!'], ['Brock sent out Geodude!'],
    ['Your Cottonee used Stun Spore!', 1], ['Opponent’s Geodude is paralyzed! It may be unable to move!', 1],
    ["Opponent’s Geodude couldn't move — it is paralyzed.", 1],
    ["Your Cottonee used Mega Drain! It's super effective! It dealt 35 damage.", 2], ['Opponent’s Geodude fainted.', 2],
    ['Brock sent out Onix!', 2],
    ['Go, Timburr!', 3], ['Opponent’s Onix used Screech!', 3], ["Your Timburr's Defense fell harshly!", 3],
    ['Go, Turtwig!', 4], ['Opponent’s Onix used Rock Tomb! It dealt 12 damage.', 4], ["Your Turtwig's Speed fell!", 4],
    ['Opponent’s Onix used Rock Tomb! It dealt 12 damage.', 5], ["Your Turtwig's Speed fell!", 5],
    ["Your Turtwig used Razor Leaf! It's super effective! It dealt 24 damage.", 5],
    ['Opponent’s Onix used Rock Tomb! It dealt 12 damage.', 6], ["Your Turtwig's Speed fell!", 6],
    ["Your Turtwig used Razor Leaf! It's super effective! It dealt 14 damage.", 6], ['Opponent’s Onix fainted.', 6],
    ['You won the battle!', 6],
  ].map(([text, turn]) => ({ text: text as string, turn: turn as number | undefined }));
  const { events, boosts } = parseLog(battle1);

  it('finds every move use with side, user, target, turn and damage', () => {
    expect(events.map((e) => [e.turn, e.side, e.mon, e.move, e.target, e.damage ?? null])).toEqual([
      [1, 'player', 'Cottonee', 'Stun Spore', 'Geodude', null],
      [2, 'player', 'Cottonee', 'Mega Drain', 'Geodude', 35],
      [3, 'opponent', 'Onix', 'Screech', 'Timburr', null],
      [4, 'opponent', 'Onix', 'Rock Tomb', 'Turtwig', 12],
      [5, 'opponent', 'Onix', 'Rock Tomb', 'Turtwig', 12],
      [5, 'player', 'Turtwig', 'Razor Leaf', 'Onix', 24],
      [6, 'opponent', 'Onix', 'Rock Tomb', 'Turtwig', 12],
      [6, 'player', 'Turtwig', 'Razor Leaf', 'Onix', 14],
    ]);
  });

  it('marks KOs (damage may be capped by the target’s HP)', () => {
    expect(events.filter((e) => e.targetFainted).map((e) => `${e.mon}:${e.move}:${e.damage}`)).toEqual(['Cottonee:Mega Drain:35', 'Turtwig:Razor Leaf:14']);
  });

  it('records the stat stages at the moment of each hit', () => {
    // Third Rock Tomb: Turtwig already at -2 Speed from the first two.
    expect(events[6].stages).toEqual({ attacker: {}, target: { spe: -2 } });
    expect(events[5].stages).toEqual({ attacker: { spe: -2 }, target: {} });
    expect(boosts.player).toEqual({ spe: -3 });
  });

  it('a miss is attached to the move that missed (battle 2)', () => {
    const r = parseLog([
      { text: 'Go, Cottonee!' }, { text: 'Brock sent out Geodude!' },
      { text: 'Your Cottonee used Stun Spore!', turn: 1 }, { text: "Your Cottonee's attack missed.", turn: 1 },
      { text: 'Opponent’s Geodude used Rock Tomb! It dealt 9 damage.', turn: 1 }, { text: "Your Cottonee's Speed fell!", turn: 1 },
    ]);
    expect(r.events.map((e) => [e.move, !!e.missed, e.damage ?? null])).toEqual([['Stun Spore', true, null], ['Rock Tomb', false, 9]]);
  });

  it('flags wording it does not model, and accepts straight apostrophes', () => {
    const r = parseLog([{ text: "Opponent's Onix used Rock Throw! A critical hit! It dealt 20 damage." }]);
    expect(r.events[0]).toMatchObject({ side: 'opponent', mon: 'Onix', move: 'Rock Throw', damage: 20, unusual: true });
  });

  it('switch-in names', () => {
    expect(switchedIn('Go, Turtwig!')).toBe('Turtwig');
    expect(switchedIn('Brock sent out Onix!')).toBe('Onix');
    expect(switchedIn('Mr. Mime sent out Mr. Mime!')).toBe('Mr. Mime');
  });
});
