import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import { assignHeldItems, suggestHeldItems } from '../src/engine/heldItems';
import { boxToCalc, duel, makeField, npcToCalc } from '../src/engine/damage';
import { CHALLENGE_RULES } from '../src/engine/rules';

const ds = structuredClone(fixture) as unknown as Dataset;
const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const sid = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (name: string, level: number, moves: string[], uid = name): BoxMon => ({ uid, source: 'game', species: sid(name), level, moves, nature: 'Hardy', ivs: iv(20), evs: iv(0) });
const brock = ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0];
// A sample bag (items like the ones seen on the Bag page).
const owned = new Map([['grassgem', 1], ['electricgem', 4], ['hardstone', 1], ['widelens', 1], ['salacberry', 1], ['leftovers', 0], ['figyberry', 2], ['spelltag', 1]].filter(([, n]) => (n as number) > 0) as [string, number][]);

describe('held item advice', () => {
  const bulba = mon('Bulbasaur', 12, ['vinewhip', 'tackle']); // needs 2+ hits on Onix: items matter

  it('a Grass Gem helps a Grass attacker vs Brock; items for types it cannot use are not tried', () => {
    const tips = suggestHeldItems(ds, bulba, brock, owned, { levelCap: brock.levelCap, rules: CHALLENGE_RULES });
    const gem = tips.find((t) => t.itemId === 'grassgem');
    expect(gem?.calc).toBe(true);
    expect(gem!.value).toBeGreaterThan(0);
    expect(tips.some((t) => t.itemId === 'electricgem' || t.itemId === 'spelltag')).toBe(false);
    expect(tips.some((t) => t.itemId === 'leftovers')).toBe(false); // not owned
  });

  it('a Gem only boosts the first hit in the 1v1', () => {
    const field = makeField('singles');
    const foe = npcToCalc(ds, brock.team[1]);
    const plain = duel(ds, boxToCalc(ds, bulba), bulba.moves, foe, brock.team[1].moves, field);
    const gem = duel(ds, boxToCalc(ds, { ...bulba, item: 'Grass Gem' }), bulba.moves, foe, brock.team[1].moves, field);
    const band = duel(ds, boxToCalc(ds, { ...bulba, item: 'Miracle Seed' }), bulba.moves, foe, brock.team[1].moves, field);
    expect(gem.score).toBeGreaterThanOrEqual(plain.score);
    expect(gem.mine!.maxPct).toBeGreaterThan(plain.mine!.maxPct);
    expect(gem.score).toBeLessThanOrEqual(band.score); // same damage per hit here (38 HP), but the Gem works once
  });

  it('only suggests a swap that beats the item it already holds', () => {
    const holding = suggestHeldItems(ds, { ...bulba, item: 'Miracle Seed' }, brock, owned, { levelCap: brock.levelCap });
    expect(holding.some((t) => t.itemId === 'grassgem')).toBe(false); // Miracle Seed is better here
    expect(holding.every((t) => t.value >= 4)).toBe(true);
  });

  it('gives each Pokémon one item and never more copies than you own', () => {
    const a = suggestHeldItems(ds, bulba, brock, owned, { levelCap: brock.levelCap });
    const b = suggestHeldItems(ds, mon('Bulbasaur', 12, ['vinewhip'], 'b2'), brock, owned, { levelCap: brock.levelCap });
    const pick = assignHeldItems([{ uid: 'Bulbasaur', tips: a }, { uid: 'b2', tips: b }], owned);
    expect(pick.size).toBe(2);
    expect([...pick.values()].filter((t) => t.itemId === 'grassgem').length).toBeLessThanOrEqual(1);
  });
});
