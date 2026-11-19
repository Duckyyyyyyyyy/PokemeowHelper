import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { Dataset } from '../src/shared/types';
import type { BattleMon, BattleSnapshot } from '../src/shared/battle';
import { adviseDoubles, synergy, type DoublesAction } from '../src/engine/doublesAdvisor';
import { boxToCalc, makeField, moveDamage, npcToCalc } from '../src/engine/damage';
import { adviseTurn, mySet, indexes } from '../src/engine/turnAdvisor';

const ds = structuredClone(fixture) as unknown as Dataset;
const tate = ds.npcs.find((n) => n.name === 'Tate & Liza')!;

const mon = (name: string, level: number, position: number, extra: Partial<BattleMon> = {}): BattleMon => ({ name, level, position, ...extra });

/** A doubles snapshot vs Tate & Liza: your two Pokémon and their moves (by name). */
function snapOf(my: [BattleMon, string[]][], foes: BattleMon[] = [mon('Claydol', 41, 1), mon('Xatu', 41, 2)], extra: Partial<BattleSnapshot> = {}): BattleSnapshot {
  const movesByMon = Object.fromEntries(my.map(([m, mv]) => [m.name.toLowerCase(), mv]));
  return {
    v: 2, at: 1, status: 'active', kind: 'gym', format: 'doubles', opponentName: 'Tate & Liza', turn: 1,
    player: my[0][0], opponent: foes[0], moves: [], bench: [],
    opponentTeam: foes.map((f) => ({ name: f.name, level: f.level, active: true, fainted: false })),
    boosts: { player: {}, opponent: {} }, log: [], events: [],
    actives: { player: my.map(([m]) => m), opponent: foes },
    ...extra,
    // test helper: carried through options below
    ...({ __moves: movesByMon } as object),
  } as BattleSnapshot;
}
const advise = (snap: BattleSnapshot) => adviseDoubles(ds, snap, [], { movesByMon: (snap as unknown as { __moves: Record<string, string[]> }).__moves });

describe('doubles calc: spread moves', () => {
  it('Surf hits both foes AND your ally, each at ×0.75 (as seen live)', () => {
    const a = advise(snapOf([[mon('Slowbro', 45, 1), ['Surf']], [mon('Golem', 45, 2), ['Rock Slide']]]));
    const surf = a.mine[0].actions.find((x) => x.label === 'Surf')!;
    expect(surf.spread).toBe(true);
    expect(surf.hits!.map((h) => [h.side, h.name])).toEqual([['opponent', 'Claydol'], ['opponent', 'Xatu'], ['player', 'Golem']]);
    // ×0.75 vs the same hit in singles.
    const idx = indexes(ds);
    const slow = boxToCalc(ds, mySet(idx, [], { name: 'Slowbro', level: 45 }, ['Surf'])!.mon);
    const xatu = npcToCalc(ds, { ...tate.variants[0].team.find((m) => m.name === 'Xatu')!, level: 41 });
    const single = moveDamage(ds, slow, xatu, 'surf', makeField('singles'))!;
    const xatuHit = surf.hits!.find((h) => h.name === 'Xatu')!;
    expect(xatuHit.maxPct).toBeLessThan(single.maxPct * 0.8);
    expect(xatuHit.maxPct).toBeGreaterThan(single.maxPct * 0.7);
  });

  it('warns when a spread move hits your ally (Golem takes 4× Surf)', () => {
    const a = advise(snapOf([[mon('Slowbro', 45, 1), ['Surf', 'Psychic']], [mon('Golem', 45, 2), ['Rock Slide']]]));
    const surf = a.mine[0].actions.find((x) => x.label === 'Surf')!;
    expect(surf.allyHit?.name).toBe('Golem');
    expect(surf.reason).toMatch(/also hits your Golem/);
    // The Psychic on a single foe ranks above a Surf that wrecks the partner.
    expect(a.mine[0].actions[0].label).toBe('Psychic');
  });

  it('no warning when the ally is immune: Earthquake next to a Flying partner', () => {
    const a = advise(snapOf([[mon('Golem', 45, 1), ['Earthquake']], [mon('Charizard', 45, 2), ['Flamethrower']]], [mon('Solrock', 42, 1), mon('Lunatone', 42, 2)]));
    const eq = a.mine[0].actions.find((x) => x.label === 'Earthquake')!;
    expect(eq.allyHit).toBeUndefined();
    expect(eq.hits!.find((h) => h.name === 'Charizard')?.immune).toBe(true);
    expect(eq.combo).toMatch(/Charizard is immune/);
  });

  it('one foe left: no spread reduction', () => {
    const two = advise(snapOf([[mon('Golem', 45, 1), ['Rock Slide']], [mon('Charizard', 45, 2), ['Flamethrower']]], [mon('Solrock', 42, 1), mon('Lunatone', 42, 2)]));
    const one = advise(snapOf([[mon('Golem', 45, 1), ['Rock Slide']], [mon('Charizard', 45, 2), ['Flamethrower']]], [mon('Solrock', 42, 1), mon('Lunatone', 42, 2, { hp: 0, maxHp: 140 })]));
    const hit = (a: ReturnType<typeof advise>) => a.mine[0].actions.find((x) => x.label === 'Rock Slide')!.hits!.find((h) => h.name === 'Solrock')!.maxPct;
    expect(hit(one) / hit(two)).toBeGreaterThan(1.25);
  });
});

