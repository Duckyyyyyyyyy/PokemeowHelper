import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import { GHOST_MAX, farmGroups, foeSpeeds, goalTeams, hitsTaken, scoreGoal, speedLadder, trainRow } from '../src/engine/evRoles';
import { debrief } from '../src/engine/debrief';
import { sessionRoutes } from '../src/engine/route';
import { statsAtLevel } from '../src/engine/potential';

const base = fixture as unknown as Dataset;
const sp = (name: string) => Object.values(base.species).find((s) => s.name === name)!.id;
const PERFECT = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (name: string, level: number, o: Partial<BoxMon> = {}): BoxMon =>
  ({ uid: `${name}-${level}`, species: sp(name), level, moves: [], source: 'game', ivs: PERFECT, evs: {}, ...o });
const y = (p: Partial<StatTable>): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...p });
const npc = (id: string) => base.npcs.find((n) => n.id === id)!;

describe('hits taken', () => {
  it('more HP EVs take a smaller share of HP from the same hit', () => {
    const v = npc('challenge:brock').variants[1];
    const m = mon('Arcanine', 60, { moves: ['flareblitz'] });
    const thin = hitsTaken(base, m, y({}), 60, v);
    const bulky = hitsTaken(base, m, y({ hp: 252, def: 252 }), 60, v);
    expect(thin).toHaveLength(v.team.length);
    expect(bulky[0].maxPct).toBeLessThan(thin[0].maxPct);
    expect(thin[0].move).not.toBe('—');
  });
});

describe('goal scoring', () => {
  it('rematch teams are the Rematch variants of Gyms / Elite Four / Champions', () => {
    const t = goalTeams(base, 'rematch');
    expect(t.length).toBeGreaterThan(5);
    expect(t.every(({ npc: n, v }) => ['gym', 'elite-four', 'champion'].includes(n.category) && /rematch/i.test(v.label))).toBe(true);
    expect(goalTeams(base, 'rival').every(({ npc: n }) => n.category === 'rival')).toBe(true);
  });
  it('scores EVs now and every role over the same teams', () => {
    const r = scoreGoal(base, mon('Arcanine', 70, { moves: ['flareblitz', 'extremespeed'] }), 'rival');
    expect(r.teams).toBe(goalTeams(base, 'rival').length);
    expect(r.roles).toHaveLength(4);
    expect(new Set([r.now.total, ...r.roles.map((x) => x.total)]).size).toBe(1);
    expect(r.roles[0].wins).toBeGreaterThanOrEqual(r.roles[3].wins);
  });
  it('skips teams whose level cap it is over', () => {
    const ds = structuredClone(base);
    ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[1].levelCap = 60;
    const all = goalTeams(ds, 'rematch').length;
    expect(scoreGoal(ds, mon('Arcanine', 70, { moves: ['flareblitz'] }), 'rematch').teams).toBe(all - 1);
    expect(scoreGoal(ds, mon('Arcanine', 60, { moves: ['flareblitz'] }), 'rematch').teams).toBe(all);
  });
});

describe('speed ladder', () => {
  const v = npc('challenge:kanto-agatha').variants[0];
  it('lists both teams by Speed, fastest first', () => {
    const r = speedLadder(base, [mon('Arcanine', 50, { nature: 'Jolly' })], v);
    expect(r.filter((x) => x.side === 'foe')).toHaveLength(v.team.length);
    expect(r.map((x) => x.spe)).toEqual([...r.map((x) => x.spe)].sort((a, b) => b - a));
  });
  it('a ghost rung passes the next faster foe with at most GHOST_MAX more Spe EVs', () => {
    const m = mon('Arcanine', 50, { nature: 'Jolly' });
    const r = speedLadder(base, [m], v);
    const mine = r.find((x) => x.side === 'me')!;
    const next = foeSpeeds(base, v).filter((f) => f.spe >= mine.spe).sort((a, b) => a.spe - b.spe)[0];
    const ghost = r.find((x) => x.side === 'ghost');
    expect(ghost).toBeDefined();
    const n = Number(/\+(\d+) Spe/.exec(ghost!.name)![1]);
    expect(n).toBeLessThanOrEqual(GHOST_MAX);
    expect(ghost!.spe).toBeGreaterThan(next.spe);
    expect(statsAtLevel(base, { ...m, evs: { spe: n - 4 } }, 63).spe).toBeLessThanOrEqual(next.spe);
  });
});

describe('farm groups', () => {
  it('groups what can grind now by stat, biggest total first; skips done, later and unknown', () => {
    const rows = [
      mon('Arcanine', 50, { moves: ['flareblitz'], evs: { atk: 40, spe: 24 } }),
      mon('Alakazam', 80, { moves: ['psychic'], evs: { spa: 252, spe: 200 } }),
      mon('Pikachu', 14, { moves: ['thunderbolt'], evs: {} }),
      mon('Lapras', 40, { evs: undefined, source: 'manual' }),
    ].map((m) => trainRow(base, m, 'fast', {}));
    const g = farmGroups(rows);
    expect(g.map((x) => x.stat)).toEqual(['spe', 'atk']);
    expect(g[0].total).toBe(228 + 52);
    expect(g[0].who.map((w) => w.need)).toEqual([228, 52]);
  });
});

