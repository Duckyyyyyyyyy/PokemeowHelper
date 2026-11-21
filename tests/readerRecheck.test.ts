// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBoostLine, parseHp, parseLog, parseStatChanges, readBattle, readField, readMoves, stageFromMultiplier } from '../src/content/battleReader';
import { activeFainted } from '../src/shared/battle';

/** Reader checks against the 2026-11 game update: real saves (scrubbed) plus the stylesheet-only field markup. */
const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures/battle', name), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};

describe('real save: Shauntal, turn 3, your Pokémon just fainted', () => {
  const snap = readBattle(load(fixture('shauntal-forced-switch.html')), 1)!;

  it('reads the header ("Turn 3 · 4/4 left")', () => {
    expect(snap).toMatchObject({ status: 'active', kind: 'gym', opponentName: 'Shauntal', turn: 3 });
  });

  it('reads the fainted badge as status fnt and asks for a switch', () => {
    expect(snap.player).toMatchObject({ name: 'Alakazam', level: 52, hp: 0, maxHp: 132, status: 'fnt' });
    expect(snap.forcedSwitch).toBe(true);
    expect(activeFainted(snap)).toBe(true);
    expect(snap.moves).toEqual([]);
  });

  it('reads the stat tag "0.5× SpD" (Sp. Def -2) on the opponent', () => {
    expect(snap.opponent).toMatchObject({ name: 'Cofagrigus', level: 56, hp: 126, maxHp: 148, stages: { spd: -2 } });
    expect(snap.boosts.opponent).toEqual({ spd: -2 });
    // The tag text alone gives the same stage as its label.
    const tag = document.querySelector('.battle-stat-change')!;
    expect(parseStatChanges(tag.textContent!)).toEqual(parseStatChanges(tag.getAttribute('aria-label')!));
  });

  it('reads the same stage when only the multiplier text is left (no title, no label)', () => {
    load(fixture('shauntal-forced-switch.html'));
    document.querySelectorAll('[title*="Sp. Def"], [aria-label*="Sp. Def"]').forEach((e) => {
      e.removeAttribute('title');
      e.removeAttribute('aria-label');
    });
    expect(readBattle(document, 1)!.opponent!.stages).toEqual({ spd: -2 });
  });

  it('parses the trainer-named log ("Shauntal’s Cofagrigus")', () => {
    expect(snap.events!.map((e) => [e.turn, e.side, e.mon, e.move, e.damage ?? null])).toEqual([
      [1, 'player', 'Aggron', 'Metal Sound', null],
      [1, 'opponent', 'Cofagrigus', 'Shadow Ball', 119],
      [2, 'player', 'Aggron', 'Rock Slide', 22],
      [2, 'opponent', 'Cofagrigus', 'Grass Knot', 1],
      [3, 'player', 'Alakazam', 'Future Sight', null],
      [3, 'opponent', 'Cofagrigus', 'Shadow Ball', 132],
    ]);
    // Metal Sound's drop counts for the hits after it.
    expect(snap.events![2].stages.target).toEqual({ spd: -2 });
  });

  it('reads the bench, the opponent roster and no field effect', () => {
    expect(snap.bench.map((b) => [b.name, b.hp, b.fainted])).toEqual([
      ['Aggron', 0, true], ['Toxtricity', 148, false], ['Feraligatr', 119, false],
      ['Dedenne', 83, false], ['Slowbro', 150, false], ['Alakazam', 0, true],
    ]);
    expect(snap.opponentTeam.map((r) => [r.name, r.hp, r.active])).toEqual([
      ['Cofagrigus', 126, true], ['Drifblim', 251, false], ['Golurk', 183, false], ['Chandelure', 155, false],
    ]);
    expect(snap.field).toBeUndefined();
  });
});

