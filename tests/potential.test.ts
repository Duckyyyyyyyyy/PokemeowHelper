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
    // Koga's team is Poison: a Ground TM is the best coverage Snorlax can get.
    const tm = ds.species[sp('Snorlax')].machineMoves.find((id) => ds.moves[id]?.type === 'Ground' && ds.moves[id].power >= 80)!;
    expect(tm).toBeTruthy();
    const p = potentialFor(ds, mon('Snorlax', 20, ['tackle']), v, { ownedTms: new Set([tm]) });
    const tmMoves = p.moves.filter((m) => m.source === 'tm');
    expect(tmMoves.length).toBeGreaterThan(0);
    expect(tmMoves.every((m) => m.moveId === tm)).toBe(true);
    expect(movePool(ds, mon('Snorlax', 20, ['tackle']), 30)).not.toContain('bite');
  });
});

describe('potential: ranking', () => {
  const KOGA = () => npc('challenge:koga').variants[0]; // cap 48, all Poison
  const lowBox = () => ['Snorlax', 'Slowbro', 'Pikachu', 'Charizard', 'Rattata', 'Caterpie', 'Geodude', 'Squirtle', 'Pidgey', 'Abra', 'Machop', 'Onix']
    .map((n) => mon(n, 12, ['tackle']));
  const names = (rs: { mon: BoxMon }[]) => rs.map((r) => ds.species[r.mon.species].name);

  it('picks a team of 6: one per species, best-IV copy, never at/over the target level', () => {
    const v = KOGA();
    const box = [...lowBox(), mon('Geodude', 48, ['tackle']), mon('Snorlax', 10, ['tackle'], { ivs: { ...PERFECT, atk: 0 } })];
    const ready = suggestTeam(ds, box, v, { levelCap: 48 });
    const g = worthGrinding(ds, v, ready, { levelCap: 48 });
    expect(g.team).toHaveLength(6);
    expect(new Set(names(g.team)).size).toBe(6);
    expect(g.team.find((r) => ds.species[r.mon.species].name === 'Snorlax')?.mon.uid).toBe('Snorlax-12');
    expect([...g.team, ...g.more].every((r) => (r.mon.level ?? 0) < 48)).toBe(true);
    expect(g.more.length).toBeGreaterThan(0);
    expect(g.more.length).toBeLessThanOrEqual(5);
    expect(g.more.some((r) => g.team.includes(r))).toBe(false);
    const snorlax = g.team.find((r) => r.mon.uid === 'Snorlax-12')!;
    expect(snorlax.potential).toBeGreaterThan(snorlax.current);
    expect(snorlax.why).toContain('Lv 48');
    expect(potentialFor(ds, mon('Rattata', 12, ['tackle']), v).potential).toBeLessThan(snorlax.potential);
  });
  it('picks in coverage order: best potential first, then the biggest gain vs unanswered NPC Pokémon', () => {
    const v = KOGA();
    const ready = suggestTeam(ds, lowBox(), v, { levelCap: 48 });
    const g = worthGrinding(ds, v, ready, { levelCap: 48, more: 20 });
    const all = [...g.team, ...g.more];
    const first = g.team[0];
    expect(all.filter((r) => r.filler === first.filler).every((r) => r.potential <= first.potential)).toBe(true);
    const bestPer = v.team.map(() => 0);
    g.team.forEach((pick, i) => {
      const gain = (r: typeof pick) => r.pairs.reduce((s, p, j) => s + Math.max(0, p.score - bestPer[j]), 0);
      if (i > 0) {
        const rivals = [...g.team.slice(i + 1), ...g.more].filter((r) => r.filler === pick.filler);
        if (gain(pick) >= 1) for (const r of rivals) expect(gain(pick)).toBeGreaterThanOrEqual(gain(r));
      }
      pick.pairs.forEach((p, j) => (bestPer[j] = Math.max(bestPer[j], p.score)));
    });
  });
  it('fills empty slots with marked fillers and says why', () => {
    const v = KOGA();
    // A strong ready-now team at the cap: few low-level Pokémon clearly beat it.
    const strong = ['Geodude', 'Golem', 'Rhydon', 'Dugtrio', 'Alakazam', 'Nidoking'].map((n) => mon(n, 48, ['earthquake', 'psychic', 'rockslide']));
    const low = ['Caterpie', 'Rattata', 'Pidgey', 'Spearow', 'Weedle', 'Zubat', 'Snorlax'].map((n) => mon(n, 12, ['tackle']));
    const ready = suggestTeam(ds, [...strong, ...low], v, { levelCap: 48 });
    const g = worthGrinding(ds, v, ready, { levelCap: 48 });
    expect(g.team).toHaveLength(6);
    const fillers = g.team.filter((r) => r.filler);
    expect(fillers.length).toBeGreaterThan(0);
    expect(fillers.every((r) => r.why.startsWith('Filler – weak vs this NPC'))).toBe(true);
    // Non-fillers come first.
    expect(g.team.findIndex((r) => r.filler)).toBe(g.team.length - fillers.length);
    expect(g.note).toMatch(/filler/);
  });
  it('a small box gives a short team with a reason', () => {
    const v = KOGA();
    const box = [mon('Snorlax', 12, ['tackle']), mon('Pikachu', 15, ['thundershock']), mon('Caterpie', 5, ['tackle']), mon('Geodude', 48, ['tackle'])];
    const g = worthGrinding(ds, v, suggestTeam(ds, box, v, { levelCap: 48 }), { levelCap: 48 });
    expect(g.team).toHaveLength(3);
    expect(g.more).toHaveLength(0);
    expect(g.note).toMatch(/Only 3 of your Pokémon are below Lv 48/);
  });
  it('a low-stat type answer survives the shortlist on a big box', () => {
    const v = npc('challenge:blaine').variants[0]; // all Fire, cap 52
    // 40+ strong species with no Water/Ground/Rock typing, plus one low-stat Squirtle.
    const strong = Object.values(ds.species).filter((s) => !/Mega|max/.test(s.name) && !s.types.some((t) => ['Water', 'Ground', 'Rock'].includes(t)))
      .filter((s) => Object.values(s.baseStats).reduce((a, b) => a + b, 0) >= 420);
    expect(strong.length).toBeGreaterThan(40);
    const big = [...strong.map((s) => ({ uid: String(s.id), species: s.id, level: 10, moves: ['tackle'], source: 'game' as const, ivs: PERFECT, evs: {} })), mon('Squirtle', 10, ['tackle'])];
    const ready = suggestTeam(ds, [...big, mon('Pidgey', 50, ['wingattack'])], v, { levelCap: 52 });
    const g = worthGrinding(ds, v, ready, { levelCap: 52, more: 40 });
    expect(names([...g.team, ...g.more])).toContain('Squirtle'); // BST 314: only the type half of the shortlist keeps it
  });
  it('versatility leaves out recharge moves', () => {
    expect(movePool(ds, mon('Snorlax', 12, ['tackle']), 100)).not.toContain('gigaimpact');
  });
  it('versatility: Snorlax is a good pick against more NPCs than Rattata', () => {
    const a = versatility(ds, mon('Snorlax', 12, ['tackle']), ds.npcs);
    const b = versatility(ds, mon('Rattata', 12, ['tackle']), ds.npcs);
    expect(a.total).toBeGreaterThan(10);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.good).toBeGreaterThanOrEqual(b.good);
  });
});

