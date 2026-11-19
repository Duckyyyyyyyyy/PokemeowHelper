// Live reports after 0.11.0:
//  1. Team tab picked Night Shade for everyone and gave Metagross "Wins 0/6 · No damaging move".
//  2. vs Siebold, after Ampharos fainted: "Switch to Toxtricity – takes ~0%", though Gyarados has Earthquake.
//  Both: the wiki gives these sets nature "random" (seen in the NPC tab), which @smogon/calc does not
//  know; it then throws on every normal hit, and only fixed damage (Night Shade) survived.
//  3. Lance's two Lv 54 Dragonair share one battle record: Dragon Rage showed as "not in wiki" on
//  the twin that does not have it.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, Npc, NpcMon } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { adviseTurn, foeSet, indexes } from '../src/engine/turnAdvisor';
import { suggestTeam } from '../src/engine/teamSuggest';
import { npcKey, obsKey, seenFor, type ObservedStore } from '../src/engine/observed';

const ds = structuredClone(fixture) as unknown as Dataset;
const add = (id: number, name: string, types: string[], b: number[], levelMoves: [string, number][] = []) => {
  ds.species[id] = { id, name, types, baseStats: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] }, abilities: [], levelMoves, machineMoves: [], eggMoves: [] };
};
add(376, 'Metagross', ['Steel', 'Psychic'], [80, 135, 130, 95, 90, 70]);
add(608, 'Lampent', ['Ghost', 'Fire'], [60, 40, 60, 95, 60, 55]);
add(711, 'Gourgeist', ['Ghost', 'Grass'], [65, 90, 122, 58, 75, 84]);
add(849, 'Toxtricity', ['Electric', 'Poison'], [75, 98, 70, 114, 70, 75]);
add(319, 'Sharpedo', ['Water', 'Dark'], [70, 120, 40, 95, 40, 95]);
add(181, 'Ampharos', ['Electric'], [90, 75, 85, 115, 90, 55]);

const iv = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const ev0 = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const npcMon = (species: number, level: number, moves: string[], extra: Partial<NpcMon> = {}): NpcMon => ({
  species, name: ds.species[species].name, level, moves, nature: 'random', item: null, baseStats: ds.species[species].baseStats, ivs: iv, evs: ev0, ...extra,
});
const lorelei = ds.npcs.find((n) => n.id === 'challenge:kanto-lorelei')!;
const npcWith = (id: string, name: string, team: NpcMon[]): Npc => ({
  ...structuredClone(lorelei), id, name, levelCap: 70, variants: [{ ...structuredClone(lorelei.variants[0]), levelCap: 70, team }],
});
const mine = (species: number, level: number, moves: string[], uid: string): BoxMon => ({ uid, gameId: uid, source: 'game', species, level, moves, nature: 'Hardy', ivs: iv, evs: ev0 });

describe('nature "random" (wiki): Team tab', () => {
  const gourgeistNpc = npcWith('challenge:test-gourgeist', 'Ghosty', [npcMon(711, 63, ['seedbomb', 'shadowsneak'])]);
  const local = { ...ds, npcs: [...ds.npcs, gourgeistNpc] } as Dataset;

  it('real attacks are scored: Lampent picks Flamethrower over Night Shade, Metagross wins', () => {
    const lampent = mine(608, 64, ['nightshade', 'flamethrower'], 'lamp');
    const meta = mine(376, 70, ['meteormash', 'zenheadbutt', 'shadowclaw'], 'meta');
    const res = suggestTeam(local, [lampent, meta], gourgeistNpc.variants[0]);
    const lamp = res.ranked.find((c) => c.mon.uid === 'lamp')!;
    expect(lamp.pairs[0].duel?.mine?.moveId).toBe('flamethrower');
    const m = res.ranked.find((c) => c.mon.uid === 'meta')!;
    expect(m.pairs[0].duel?.mine?.maxPct ?? 0).toBeGreaterThan(0);
  });
});

describe('nature "random" (wiki): forced switch vs Siebold-like Gyarados', () => {
  const siebold = npcWith('challenge:test-siebold', 'Siebold', [npcMon(130, 63, ['waterfall', 'icefang', 'earthquake', 'dragondance'])]);
  const local = { ...ds, npcs: [...ds.npcs, siebold] } as Dataset;
  const box = [mine(181, 63, ['discharge'], 'amph'), mine(849, 59, ['discharge', 'sludgebomb'], 'tox'), mine(319, 68, ['crunch', 'aquajet'], 'sharp')];
  const snap: BattleSnapshot = {
    v: 2, at: 1, status: 'active', kind: 'elite-four', opponentName: 'Siebold', turn: 3,
    player: { name: 'Ampharos', level: 63, hp: 0, maxHp: 197 }, opponent: { name: 'Gyarados', level: 63, hp: 206, maxHp: 206 },
    moves: [], forcedSwitch: true,
    bench: [
      { name: 'Ampharos', level: 63, hp: 0, maxHp: 197, active: true, fainted: true },
      { name: 'Toxtricity', level: 59, hp: 175, maxHp: 175, active: false, fainted: false },
      { name: 'Sharpedo', level: 68, hp: 196, maxHp: 196, active: false, fainted: false },
    ],
    opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [], events: [],
  };

  it('Toxtricity shows Earthquake damage when switching in, not ~0%', () => {
    const a = adviseTurn(local, snap, box);
    expect(a.forcedSwitch).toBe(true);
    const tox = a.actions.find((x) => /Toxtricity/.test(x.label))!;
    expect(tox.reason).not.toMatch(/Takes ~0%/);
    expect(tox.reason).not.toMatch(/no known damaging move/);
    expect(tox.threat?.name).toBe('Earthquake');
    expect(tox.threat!.maxPct).toBeGreaterThan(50);
    expect(a.calcErrors).toBeUndefined();
  });
});