describe('real save: Tate & Liza Doubles, turn 4', () => {
  const snap = readBattle(load(fixture('tate-liza-doubles-turn4.html')), 1)!;

  it('reads the four actives with positions and the "2× Def" tag', () => {
    expect(snap).toMatchObject({ format: 'doubles', opponentName: 'Tate & Liza', turn: 4, movesFor: 'Ferrothorn' });
    expect(snap.actives!.player.map((m) => [m.position, m.name, m.hp, m.maxHp, m.stages ?? null])).toEqual([
      [1, 'Ferrothorn', 79, 129, { def: 2 }],
      [2, 'Doublade', 48, 114, null],
    ]);
    expect(snap.actives!.opponent.map((m) => [m.position, m.name, m.hp, m.maxHp, m.item ?? null])).toEqual([
      [1, 'Solrock', 140, 140, 'Sitrus Berry'],
      [2, 'Claydol', 73, 112, null],
    ]);
  });

  it('reads "2× Def" from the tag text alone (no title, no label)', () => {
    load(fixture('tate-liza-doubles-turn4.html'));
    document.querySelectorAll('[title="Defense +2"], [aria-label="Defense +2"]').forEach((e) => {
      e.removeAttribute('title');
      e.removeAttribute('aria-label');
    });
    // Without the log too, or its Iron Defense line would supply the stage.
    document.querySelector('.battle-log')!.remove();
    expect(readBattle(document, 1)!.actives!.player[0].stages).toEqual({ def: 2 });
  });

  it('reads the moves of position 1 and the roster with the fainted Xatu', () => {
    expect(snap.moves.map((m) => [m.name, m.pp, m.maxPp, m.disabled])).toEqual([
      ['Flash Cannon', 8, 10, false], ['Iron Head', 15, 15, false], ['Self-Destruct', 5, 5, false], ['Iron Defense', 14, 15, false],
    ]);
    expect(snap.opponentTeam.map((r) => [r.name, r.active, r.fainted])).toEqual([
      ['Claydol', true, false], ['Xatu', false, true], ['Lunatone', false, false], ['Solrock', true, false],
    ]);
  });

  it('parses the doubles log: targets, spread hits and Xatu’s stages', () => {
    const quake = snap.events!.find((e) => e.move === 'Earthquake')!;
    expect(quake.hits!.map((h) => [h.side, h.mon, h.damage ?? null, !!h.immune])).toEqual([
      ['opponent', 'Xatu', null, true], ['player', 'Ferrothorn', 25, false], ['player', 'Aggron', 60, false],
    ]);
    const slash = snap.events!.find((e) => e.move === 'Night Slash')!;
    expect(slash).toMatchObject({ side: 'player', mon: 'Doublade', target: 'Xatu', targetSide: 'opponent', damage: 50, targetFainted: true });
    // Calm Mind +1/+1, then Flash Cannon's Sp. Def drop.
    expect(slash.stages.target).toEqual({ spa: 1, spd: 0 });
  });
});

describe('fainted badge in Doubles (markup from the real singles save; not seen in a Doubles save yet)', () => {
  const card = (pos: number, name: string, hp: string, fnt = false) => `<div class="double-active-card"><span class="double-position-label">Position ${pos}</span>
    <div class="battle-combatant"><div class="battle-combatant-name"><strong title="${name}">${name}</strong>
    <span class="battle-pokemon-level">Lv. 45${fnt ? '<span class="battle-status battle-status-fnt"><img alt="Fainted"></span>' : ''}</span></div>
    <span class="battle-hp-numbers">${hp} HP</span></div></div>`;
  const arena = (fnt: boolean) => `<section class="battle-arena" data-format="doubles" data-status="active">
    <div class="battle-player-stats">${card(1, 'Ferrothorn', '79/129')}${card(2, 'Doublade', fnt ? '0/114' : '48/114', fnt)}</div>
    <div class="battle-opponent-stats">${card(1, 'Solrock', '140/140')}${card(2, 'Claydol', '73/112')}</div></section>`;

  it('asks for a switch when position 2 shows the badge', () => {
    const snap = readBattle(load(arena(true)), 1)!;
    expect(snap.actives!.player[1]).toMatchObject({ name: 'Doublade', hp: 0, status: 'fnt' });
    expect(snap.forcedSwitch).toBe(true);
    expect(readBattle(load(arena(false)), 1)!.forcedSwitch).toBeUndefined();
  });
});