describe('doubles: target choice and NPC model', () => {
  it('picks the target the move hurts most (Close Combat: Solrock, not Xatu)', () => {
    const a = advise(snapOf([[mon('Machamp', 45, 1), ['Close Combat']], [mon('Slowbro', 45, 2), ['Psychic']]], [mon('Xatu', 41, 1), mon('Solrock', 42, 2)]));
    const top = a.mine[0].actions[0];
    expect(top.label).toBe('Close Combat');
    expect(top.target).toMatchObject({ side: 'opponent', name: 'Solrock', position: 2 });
    // Every single-target move is listed once per foe.
    expect(a.mine[0].actions.filter((x) => x.label === 'Close Combat').map((x) => x.target!.name).sort()).toEqual(['Solrock', 'Xatu']);
  });

  it('models each NPC Pokémon’s likely move with a target, spread moves flagged', () => {
    const a = advise(snapOf([[mon('Slowbro', 45, 1), ['Surf']], [mon('Machamp', 45, 2), ['Close Combat']]]));
    const clay = a.foes.find((f) => f.mon.name === 'Claydol')!;
    expect(clay.likely.length).toBeGreaterThan(0);
    const eq = clay.likely.find((g) => g.name === 'Earthquake');
    expect(eq?.spread).toBe(true);
    const xatu = a.foes.find((f) => f.mon.name === 'Xatu')!;
    const psy = xatu.likely.find((g) => g.name === 'Psychic');
    expect(psy?.target).toBe('Machamp'); // Psychic is super effective on the Fighting type
    expect(a.order.length).toBe(4);
  });

  it('Fake Out only on the first turn out', () => {
    const first = advise(snapOf([[mon('Machamp', 45, 1), ['Fake Out', 'Close Combat']], [mon('Slowbro', 45, 2), ['Psychic']]]));
    const fo = first.mine[0].actions.filter((x) => x.label === 'Fake Out');
    expect(fo.length).toBe(2);
    expect(fo[0].reason).toMatch(/flinches/);
    const later = advise(snapOf([[mon('Machamp', 45, 1), ['Fake Out', 'Close Combat']], [mon('Slowbro', 45, 2), ['Psychic']]], undefined, {
      events: [{ idx: 5, turn: 1, side: 'player', mon: 'Machamp', move: 'Close Combat', target: 'Claydol', targetSide: 'opponent', stages: { attacker: {}, target: {} } }], turn: 2,
    }));
    expect(later.mine[0].actions.find((x) => x.label === 'Fake Out')!.score).toBeNull();
  });
});

