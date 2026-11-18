// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { monName, parseBoostLine, parseHp, parseLog, parseStatChanges, parseMoveLabel, readBattle, switchSide, switchedIn } from '../src/content/battleReader';

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

  it('new log wording (seen live, Lt. Surge battle 2): trainer’s name for theirs, no prefix for yours', () => {
    const lines = [
      'Go, Gloom!', 'Lt. Surge sent out Voltorb!',
      'Lt. Surge’s Voltorb used Screech!', "Gloom's Defense fell harshly!",
      'Gloom used Giga Drain! It dealt 51 damage.',
      'Lt. Surge used Super Potion on opponent’s Voltorb!',
      'Lt. Surge’s Voltorb used Tackle! It dealt 10 damage.',
      "Lt. Surge’s Voltorb's attack missed.",
      'Gloom used Giga Drain! It dealt 3 damage.', 'Lt. Surge’s Voltorb fainted.',
      'Lt. Surge sent out Raichu!', "Lt. Surge’s Raichu's Evasion rose!",
    ].map((text, i) => ({ text, turn: 1 + Math.floor(i / 3) }));
    const r = parseLog(lines, 'Lt. Surge');
    expect(r.events.map((e) => [e.side, e.mon, e.move, e.damage ?? null])).toEqual([
      ['opponent', 'Voltorb', 'Screech', null],
      ['player', 'Gloom', 'Giga Drain', 51],
      ['opponent', 'Voltorb', 'Tackle', 10],
      ['player', 'Gloom', 'Giga Drain', 3],
    ]);
    expect(r.events[1].stages.attacker).toEqual({ def: -2 }); // Screech landed before Giga Drain
    expect(r.events[2].missed).toBe(true);
    expect(r.events[3].targetFainted).toBe(true);
    expect(r.boosts).toEqual({ player: { def: -2 }, opponent: { evasion: 1 } });
    // Without the trainer's name the opponent's lines are not misread as yours.
    expect(parseLog(lines).events.every((e) => e.side === 'player' ? e.mon === 'Gloom' : true)).toBe(true);
  });

  it('switch-in names', () => {
    expect(switchedIn('Go, Turtwig!')).toBe('Turtwig');
    expect(switchedIn('Brock sent out Onix!')).toBe('Onix');
    expect(switchedIn('Mr. Mime sent out Mr. Mime!')).toBe('Mr. Mime');
  });
});

describe('live markup: stat-change badge next to the name (Juan, 2026-11-18)', () => {
  // Bug seen live: the opponent was read as "Kingdra Evasion +1", so no advice was shown.
  const heading = `<section class="battle-arena" data-status="active"><div class="battle-opponent-stats"><div class="battle-combatant-heading">
    <div class="battle-combatant-name"><strong title="Kingdra">Kingdra<span class="battle-capture-ball" role="img" aria-label="Poké Ball"></span><button class="battle-weakness-button" aria-label="Weaknesses of Kingdra"></button></strong>
      <span class="battle-pokemon-level">Lv. 46<button class="battle-held-item" aria-label="Held item: Chesto Berry. View item information"></button></span>
      <span class="battle-status battle-stat-changes" title="Evasion +1">Evasion +1</span></div>
    <span class="battle-hp-numbers">45/139 HP</span></div></div></section>`;

  it('reads the name, level, item, HP and the on-screen stage', () => {
    document.body.innerHTML = heading;
    const s = readBattle(document)!;
    expect(s.opponent).toMatchObject({ name: 'Kingdra', level: 46, hp: 45, maxHp: 139, item: 'Chesto Berry', stages: { evasion: 1 } });
    expect(s.opponent!.status).toBeUndefined(); // the badge has class battle-status but is not a status condition
    expect(s.boosts.opponent).toEqual({ evasion: 1 });
  });

  it('parses stat-change badges', () => {
    expect(parseStatChanges('Evasion +1')).toEqual({ evasion: 1 });
    expect(parseStatChanges('Attack +2, Speed −1')).toEqual({ atk: 2, spe: -1 });
    expect(parseStatChanges('Sp. Atk -2')).toEqual({ spa: -2 });
    // Short badge seen live (Lt. Surge, Voltorb's Screech on Gloom): "Def -2" was read as no change.
    expect(parseStatChanges('Def -2')).toEqual({ def: -2 });
    expect(parseStatChanges('Atk +1, SpA -1, SpD +2, Spe -1, Acc -1, Eva +1')).toEqual({ atk: 1, spa: -1, spd: 2, spe: -1, accuracy: -1, evasion: 1 });
    expect(parseStatChanges('Something +1')).toEqual({});
  });

  it('a badge it cannot parse falls back to the stages rebuilt from the log (not "no change")', () => {
    document.body.innerHTML = html;
    const fromLog = readBattle(document, 1)!.boosts.player;
    expect(Object.keys(fromLog).length).toBeGreaterThan(0);
    const name = document.querySelector('.battle-player-stats .battle-combatant-name')!;
    name.insertAdjacentHTML('beforeend', '<span class="battle-status battle-stat-changes" title="Mystery +1">Mystery +1</span>');
    expect(readBattle(document, 1)!.boosts.player).toEqual(fromLog);
  });
});

describe('fainted active Pokémon / forced switch (live bug: Drake, turn 12, Charizard at 0 HP)', () => {
  // Reconstruction from the Brock fixture: the FNT badge and the prompt's markup were only seen in a
  // screenshot, so the reader matches them as text. Each variant keeps one signal only.
  const zeroHp = html.replace('<span class="battle-hp-numbers">45/45 HP</span>', '<span class="battle-hp-numbers">0/45 HP</span>');
  const normal = readBattle(load(html), 1)!;

  it('a normal turn is not a forced switch', () => {
    expect(normal.forcedSwitch).toBeUndefined();
  });

  it('0 HP on screen', () => {
    const s = readBattle(load(zeroHp), 1)!;
    expect(s.player?.hp).toBe(0);
    expect(s.forcedSwitch).toBe(true);
  });

  it('the FNT badge next to the level', () => {
    const s = readBattle(load(html.replace('Lv. 19<button', 'Lv. 19<span class="battle-fainted-badge">FNT</span><button')), 1)!;
    expect(s.forcedSwitch).toBe(true);
  });

  it('the active switch card marked fainted', () => {
    const s = readBattle(load(html.replace('data-has-item="true" data-fainted="false"', 'data-has-item="true" data-fainted="true"')), 1)!;
    expect(s.forcedSwitch).toBe(true);
  });

  it('the "Choose your next Pokémon." prompt, but not the same words in the battle log', () => {
    const prompt = html.replace('<div class="battle-choices">', '<div class="battle-choices"><p>Choose your next Pokémon.</p>');
    expect(readBattle(load(prompt), 1)!.forcedSwitch).toBe(true);
    const inLog = html.replace(/(<li>Opponent’s <span class="battle-log-pokemon">)/, '<li>Choose your next Pokémon.</li>$1');
    expect(inLog).not.toBe(html);
    expect(readBattle(load(inLog), 1)!.forcedSwitch).toBeUndefined();
  });
});
