// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { readBattle, readBattleBag } from '../src/content/battleReader';
import { adviseTurn } from '../src/engine/turnAdvisor';
import { itemsAllowed, resolveItems } from '../src/engine/itemAdvisor';
import { NORMAL_RULES, TOWER_RULES } from '../src/engine/rules';

const ds = structuredClone(fixture) as unknown as Dataset;
const add = (id: number, name: string, types: string[], b: number[]) => {
  ds.species[id] = { id, name, types, baseStats: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
};
add(546, 'Cottonee', ['Grass', 'Fairy'], [40, 27, 60, 37, 50, 66]);
add(387, 'Turtwig', ['Grass'], [55, 68, 64, 45, 55, 31]);
add(532, 'Timburr', ['Fighting'], [75, 80, 55, 25, 35, 35]);
add(674, 'Pancham', ['Fighting'], [67, 82, 62, 46, 48, 43]);
add(841, 'Flapple', ['Grass', 'Dragon'], [70, 110, 80, 95, 60, 70]);

const read = (f: string) => readFileSync(resolve(__dirname, 'fixtures/battle', f), 'utf8');
document.body.innerHTML = read('brock-turn3.reconstructed.html');
const snap = readBattle(document, 1)!;
const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const box: BoxMon[] = [
  { uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: iv(0) },
];
const hurt = (s: BattleSnapshot, pct = 0.3): BattleSnapshot => ({ ...s, player: { ...s.player!, hp: Math.round(s.player!.maxHp! * pct) } });
const items = (a: ReturnType<typeof adviseTurn>) => a.actions.filter((x) => x.kind === 'item');
const withPp = (s: BattleSnapshot, pp: Record<string, number>): BattleSnapshot => ({
  ...s, moves: s.moves.map((m) => (m.name in pp ? { ...m, pp: pp[m.name], disabled: pp[m.name] === 0 } : m)),
});

describe('battle Items panel reader', () => {
  it('reads names, counts and the locked flag, skipping filters and page buttons', () => {
    document.body.innerHTML = read('battle-items-panel.reconstructed.html');
    const bag = readBattleBag(document)!;
    expect(bag.map((b) => [b.id, b.count, !!b.locked])).toEqual([
      ['potion', 7, false], ['superpotion', 12, false], ['revive', 3, true], ['ether', 2, false], ['oranberry', 20, false],
    ]);
  });
  it('is undefined when the Items tab is not shown, and part of readBattle when it is', () => {
    expect(snap.bag).toBeUndefined();
    document.body.innerHTML = read('brock-turn3.reconstructed.html').replace('<div class="battle-team-bag-panel">', read('battle-items-panel.reconstructed.html') + '<div class="battle-team-bag-panel">');
    expect(readBattle(document, 1)!.bag).toHaveLength(5);
  });
});

describe('count priority and rules', () => {
  it('battle counts beat the Bag read; unlisted items fall back to it', () => {
    const s = resolveItems({ ...snap, bag: [{ id: 'potion', name: 'Potion', count: 2 }, { id: 'revive', name: 'Revive', count: 1, locked: true }] }, new Map([['potion', 9], ['fullheal', 4]]));
    expect(s.counts.get('potion')).toBe(2);
    expect(s.counts.get('fullheal')).toBe(4);
    expect(s.locked.has('revive')).toBe(true);
    expect(s.source).toBe('mixed');
  });
  it('advice uses the battle count and works with no Bag read at all', () => {
    const s = { ...hurt(snap), bag: [{ id: 'potion', name: 'Potion', count: 2 }] };
    expect(items(adviseTurn(ds, s, box, { items: new Map([['potion', 9]]) }))[0].reason).toMatch(/\(2 in battle bag\)/);
    expect(items(adviseTurn(ds, s, box))[0].label).toMatch(/Potion on Cottonee/);
  });
  it('a locked item is not suggested', () => {
    const s = { ...hurt(snap), bag: [{ id: 'potion', name: 'Potion', count: 2, locked: true }] };
    expect(items(adviseTurn(ds, s, box))).toEqual([]);
  });
  it('no medicine in Battle Towers or Player Battles', () => {
    expect(itemsAllowed(snap, TOWER_RULES)).toBe(false);
    expect(itemsAllowed({ ...snap, kind: 'player' }, NORMAL_RULES)).toBe(false);
    expect(itemsAllowed(snap, NORMAL_RULES)).toBe(true);
    const a = adviseTurn(ds, { ...hurt(snap), kind: 'player' }, box, { items: new Map([['potion', 5]]) });
    expect(items(a)).toEqual([]);
  });
});

describe('berries vs potions', () => {
  it('prefers a potion when both are owned', () => {
    const a = items(adviseTurn(ds, hurt(snap), box, { items: new Map([['potion', 3], ['oranberry', 9]]) }));
    expect(a.map((x) => x.label)).toEqual(['Potion on Cottonee']);
  });
  it('falls back to a berry when no potion is left, and says it is spent', () => {
    const a = items(adviseTurn(ds, hurt(snap), box, { items: new Map([['sitrusberry', 2]]) }));
    expect(a[0].label).toBe('Sitrus Berry on Cottonee');
    expect(a[0].reason).toMatch(/No potion left.*spent for good/);
  });
  it('does not suggest the berry the Pokémon already holds', () => {
    const h = hurt(snap);
    const held = { ...h, player: { ...h.player!, item: 'Oran Berry' } };
    expect(items(adviseTurn(ds, held, box, { items: new Map([['oranberry', 4]]) }))).toEqual([]);
  });
  it('status: a specific cure before Full Heal before berries; Lum is the last resort', () => {
    const par = { ...snap, player: { ...snap.player!, status: 'par' } };
    const pick = (m: [string, number][]) => items(adviseTurn(ds, par, box, { items: new Map(m) }))[0]?.label;
    expect(pick([['lumberry', 1], ['fullheal', 1], ['paralyzeheal', 1]])).toBe('Paralyze Heal on Cottonee');
    expect(pick([['lumberry', 1], ['fullheal', 1]])).toBe('Full Heal on Cottonee');
    expect(pick([['lumberry', 1], ['cheriberry', 1]])).toBe('Cheri Berry on Cottonee');
    expect(items(adviseTurn(ds, par, box, { items: new Map([['lumberry', 1]]) }))[0].reason).toMatch(/Lum cures any status/);
  });
});

describe('PP restore (Ether / Elixir)', () => {
  const owned = new Map([['ether', 2], ['maxelixir', 1]]);
  it('no trigger when PP is fine, or another move does the same job', () => {
    expect(items(adviseTurn(ds, snap, box, { items: owned }))).toEqual([]);
    // Razor Leaf is out but Mega Drain is nearly as good against Onix.
    expect(items(adviseTurn(ds, withPp(snap, { 'Razor Leaf': 0 }), box, { items: owned }))).toEqual([]);
  });
  it('triggers when the only answers (both Grass moves) are out of PP', () => {
    const a = items(adviseTurn(ds, withPp(snap, { 'Razor Leaf': 0, 'Mega Drain': 0 }), box, { items: owned }));
    expect(a).toHaveLength(1);
    expect(a[0].label).toMatch(/^(Max Elixir|Ether)/);
    expect(a[0].reason).toMatch(/Out of PP/);
    expect(a[0].score).not.toBeNull();
  });
  it('a key move at 1–2 PP ranks below attacking, and needs the item in the bag', () => {
    const s = withPp(snap, { 'Razor Leaf': 1, 'Mega Drain': 2 });
    const a = adviseTurn(ds, s, box, { items: new Map([['ether', 1]]) });
    const ether = items(a)[0];
    expect(ether.label).toMatch(/^Ether/);
    expect(ether.reason).toMatch(/can wait/);
    expect(ether.score!).toBeLessThan(a.actions.find((x) => x.label === 'Razor Leaf')!.score!);
    expect(items(adviseTurn(ds, s, box, { items: new Map([['potion', 1]]) }))).toEqual([]);
  });
});