describe('doubles teamwork credit', () => {
  const hit = (user: string, label: string, target: string, minPct: number, maxPct: number, targetHp = 100, ko?: 'sure' | 'chance'): DoublesAction => ({
    user, kind: 'move', label, moveId: label.toLowerCase().replace(/ /g, ''), target: { side: 'opponent', name: target }, score: 40, reason: '',
    hits: [{ side: 'opponent', name: target, minPct, maxPct, ko }], targetHp,
  });

  it('focus fire: two hits that KO one target together', () => {
    const r = synergy(hit('Slowbro', 'Psychic', 'Claydol', 55, 65), hit('Machamp', 'Close Combat', 'Claydol', 50, 60));
    expect(r.bonus).toBe(25);
    expect(r.why[0]).toMatch(/KO Claydol together/);
    // Only on average: smaller credit.
    expect(synergy(hit('A', 'X', 'Claydol', 40, 60), hit('B', 'Y', 'Claydol', 45, 55)).bonus).toBe(12);
    // Overkill: one hit already KOs.
    expect(synergy(hit('A', 'X', 'Claydol', 110, 130, 100, 'sure'), hit('B', 'Y', 'Claydol', 40, 50)).bonus).toBe(-15);
    // Different targets: nothing.
    expect(synergy(hit('A', 'X', 'Claydol', 55, 65), hit('B', 'Y', 'Xatu', 55, 65)).bonus).toBe(0);
  });

  it('Protect while the partner’s Earthquake would hit you', () => {
    const protect: DoublesAction = { user: 'Slowbro', kind: 'support', label: 'Protect', moveId: 'protect', score: 18, reason: '' };
    const eq: DoublesAction = { user: 'Golem', kind: 'move', label: 'Earthquake', moveId: 'earthquake', spread: true, score: 30, reason: '', allyHit: { side: 'player', name: 'Slowbro', minPct: 30, maxPct: 36 } };
    const r = synergy(protect, eq);
    expect(r.bonus).toBe(25);
    expect(r.why[0]).toMatch(/protects itself from Golem's Earthquake/);
  });

  it('Helping Hand counts only with the boosted attack', () => {
    const hh: DoublesAction = { user: 'Slowbro', kind: 'support', label: 'Helping Hand', moveId: 'helpinghand', score: 60, reason: '', helps: 'closecombat|solrock' };
    expect(synergy(hh, hit('Machamp', 'Close Combat', 'Solrock', 40, 50)).why[0]).toMatch(/Helping Hand boosts/);
    expect(synergy(hh, hit('Machamp', 'Close Combat', 'Xatu', 10, 12)).bonus).toBe(-20);
  });

  it('Helping Hand is scored from the partner’s best boosted hit', () => {
    const a = advise(snapOf([[mon('Slowbro', 45, 1), ['Helping Hand']], [mon('Machamp', 45, 2), ['Close Combat']]], [mon('Xatu', 41, 1), mon('Solrock', 42, 2)]));
    const hh = a.mine[0].actions.find((x) => x.label === 'Helping Hand')!;
    expect(hh.score).toBeGreaterThan(20);
    expect(hh.reason).toMatch(/Machamp's Close Combat/);
    expect(a.plan!.picks.map((p) => p.label)).toContain('Close Combat');
  });

  it('picks a plan with one action per Pokémon', () => {
    const a = advise(snapOf([[mon('Slowbro', 45, 1), ['Surf', 'Psychic']], [mon('Machamp', 45, 2), ['Close Combat']]]));
    expect(a.plan!.picks.map((p) => p.user)).toEqual(['Slowbro', 'Machamp']);
    expect(a.plan!.score).toBeGreaterThan(0);
  });
});

describe('singles regression', () => {
  it('adviseTurn ignores the doubles fields', () => {
    const snap = snapOf([[mon('Slowbro', 45, 1), ['Surf']], [mon('Machamp', 45, 2), ['Close Combat']]]);
    const r = adviseTurn(ds, { ...snap, moves: [{ name: 'Surf', disabled: false }] }, []);
    expect(r.actions.some((x) => x.label === 'Surf')).toBe(true);
  });
});