describe('potential: evolution', () => {
  const evo = structuredClone(ds);
  const [c1, c2, c3] = [sp('Charmander'), sp('Charmeleon'), sp('Charizard')];
  evo.species[c1].evolvesTo = [{ to: c2, methods: ['Level 16 or higher'], level: 16 }];
  evo.species[c2].evolvesTo = [{ to: c3, methods: ['Level 36 or higher'], level: 36 }];
  const eevee = sp('Eevee');
  evo.species[eevee].evolvesTo = [{ to: sp('Vaporeon'), methods: ['Use Water Stone'] }];
  const v = npc('challenge:koga').variants[0]; // cap 48

  it('scores the evolved form when its level is reached by the target level', () => {
    const p = potentialFor(evo, mon('Charmander', 10, ['scratch']), v);
    expect(p.evolvedTo).toBe(c3);
    const same = potentialFor(ds, mon('Charmander', 10, ['scratch']), v);
    expect(same.evolvedTo).toBeUndefined();
    expect(p.potential).not.toBe(same.potential);
  });
  it('stops at the form it can reach (cap below the second evolution)', () => {
    const low = { ...v, levelCap: 30 };
    expect(potentialFor(evo, mon('Charmander', 10, ['scratch']), low).evolvedTo).toBe(c2);
  });
  it('does not auto-apply stone evolutions', () => {
    expect(potentialFor(evo, mon('Eevee', 10, ['tackle']), v).evolvedTo).toBeUndefined();
  });
});