describe('battle debrief', () => {
  const snap = (events: BattleSnapshot['events']): BattleSnapshot => ({
    v: 2, at: 0, status: 'lost', opponentName: 'Test', turn: 2, moves: [],
    bench: [{ name: 'Arcanine', level: 50, active: false, fainted: true }],
    opponentTeam: [{ name: 'Electrode', level: 40, active: true, fainted: false }],
    boosts: { player: {}, opponent: {} }, log: [], events,
  });
  const box = [mon('Arcanine', 50, { evs: {} })];
  const t1 = [
    { idx: 0, turn: 1, side: 'player' as const, mon: 'Arcanine', move: 'Flamethrower', target: 'Electrode', damage: 40, stages: { attacker: {}, target: {} } },
    { idx: 1, turn: 1, side: 'opponent' as const, mon: 'Electrode', move: 'Thunderbolt', target: 'Arcanine', damage: 50, stages: { attacker: {}, target: {} } },
  ];
  it('KO before it could move: the Spe EVs that would have moved first', () => {
    const d = debrief(base, snap([...t1, { idx: 2, turn: 2, side: 'opponent', mon: 'Electrode', move: 'Thunderbolt', target: 'Arcanine', damage: 60, targetFainted: true, stages: { attacker: {}, target: {} } }] as BattleSnapshot['events']), box);
    expect(d.kos).toHaveLength(1);
    expect(d.outsped).toHaveLength(1);
    const o = d.outsped[0];
    expect(o.uid).toBe(box[0].uid);
    expect(o.mySpe).toBeLessThanOrEqual(o.foeSpe!);
    expect(statsAtLevel(base, { ...box[0], evs: { spe: o.needEvs! } }, 50).spe).toBeGreaterThan(o.foeSpe!);
    expect(statsAtLevel(base, { ...box[0], evs: { spe: o.needEvs! - 4 } }, 50).spe).toBeLessThanOrEqual(o.foeSpe!);
  });
  it('not outsped when it moved first that turn, or the KO move had priority', () => {
    const movedFirst = debrief(base, snap([...t1,
      { idx: 2, turn: 2, side: 'player', mon: 'Arcanine', move: 'Flamethrower', target: 'Electrode', damage: 10, stages: { attacker: {}, target: {} } },
      { idx: 3, turn: 2, side: 'opponent', mon: 'Electrode', move: 'Thunderbolt', target: 'Arcanine', damage: 60, targetFainted: true, stages: { attacker: {}, target: {} } }] as BattleSnapshot['events']), box);
    expect(movedFirst.outsped).toHaveLength(0);
    const prio = debrief(base, snap([...t1, { idx: 2, turn: 2, side: 'opponent', mon: 'Electrode', move: 'Quick Attack', target: 'Arcanine', damage: 60, targetFainted: true, stages: { attacker: {}, target: {} } }] as BattleSnapshot['events']), box);
    expect(prio.outsped).toHaveLength(0);
  });
});

describe('session route', () => {
  const ds = structuredClone(base);
  ds.species[sp('Zubat')].evYield = y({ spe: 1 });
  ds.species[sp('Geodude')].evYield = y({ def: 1 });
  const enc = (name: string, levels: [number, number]) => ({ species: sp(name), rarity: 'common', method: 'walking', levels, day: 0.3, night: 0.3, labels: [], sections: [] });
  ds.wild = { moonStone: [], maps: [
    { id: 'caves', name: 'Caves', theme: 'rock', levels: [20, 30], description: '', encounters: [enc('Zubat', [20, 25]), enc('Geodude', [20, 25])] },
    { id: 'meadow', name: 'Meadow', theme: 'grass', levels: [40, 50], description: '', encounters: [enc('Pikachu', [40, 45]), enc('Zubat', [40, 45])] },
    { id: 'peak', name: 'Peak', theme: 'rock', levels: [60, 70], description: '', encounters: [enc('Pikachu', [60, 65])] },
  ] } as unknown as Dataset['wild'];
  it('ranks maps by goals served (catch, EVs, EXP) and leaves out locked ones', () => {
    const r = sessionRoutes(ds, { hunt: new Set([sp('Pikachu')]), needs: new Map([['spe', 100]]), teamLevel: 50, access: (id) => (id === 'peak' ? 'locked' : 'open') });
    expect(r.map((s) => s.map.id)).toEqual(['meadow', 'caves']);
    expect(r[0]).toMatchObject({ goals: 3, exp: true });
    expect(r[0].evs).toEqual([expect.objectContaining({ name: 'Zubat', stat: 'spe', amount: 1 })]);
    expect(r[1]).toMatchObject({ goals: 1, exp: false });
  });
});
