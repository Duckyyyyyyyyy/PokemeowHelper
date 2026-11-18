import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { ivSummary, movePool, potentialFor, statsAtLevel, targetLevel, versatility, worthGrinding } from '../src/engine/potential';
import { suggestTeam } from '../src/engine/teamSuggest';

const ds = fixture as unknown as Dataset;
const npc = (id: string) => ds.npcs.find((n) => n.id === id)!;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const PERFECT = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (name: string, level: number, moves: string[] = [], extra: Partial<BoxMon> = {}): BoxMon =>
  ({ uid: `${name}-${level}`, species: sp(name), level, moves, source: 'game', ivs: PERFECT, evs: {}, ...extra });

describe('potential: stats at another level', () => {
  const snorlax = mon('Snorlax', 12, ['tackle'], {
    nature: 'Adamant',
    ivs: { hp: 31, atk: 20, def: 10, spa: 0, spd: 31, spe: 5 },
    evs: { hp: 4, atk: 252 },
  });
  it('uses its real IVs, EVs and nature (mainline formula)', () => {
    // HP floor((2·160+31+1)·50/100)+60 = 236; Atk floor((floor(303·0.5)+5)·1.1) = 171; SpA −10% → 63; Spe 37
    expect(statsAtLevel(ds, snorlax, 50)).toEqual({ hp: 236, atk: 171, def: 75, spa: 63, spd: 130, spe: 37 });
    expect(statsAtLevel(ds, snorlax, 100)).toMatchObject({ hp: 462, atk: 338 });
  });
  it('summarizes IVs', () => {
    expect(ivSummary(snorlax)).toMatchObject({ total: 97, grade: 'average' });
    expect(ivSummary(snorlax).text).toContain('low Def/SpA/Spe');
    expect(ivSummary({ ...snorlax, ivs: undefined, source: 'manual' }).grade).toBe('unknown');
  });
});

describe('potential: target level and moves by level', () => {
  it('uses the level cap, else the NPC team top level', () => {
    expect(targetLevel(npc('challenge:koga').variants[0])).toBe(48);
    expect(targetLevel(npc('challenge:brock').variants[1])).toBe(61);
  });
  it('only adds level-up moves it crosses on the way to the target', () => {
    const v = npc('challenge:koga').variants[0]; // cap 48
    const p = potentialFor(ds, mon('Snorlax', 20, ['tackle', 'lick']), v);
    const lv = p.moves.filter((m) => m.source === 'level');
    expect(lv.length).toBeGreaterThan(0);
    for (const m of lv) {
      expect(m.level!).toBeGreaterThan(20); // passed moves (Bite Lv 16) are not free
      expect(m.level!).toBeLessThanOrEqual(48); // Belch Lv 52, Giga Impact Lv 56: not yet
    }
    expect(p.moves.map((m) => m.moveId)).not.toContain('gigaimpact');
    expect(p.moves.map((m) => m.moveId)).not.toContain('bite');
    expect(p.levelsNeeded).toBe(28);
    expect(p.moves.some((m) => m.moveId === 'bodyslam' && m.level === 28 && m.later)).toBe(true);
  });
  it('no TMs unless the bag is known, then only owned ones', () => {
    const v = npc('challenge:koga').variants[0];
    expect(potentialFor(ds, mon('Snorlax', 20, ['tackle']), v).moves.some((m) => m.source === 'tm')).toBe(false);
    const tm = ds.species[sp('Snorlax')].machineMoves.find((id) => ds.moves[id]?.type === 'Ground' && ds.moves[id].power >= 80);
    if (tm) {
      const p = potentialFor(ds, mon('Snorlax', 20, ['tackle']), v, { ownedTms: new Set([tm]) });
      expect(p.moves.filter((m) => m.source === 'tm').every((m) => m.moveId === tm)).toBe(true);
    }
    expect(movePool(ds, mon('Snorlax', 20, ['tackle']), 30)).not.toContain('bite');
  });
});

describe('potential: ranking', () => {
  it('lists a low-level Snorlax over a low-level Rattata, not mons already at the cap', () => {
    const v = npc('challenge:koga').variants[0];
    const box = [mon('Snorlax', 12, ['tackle']), mon('Rattata', 12, ['tackle']), mon('Geodude', 48, ['tackle']), mon('Pidgey', 47, ['tackle']), mon('Snorlax', 10, ['tackle'], { ivs: { ...PERFECT, atk: 0 } })];
    const ready = suggestTeam(ds, box, v, { levelCap: 48, size: 2 });
    const list = worthGrinding(ds, v, ready, { levelCap: 48, size: 2 });
    const names = list.map((r) => ds.species[r.mon.species].name);
    expect(names[0]).toBe('Snorlax');
    expect(list[0].mon.uid).toBe('Snorlax-12'); // best-IV copy only
    expect(names.filter((n) => n === 'Snorlax')).toHaveLength(1);
    expect(list.every((r) => (r.mon.level ?? 0) < 48)).toBe(true);
    expect(list[0].potential).toBeGreaterThan(list[0].current);
    expect(list[0].why).toContain('Lv 48');
    const rat = list.find((r) => r.mon.uid === 'Rattata-12');
    if (rat) expect(rat.potential).toBeLessThan(list[0].potential);
  });
  it('versatility: Snorlax is a good pick against more NPCs than Rattata', () => {
    const a = versatility(ds, mon('Snorlax', 12, ['tackle']), ds.npcs);
    const b = versatility(ds, mon('Rattata', 12, ['tackle']), ds.npcs);
    expect(a.total).toBeGreaterThan(10);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.good).toBeGreaterThanOrEqual(b.good);
  });
});
