// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLog, parseMoveLabel, readBattle, readBench } from '../src/content/battleReader';
import { TATE_LIZA_LOG } from './fixtures/battle/tateLizaLog';


const html = readFileSync(resolve(__dirname, 'fixtures/battle/tate-liza-doubles-turn1.reconstructed.html'), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};

describe('doubles battle screen (Tate & Liza, turn 1, live layout)', () => {
  const snap = readBattle(load(html), 1)!;

  it('reads both active Pokémon of each side with position, HP and item', () => {
    expect(snap.format).toBe('doubles');
    expect(snap.actives!.player.map((m) => [m.position, m.name, m.level, m.hp, m.maxHp, m.item ?? null])).toEqual([
      [1, 'Slowbro', 45, 144, 144, 'Psychic Gem'], [2, 'Scrafty', 45, 122, 122, null],
    ]);
    expect(snap.actives!.opponent.map((m) => [m.position, m.name, m.level, m.hp])).toEqual([[1, 'Claydol', 41, 112], [2, 'Xatu', 41, 117]]);
    // Singles callers still see position 1 as "the" active Pokémon.
    expect(snap.player?.name).toBe('Slowbro');
    expect(snap.opponent?.name).toBe('Claydol');
  });

  it('reads the shown moves (new label format) and whose they are', () => {
    expect(snap.movesFor).toBe('Slowbro');
    expect(snap.moves.map((m) => [m.name, m.type, m.category, m.pp, m.maxPp])).toEqual([
      ['Calm Mind', 'Psychic', 'Status', 20, 20], ['Surf', 'Water', 'Special', 15, 15],
      ['Slack Off', 'Normal', 'Status', 5, 5], ['Psychic', 'Psychic', 'Special', 10, 10],
    ]);
    expect(snap.opponentTeam.filter((r) => r.active).map((r) => r.name)).toEqual(['Claydol', 'Xatu']);
    expect(snap.turn).toBe(1);
  });

  it('per-card stat badges ("Sp. Atk +1 · Sp. Def +1", seen live on turn 2)', () => {
    const doc = load(html.replace('<span class="battle-hp-numbers">144/144 HP</span>',
      '<span class="battle-status battle-stat-changes" title="Sp. Atk +1 · Sp. Def +1">Sp. Atk +1 · Sp. Def +1</span><span class="battle-hp-numbers">120/144 HP</span>'));
    const s = readBattle(doc, 1)!;
    expect(s.actives!.player[0]).toMatchObject({ name: 'Slowbro', hp: 120, stages: { spa: 1, spd: 1 } });
    expect(s.actives!.player[1].stages).toBeUndefined();
  });

  it('parses the old and the doubles move label', () => {
    expect(parseMoveLabel('Surf, Water, Special, 15 of 15 PP')).toMatchObject({ name: 'Surf', type: 'Water', category: 'Special', pp: 15, maxPp: 15 });
    expect(parseMoveLabel('Fairy Wind · Fairy · Special · Power 40 · Accuracy 100% · 30/30 PP. No additional effect.')).toMatchObject({ name: 'Fairy Wind', power: 40, pp: 30 });
  });

  it('reads the doubles Switch list ("Send out X", seen live on turn 2)', () => {
    load(`<div>
      <div class="battle-switch-card" data-has-item="true"><button type="button" class="battle-switch-button" disabled aria-label="Send out Slowbro. Choose a healthy reserve Pokémon."><span><strong>Slowbro · Lv. 45</strong><small>120/144 HP · Active</small></span></button>
        <details class="battle-switch-moves"><summary>Moves</summary><ul><li><span>Calm Mind</span><span class="battle-switch-move-pp">19 / 20 PP</span></li><li><span>Surf</span><span class="battle-switch-move-pp">15 / 15 PP</span></li></ul></details></div>
      <div class="battle-switch-card" data-has-item="false"><button type="button" class="battle-switch-button" aria-label="Send out Ferrothorn"><span><strong>Ferrothorn · Lv. 41</strong><small>118/118 HP</small></span></button></div>
    </div>`);
    expect(readBench(document)).toEqual([
      { name: 'Slowbro', level: 45, hp: 120, maxHp: 144, active: true, fainted: false, moves: [{ name: 'Calm Mind', pp: 19, maxPp: 20 }, { name: 'Surf', pp: 15, maxPp: 15 }] },
      { name: 'Ferrothorn', level: 41, hp: 118, maxHp: 118, active: false, fainted: false, moves: undefined },
    ]);
  });
});

describe('doubles log (real wording, turns 1–2)', () => {
  const { events, monBoosts } = parseLog(TATE_LIZA_LOG, 'Tate & Liza');

  it('finds every move with its user, side and target', () => {
    expect(events.map((e) => [e.turn, e.side, e.mon, e.move, e.targetSide ?? null, e.target ?? null, e.damage ?? null])).toEqual([
      [1, 'opponent', 'Xatu', 'Calm Mind', null, 'Scrafty', null],
      [1, 'opponent', 'Claydol', 'Earthquake', null, 'Scrafty', null],
      [1, 'player', 'Scrafty', 'Crunch', 'opponent', 'Claydol', 86],
      [1, 'player', 'Slowbro', 'Calm Mind', null, 'Xatu', null],
      [2, 'opponent', 'Xatu', 'Calm Mind', null, 'Scrafty', null],
      [2, 'player', 'Scrafty', 'Beat Up', 'opponent', 'Claydol', 108],
      [2, 'player', 'Slowbro', 'Surf', null, 'Xatu', null],
    ]);
    // The bare "Slowbro used Calm Mind!" after "Go, Scrafty!" is still yours.
    expect(events.filter((e) => e.mon === 'Slowbro').every((e) => e.side === 'player')).toBe(true);
    // The trainer using an item is not a move.
    expect(events.some((e) => /Potion/.test(e.move))).toBe(false);
  });

  it('spread hits: one per Pokémon, immune ones flagged, the ally included', () => {
    const eq = events[1];
    expect(eq.hits).toEqual([
      { side: 'opponent', mon: 'Xatu', immune: true, stages: { spa: 1, spd: 1 } },
      { side: 'player', mon: 'Slowbro', damage: 24, stages: {} },
      { side: 'player', mon: 'Scrafty', damage: 27, stages: {} },
    ]);
    const surf = events[6];
    expect(surf.hits?.map((h) => [h.side, h.mon, h.damage, !!h.fainted, h.stages])).toEqual([
      ['player', 'Scrafty', 46, false, {}],
      ['opponent', 'Claydol', 4, true, {}],
      ['opponent', 'Xatu', 36, false, { spa: 2, spd: 2 }],
    ]);
  });

  it('crits and multi-hit stay out of damage checks; KOs are flagged', () => {
    expect(events[5].unusual).toBe(true); // Beat Up: crit, 6 hits
    expect(events[2].unusual).toBeUndefined();
  });

  it('stages per Pokémon', () => {
    expect(monBoosts['opponent|xatu']).toEqual({ spa: 2, spd: 2 });
    expect(monBoosts['player|slowbro']).toEqual({ spa: 1, spd: 1 });
    expect(monBoosts['player|scrafty'] ?? {}).toEqual({});
    // Surf was used at Slowbro +1 SpA.
    expect(events[6].stages.attacker).toEqual({ spa: 1, spd: 1 });
  });
});