describe('stat tags with multipliers', () => {
  it('maps the shown multiplier back to a stage', () => {
    const normal = [[1.5, 1], [2, 2], [2.5, 3], [3, 4], [3.5, 5], [4, 6], [0.67, -1], [0.5, -2], [0.4, -3], [0.33, -4], [0.29, -5], [0.25, -6]];
    for (const [m, s] of normal) expect(stageFromMultiplier(m, 'atk')).toBe(s);
    const accEva = [[1.33, 1], [1.67, 2], [2, 3], [2.33, 4], [2.67, 5], [3, 6], [0.75, -1], [0.6, -2], [0.5, -3], [0.43, -4], [0.38, -5], [0.33, -6]];
    for (const [m, s] of accEva) expect(stageFromMultiplier(m, 'evasion')).toBe(s);
    expect(stageFromMultiplier(1.8, 'atk')).toBeUndefined();
  });

  it('parses tag text and keeps the old "Evasion +1" labels', () => {
    expect(parseStatChanges('2× Atk, 0.67× Def, 1.33× Acc, 0.75× Eva')).toEqual({ atk: 2, def: -1, accuracy: 1, evasion: -1 });
    expect(parseStatChanges('0.5× SpD, 1.5× SpA, 4× Spe')).toEqual({ spd: -2, spa: 1, spe: 6 });
    expect(parseStatChanges('Evasion +1')).toEqual({ evasion: 1 });
    // Crit-stage tags (Focus Energy) carry no stat stage.
    expect(parseStatChanges('Crit +2')).toEqual({});
  });
});

describe('2026-11 log wording', () => {
  it('reads numbers with commas', () => {
    expect(parseHp('1,020/1,250 HP')).toEqual({ hp: 1020, maxHp: 1250 });
    const { events } = parseLog([
      { text: 'Go, Snorlax!', turn: 1 },
      { text: 'Brock sent out Onix!', turn: 1 },
      { text: 'Snorlax used Giga Impact on Brock’s Onix! It dealt 1,234 damage.', turn: 1 },
      { text: 'Brock’s Onix used Earthquake!', turn: 2 },
      { text: 'Snorlax took 1,050 damage.', turn: 2 },
    ], 'Brock');
    expect(events[0]).toMatchObject({ mon: 'Snorlax', target: 'Onix', damage: 1234 });
    expect(events[1].hits).toEqual([{ side: 'player', mon: 'Snorlax', damage: 1050, stages: {} }]);
  });

  it('reads Belly Drum / Anger Point "maximized" as +6 (wording is a guess)', () => {
    expect(parseBoostLine('Snorlax cut its own HP and maximized its Attack!')).toMatchObject({ side: 'player', mon: 'Snorlax', stats: ['atk'] });
    const { boosts } = parseLog([
      { text: 'Go, Snorlax!', turn: 1 },
      { text: 'Brock sent out Primeape!', turn: 1 },
      { text: 'Snorlax used Belly Drum!', turn: 1 },
      { text: 'Snorlax cut its own HP and maximized its Attack!', turn: 1 },
      { text: 'Brock’s Primeape maximized its Attack!', turn: 1 },
    ], 'Brock');
    expect(boosts).toEqual({ player: { atk: 6 }, opponent: { atk: 6 } });
  });
});

describe('greyed-out moves', () => {
  it('reads data-unavailable as disabled (stylesheet only, not in a save yet)', () => {
    load('<button class="battle-move-button" data-unavailable="true" aria-label="Tackle, Normal, Physical, 35 of 35 PP"></button>');
    expect(readMoves(document)[0]).toMatchObject({ name: 'Tackle', pp: 35, disabled: true });
  });
});

describe('field effects beside the turn counter (unverified markup)', () => {
  it('reads weather, terrain, turns left and every label', () => {
    const snap = readBattle(load(fixture('field-effects.unverified.html')), 1)!;
    expect(snap.field).toEqual({
      weather: 'Rain', weatherTurns: 4, terrain: 'Electric', terrainTurns: 3,
      labels: ['Rain · 4 turns left', 'Electric Terrain · 3 turns left', 'Trick Room'],
    });
  });

  it('falls back to the scene art’s data-weather', () => {
    load('<section class="battle-arena"><div class="battle-weather-visual" data-weather="sunnyday"></div></section>');
    expect(readField(document)).toEqual({ weather: 'Sun' });
  });
});
