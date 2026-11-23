// @vitest-environment happy-dom
// World Boss raid screen (live copy 2026-11-23): the battle reader and the Battle tab advice.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { readBattle, wikiBossName } from '../src/content/battleReader';
import { adviseTurn, matchNpc } from '../src/engine/turnAdvisor';
import { checkEvent } from '../src/engine/damageCheck';
import { baseMovesForMax } from '../src/engine/worldBoss';

const html = readFileSync(resolve(__dirname, 'fixtures/worldboss/raid-turn1.live.html'), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};
const ds = structuredClone(fixture) as unknown as Dataset;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;

describe('World Boss raid screen reader (live fixture)', () => {
  const snap = readBattle(load(html), 7)!;

  it('reads a battle (the raid screen has no .battle-arena)', () => {
    expect(snap).not.toBeNull();
    expect(snap).toMatchObject({ status: 'active', kind: 'world-boss', turn: 1, opponentName: 'Gigantamax Rillaboom' });
  });

  it('reads the boss from its panel: wiki name, shared HP (1% steps), status, stat stages', () => {
    expect(snap.opponent).toEqual({ name: 'Gigantamax Rillaboom', hp: 5_900_000, maxHp: 10_000_000, status: 'par', stages: { atk: 2, spa: -1, spd: 1 } });
    expect(snap.boosts.opponent).toEqual({ atk: 2, spa: -1, spd: 1 });
  });

  it('reads your side like any battle: active, moves, switch cards', () => {
    expect(snap.player).toMatchObject({ name: 'Charizard', level: 66, hp: 147, maxHp: 194, stages: { spa: -1 } });
    expect(snap.moves.map((m) => [m.name, m.pp])).toEqual([['Growl', 40], ['Air Slash', 15], ['Ember', 25], ['Flamethrower', 14]]);
    expect(snap.bench.map((b) => b.name)).toEqual(['Charizard', 'Hawlucha']);
    expect(snap.forcedSwitch).toBeUndefined();
  });

  it('the log puts the boss on the opponent side ("World Boss … appeared!")', () => {
    const uses = snap.events!.map((e) => [e.side, e.mon, e.move]);
    expect(uses).toEqual([['player', 'Charizard', 'Flamethrower'], ['opponent', 'Gigantamax Rillaboom', 'Max Flutterby']]);
    expect(snap.log.join(' ')).toMatch(/World Boss Gigantamax Rillaboom appeared!/);
  });

  it('"GMAX X" → "Gigantamax X" only as a whole word', () => {
    expect(wikiBossName('GMAX Melmetal')).toBe('Gigantamax Melmetal');
    expect(wikiBossName('World Boss G-MAX Melmetal appeared!')).toBe('World Boss Gigantamax Melmetal appeared!');
    expect(wikiBossName('Eternamax Eternatus')).toBe('Eternamax Eternatus');
  });
});

describe('World Boss raid → Battle tab advice', () => {
  // The fixture dataset's only World Boss is Gigantamax Venusaur: the same screen with that boss.
  const snap = readBattle(load(html.replace(/Rillaboom/g, 'Venusaur')), 7)!;
  const box: BoxMon[] = [{
    uid: 'c', species: sp('Charizard'), level: 66, moves: ['growl', 'airslash', 'ember', 'flamethrower'], source: 'game', nature: 'Modest',
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  }];

  it('matches the World Boss NPC and gives move advice', () => {
    expect(matchNpc(ds, snap)?.npc.name).toBe('Gigantamax Venusaur');
    const a = adviseTurn(ds, snap, box, { lookahead: 0 });
    expect(a.npc?.name).toBe('Gigantamax Venusaur');
    expect(a.actions.length).toBeGreaterThan(0);
    expect(a.actions[0].moveId).toBe('flamethrower');
  });

  it('a logged Max Move counts as the boss’s own move of that type, not an extra threat', () => {
    const venu = ds.npcs.find((n) => n.name === 'Gigantamax Venusaur')!;
    const pool = venu.variants[0].team[0].moves;
    expect(baseMovesForMax(ds, 'Max Flutterby', pool)).toEqual(['furycutter']);
    expect(baseMovesForMax(ds, 'Max Guard', pool)).toEqual([]);
    expect(baseMovesForMax(ds, 'Flamethrower', pool)).toBeNull();
    const a = adviseTurn(ds, snap, box, { lookahead: 0 });
    expect(a.notes.join(' ')).not.toMatch(/Max Flutterby/);
    expect(a.prediction!.map((g) => g.moveId)).not.toContain('maxflutterby');
    // Picked set without its Bug move: Fury Cutter (from the pool) is the out-of-set move, by its real name.
    const picked = adviseTurn(ds, snap, box, { lookahead: 0, bossMoves: { [venu.id]: ['knockoff', 'outrage', 'sludgebomb', 'earthpower'] } });
    expect(picked.notes.join(' ')).toMatch(/seen using Fury Cutter, which is not in the moves picked/);
    expect(picked.prediction!.map((g) => g.moveId)).toContain('furycutter');
  });

  it('no calc check on raid damage (125x, capped)', () => {
    const ev = snap.events!.find((e) => e.side === 'player')!;
    expect(ev.damage).toBe(14_500);
    expect(checkEvent(ds, box, snap, ev)).toBeNull();
  });
});
