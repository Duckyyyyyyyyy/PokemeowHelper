// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import { readBattle } from '../src/content/battleReader';
import { adviseTurn, battleSpeed, matchNpc } from '../src/engine/turnAdvisor';
import { boxToCalc, makeField, moveDamage, npcToCalc } from '../src/engine/damage';

const ds = structuredClone(fixture) as unknown as Dataset;
const add = (id: number, name: string, types: string[], b: number[]) => {
  ds.species[id] = { id, name, types, baseStats: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
};
// Species from the real battle that the trimmed fixture lacks (base stats = mainline).
add(546, 'Cottonee', ['Grass', 'Fairy'], [40, 27, 60, 37, 50, 66]);
add(387, 'Turtwig', ['Grass'], [55, 68, 64, 45, 55, 31]);
add(532, 'Timburr', ['Fighting'], [75, 80, 55, 25, 35, 35]);
add(674, 'Pancham', ['Fighting'], [67, 82, 62, 46, 48, 43]);
add(841, 'Flapple', ['Grass', 'Dragon'], [70, 110, 80, 95, 60, 70]);

const html = readFileSync(resolve(__dirname, 'fixtures/battle/brock-turn3.reconstructed.html'), 'utf8');
document.body.innerHTML = html;
const snap = readBattle(document, 1)!;
const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const zero = iv(0);

describe('turn advice (Brock, turn 3: Cottonee vs paralyzed Onix)', () => {
  const box: BoxMon[] = [
    { uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: zero },
    { uid: 'game:2', gameId: '2', source: 'game', species: 387, level: 14, moves: ['razorleaf'], nature: 'Hardy', ivs: iv(20), evs: zero },
  ];
  const a = adviseTurn(ds, snap, box);

  it('finds Brock’s first team and the wiki set of the active Onix', () => {
    expect(matchNpc(ds, snap)?.npc.id).toBe('challenge:brock');
    expect(a.variant?.label).toBe('First battle');
    expect(a.foe).toMatchObject({ known: true, mon: { name: 'Onix', level: 14 } });
  });

  it('uses your box entry but the level shown in battle', () => {
    expect(a.me?.known).toBe(true);
    expect(a.me?.mon.uid).toBe('game:1');
    expect(a.me?.mon.level).toBe(19);
  });

  it('ranks a 4× Grass move first and leaves the status move unscored', () => {
    const top = a.actions[0];
    expect(['Mega Drain', 'Razor Leaf']).toContain(top.label);
    expect(top.score!).toBeGreaterThanOrEqual(55);
    const fairy = a.actions.find((x) => x.label === 'Fairy Wind')!;
    expect(fairy.score!).toBeLessThan(top.score!);
    expect(a.actions.find((x) => x.label === 'Stun Spore')!.score).toBeNull();
  });

  it('lists every healthy bench Pokémon as a switch option', () => {
    expect(a.actions.filter((x) => x.kind === 'switch').map((x) => x.label).sort()).toEqual(
      ['Switch to Flapple', 'Switch to Pancham', 'Switch to Timburr', 'Switch to Turtwig'],
    );
  });

  it('applies stat stages from the log: -2 Defense makes their physical hit bigger', () => {
    const calm = adviseTurn(ds, { ...snap, boosts: { player: {}, opponent: {} } }, box);
    expect(a.threat!.maxPct).toBeGreaterThan(calm.threat!.maxPct);
  });

  it('paralysis halves speed', () => {
    const onix = npcToCalc(ds, a.foe!.mon);
    const before = battleSpeed(onix);
    onix.status = 'par';
    expect(battleSpeed(onix)).toBe(before / 2);
  });

  it('a Pokémon that is not in your box still gets advice, with a note', () => {
    const b = adviseTurn(ds, snap, []);
    expect(b.me?.known).toBe(false);
    expect(b.actions[0].score).not.toBeNull();
    expect(b.notes.join(' ')).toMatch(/not in your box/);
  });
});

describe('damage seen in the real battle fits the calc', () => {
  // Battle log, 2026-11-18: Onix (Lv14) Rock Tomb → Turtwig (Lv14) "It dealt 12 damage" (×3, before
  // Turtwig's Speed drops mattered). Turtwig's IVs are unknown, so check 12 is inside the range over IV 0–31.
  it('Onix Rock Tomb on Turtwig: 12 damage', () => {
    const onix = npcToCalc(ds, ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0].team[1]);
    const hits = [0, 31].map((n) => {
      const t = boxToCalc(ds, { uid: 't', species: 387, level: 14, moves: [], source: 'game', nature: 'Hardy', ivs: iv(n), evs: zero });
      const d = moveDamage(ds, onix, t, 'rocktomb', makeField('singles'))!;
      return [(d.minPct * t.maxHP()) / 100, (d.maxPct * t.maxHP()) / 100];
    });
    const lo = Math.min(...hits.flat());
    const hi = Math.max(...hits.flat());
    expect(12).toBeGreaterThanOrEqual(Math.floor(lo));
    expect(12).toBeLessThanOrEqual(Math.ceil(hi));
  });
});

describe('moves that need sleep (live bug: Snore scored 81 on an awake Snorlax)', () => {
  const box: BoxMon[] = [{ uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 19, moves: ['fairywind', 'snore'], nature: 'Hardy', ivs: iv(20), evs: zero }];
  const withSnore = { ...snap, moves: [...snap.moves, { name: 'Snore', type: 'Normal', category: 'Special' as const, power: 50, accuracy: 100, pp: 15, maxPp: 15, disabled: false }] };
  it('Snore fails while awake', () => {
    const a = adviseTurn(ds, withSnore, box).actions.find((x) => x.label === 'Snore')!;
    expect(a.score).toBe(0);
    expect(a.reason).toMatch(/must be asleep/);
  });
  it('Snore is scored normally while asleep', () => {
    const a = adviseTurn(ds, { ...withSnore, player: { ...withSnore.player!, status: 'slp' } }, box).actions.find((x) => x.label === 'Snore')!;
    expect(a.score).toBeGreaterThan(0);
  });
});