describe('twins: Lance (wiki data) has two Lv 54 Dragonair sharing one battle record', () => {
  const lance = ds.npcs.find((n) => n.id === 'challenge:kanto-lance')!;
  const variant = lance.variants[0];
  const [d1, d2] = variant.team.filter((m) => m.name === 'Dragonair');
  const idx = indexes(ds);

  it('the fixture is the team from the report (Dragon Rage on one, Thunder Wave on the other)', () => {
    expect(d1.moves).toContain('dragonrage');
    expect(d2.moves).toContain('thunderwave');
    expect(d2.moves).not.toContain('dragonrage');
  });

  it('seenFor: a move goes to the twin whose wiki set has it; a move neither has stays on both', () => {
    const seen = ['dragonrage', 'thunderwave', 'twister'];
    expect(seenFor(seen, d1, variant.team)).toEqual(['dragonrage', 'twister']);
    expect(seenFor(seen, d2, variant.team)).toEqual(['thunderwave', 'twister']);
    const gyarados = variant.team[0];
    expect(seenFor(['dragonrage'], gyarados, variant.team)).toEqual(['dragonrage']); // not a twin
    // NPC tab (records merged by name over levels).
    const d3 = { ...d2, level: 52 };
    expect(seenFor(['dragonrage'], d3, [d1, d3], true)).toEqual([]);
    expect(seenFor(['dragonrage'], d3, [d1, d3])).toEqual(['dragonrage']);
  });

  const roster = (active: 0 | 1) => [
    { name: 'Gyarados', level: 56, active: false, fainted: true },
    { name: 'Dragonair', level: 54, active: active === 0, fainted: active === 1 },
    { name: 'Dragonair', level: 54, active: active === 1, fainted: false },
    { name: 'Aerodactyl', level: 58, active: false, fainted: false },
    { name: 'Dragonite', level: 60, active: false, fainted: false },
  ];

  it('foeSet picks the twin by the active roster row, else by the moves it used', () => {
    const b = { name: 'Dragonair', level: 54 };
    expect(foeSet(ds, idx, variant, b, { roster: roster(0) })!.mon.moves).toContain('dragonrage');
    expect(foeSet(ds, idx, variant, b, { roster: roster(1) })!.mon.moves).toContain('thunderwave');
    expect(foeSet(ds, idx, variant, b, { used: ['thunderwave'] })!.mon.moves).toContain('thunderwave');
    expect(foeSet(ds, idx, variant, b)!.mon.moves).toContain('dragonrage'); // no clue: the first
  });

  it('Battle tab: the other twin\'s Dragon Rage is not flagged "not in the wiki set" on the Thunder Wave Dragonair', () => {
    const snap: BattleSnapshot = {
      v: 2, at: 1, status: 'active', kind: 'elite-four', opponentName: 'Lance', turn: 4,
      player: { name: 'Gyarados', level: 60, hp: 180, maxHp: 180 }, opponent: { name: 'Dragonair', level: 54, hp: 146, maxHp: 146 },
      moves: [{ name: 'Waterfall', pp: 15, maxPp: 15, disabled: false }],
      bench: [{ name: 'Gyarados', level: 60, hp: 180, maxHp: 180, active: true, fainted: false }],
      opponentTeam: roster(1), boosts: { player: {}, opponent: {} }, log: [], events: [],
    };
    const store: ObservedStore = { [obsKey(npcKey({ npc: lance, variant }, snap), 'Dragonair', 54)]: { name: 'Dragonair', level: 54, moves: ['dragonrage'], lastSeen: 1 } };
    const a = adviseTurn(ds, snap, [mine(130, 60, ['waterfall'], 'gy')], { observed: store, lookahead: 0 });
    expect(a.npc?.id).toBe('challenge:kanto-lance');
    expect(a.foe?.mon.moves).toContain('thunderwave');
    expect(a.notes.some((n) => /Dragon Rage, which is not in the wiki set/.test(n))).toBe(false);
    expect(a.seenBefore ?? []).not.toContain('dragonrage');
    // The other twin (Dragon Rage one) active: the record is its own.
    const a1 = adviseTurn(ds, { ...snap, opponentTeam: roster(0) }, [mine(130, 60, ['waterfall'], 'gy')], { observed: store, lookahead: 0 });
    expect(a1.foe?.mon.moves).toContain('dragonrage');
    expect(a1.seenBefore).toContain('dragonrage');
  });
});
