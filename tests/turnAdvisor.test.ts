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

  it('Battle tab looks ahead (KO odds incl. crits, their KO risk); the cheap path for Explore does not', () => {
    expect(a.threat?.koChance).toBeTypeOf('number');
    expect(a.threat?.critKo).toBeTypeOf('number');
    const md = a.actions.find((x) => x.label === 'Mega Drain')!;
    expect(md.koChance).toBeGreaterThan(0.99);
    expect(md.reason).toMatch(/Heals ~\d+%/);
    const cheap = adviseTurn(ds, snap, box, { lookahead: 0 });
    expect(cheap.threat?.koChance).toBeUndefined();
    expect(cheap.actions.every((x) => x.line === undefined && x.koChance === undefined)).toBe(true);
    expect(cheap.actions[0].label).toBe(a.actions[0].label);
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

describe('Destiny Bond (a friend saw an NPC use it exactly when its next hit would KO)', () => {
  // Same battle, but outside League rules and Onix knows Destiny Bond at 5 HP.
  const dsDb = structuredClone(ds);
  const brock = dsDb.npcs.find((n) => n.id === 'challenge:brock')!;
  brock.category = 'rival';
  const onix = brock.variants[0].team.find((m) => m.name === 'Onix')!;
  onix.moves = [...onix.moves.slice(0, 3), 'destinybond'];
  const box: BoxMon[] = [
    { uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: zero },
  ];
  const base = { ...snap, opponent: { ...snap.opponent!, hp: 5, status: undefined }, events: (snap.events ?? []).filter((e) => e.turn !== 3) };
  const leaf = (a: ReturnType<typeof adviseTurn>) => a.actions.find((x) => x.label === 'Razor Leaf')!;

  it('when it moves first, a KO move is risky and the advice says to bait it', () => {
    const a = adviseTurn(dsDb, { ...base, boosts: { player: {}, opponent: { spe: 6 } } }, box);
    expect(leaf(a).ko).toBe('sure');
    expect(leaf(a).score!).toBeLessThanOrEqual(45);
    expect(leaf(a).reason).toMatch(/Bait it/);
    expect(a.prediction![0].name).toBe('Destiny Bond');
    expect(a.notes.join(' ')).toMatch(/knows Destiny Bond/);
  });

  it('when you move first, the KO is safe', () => {
    const a = adviseTurn(dsDb, { ...base, boosts: { player: {}, opponent: {} } }, box);
    expect(leaf(a).reason).toMatch(/before it can use Destiny Bond/);
    expect(leaf(a).score!).toBeGreaterThan(60);
  });

  it('right after it used Destiny Bond: KO is unsafe if you hit first, safe if it moves first', () => {
    const used = [...base.events, { idx: 99, turn: 4, side: 'opponent' as const, mon: 'Onix', move: 'Destiny Bond', target: 'Cottonee', stages: { attacker: {}, target: {} } }];
    const youFirst = adviseTurn(dsDb, { ...base, events: used, boosts: { player: {}, opponent: {} } }, box);
    expect(leaf(youFirst).score!).toBeLessThanOrEqual(30);
    expect(leaf(youFirst).reason).toMatch(/Destiny Bond is active/);
    const theyFirst = adviseTurn(dsDb, { ...base, events: used, boosts: { player: {}, opponent: { spe: 6 } } }, box);
    expect(leaf(theyFirst).reason).toMatch(/safe to KO/);
    expect(theyFirst.prediction!.find((g) => g.name === 'Destiny Bond')!.prob).toBeLessThan(0.05);
  });

  it('compares speed with Destiny Bond itself, not with a priority attack (Quick Attack)', () => {
    const dsQa = structuredClone(dsDb);
    dsQa.npcs.find((n) => n.id === 'challenge:brock')!.variants[0].team.find((m) => m.name === 'Onix')!.moves = ['quickattack', 'destinybond'];
    const a = adviseTurn(dsQa, { ...base, boosts: { player: {}, opponent: {} } }, box);
    expect(a.threat?.youFirst).toBe(false); // Quick Attack goes first…
    expect(leaf(a).reason).toMatch(/before it can use Destiny Bond/); // …but Destiny Bond does not
  });

  it('the NPC keeps its Destiny Bond in Gym and in Mega Chamber battles (only YOUR Destiny Bond fails there)', () => {
    for (const category of ['gym', 'mega'] as const) {
      const d = structuredClone(dsDb);
      d.npcs.find((n) => n.id === 'challenge:brock')!.category = category;
      const a = adviseTurn(d, { ...base, boosts: { player: {}, opponent: { spe: 6 } } }, box);
      expect(a.notes.join(' ')).toMatch(/knows Destiny Bond/);
      expect(leaf(a).reason).toMatch(/Bait it/);
    }
  });

  it('no item advice in Battle Towers (Bag medicine is not allowed there)', () => {
    const d = structuredClone(dsDb);
    d.npcs.find((n) => n.id === 'challenge:brock')!.category = 'tower';
    const a = adviseTurn(d, { ...base, player: { ...base.player!, hp: 3 } }, box, { items: new Map([['superpotion', 5]]) });
    expect(a.actions.some((x) => x.kind === 'item')).toBe(false);
    expect(a.notes.join(' ')).toMatch(/Bag medicine cannot be used/);
  });
});

describe('battle items (battle screen: "Choose an item, then its target. Uses one turn.")', () => {
  const box: BoxMon[] = [
    { uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: zero },
    { uid: 'game:2', gameId: '2', source: 'game', species: 387, level: 14, moves: ['razorleaf'], nature: 'Hardy', ivs: iv(20), evs: zero },
  ];
  const items = new Map([['potion', 10], ['superpotion', 15], ['fullheal', 13], ['revive', 12]]);
  const items_ = (a: ReturnType<typeof adviseTurn>) => a.actions.filter((x) => x.kind === 'item');

  it('suggests nothing when healthy, and none without a bag', () => {
    expect(items_(adviseTurn(ds, { ...snap, player: { ...snap.player!, hp: snap.player!.maxHp, status: undefined } }, box, { items }))).toEqual([]);
    expect(items_(adviseTurn(ds, { ...snap, player: { ...snap.player!, hp: 5 } }, box))).toEqual([]);
  });

  it('low HP: picks a potion big enough, scored with their free hit', () => {
    const a = adviseTurn(ds, { ...snap, player: { ...snap.player!, hp: Math.round(snap.player!.maxHp! * 0.3), status: undefined } }, box, { items });
    const heal = items_(a).find((x) => /Potion/.test(x.label))!;
    expect(heal.label).toMatch(/^(Super )?Potion on Cottonee/);
    expect(heal.reason).toMatch(/\+\d+ HP \(\d+ in bag\), takes ~\d+%/);
    expect(heal.score).not.toBeNull();
  });

  it('a status: offers the matching cure', () => {
    const a = adviseTurn(ds, { ...snap, player: { ...snap.player!, status: 'par' } }, box, { items });
    expect(items_(a).find((x) => x.label.startsWith('Full Heal'))!.reason).toMatch(/Cures paralysis/);
  });

  it('a fainted team member: offers Revive with a two-turn penalty', () => {
    const bench = snap.bench.map((r) => (r.name === 'Turtwig' ? { ...r, hp: 0, fainted: true } : r));
    const a = adviseTurn(ds, { ...snap, bench }, box, { items });
    const rev = items_(a).find((x) => x.label === 'Revive on Turtwig')!;
    expect(rev.reason).toMatch(/back at half HP/);
    expect(rev.score!).toBeLessThan(a.actions[0].score!);
  });
});

describe('fainted active Pokémon (live bug: Drake, Charizard at 0 HP still got moves, a Super Potion and a Revive)', () => {
  const box: BoxMon[] = [
    { uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: zero },
    { uid: 'game:2', gameId: '2', source: 'game', species: 387, level: 14, moves: ['razorleaf'], nature: 'Hardy', ivs: iv(20), evs: zero },
  ];
  const items = new Map([['superpotion', 14], ['revive', 10], ['fullheal', 3]]);
  // Moves are still on screen (the game keeps the move grid), the bench has a fainted Turtwig.
  const bench = snap.bench.map((r) => (r.active ? { ...r, hp: 0, fainted: true } : r.name === 'Turtwig' ? { ...r, hp: 0, fainted: true } : r));
  const down: typeof snap = { ...snap, player: { ...snap.player!, hp: 0, status: 'par' }, bench, forcedSwitch: true };
  const a = adviseTurn(ds, down, box, { items });

  it('only ranks living bench Pokémon as switch-ins', () => {
    expect(a.forcedSwitch).toBe(true);
    expect(a.actions.every((x) => x.kind === 'switch')).toBe(true);
    expect(a.actions.map((x) => x.label).sort()).toEqual(['Send in Flapple', 'Send in Pancham', 'Send in Timburr']);
  });

  it('no moves, no potion, no cure, no Revive (not on the fainted one, not on the bench)', () => {
    expect(a.actions.some((x) => x.kind === 'move' || x.kind === 'item')).toBe(false);
  });

  it('no "KOs you" line and no move guess for the fainted Pokémon; each switch-in shows their best hit on it', () => {
    expect(a.threat).toBeUndefined();
    expect(a.prediction).toBeUndefined();
    expect(a.npcSwitch).toBeUndefined();
    for (const x of a.actions) {
      expect(x.threat?.name).toBeTruthy();
      expect(x.reason).toMatch(/^Their .+ does \d+–\d+% to it/);
    }
  });

  it('a replacement comes in free: no switch-in hit, so it scores at least as well as a mid-turn switch', () => {
    const normal = adviseTurn(ds, snap, box);
    for (const x of a.actions) {
      const mid = normal.actions.find((y) => y.label === x.label.replace('Send in', 'Switch to'))!;
      expect(x.score!).toBeGreaterThanOrEqual(mid.score!);
      expect(x.reason).not.toMatch(/switching in/);
    }
  });

  it('older snapshots without the flag: 0 HP alone is enough', () => {
    const old = adviseTurn(ds, { ...snap, player: { ...snap.player!, hp: 0 } }, box, { items });
    expect(old.forcedSwitch).toBe(true);
    expect(old.actions.some((x) => x.kind !== 'switch')).toBe(false);
  });

  it('the fainted switch card alone (screen HP not updated yet) is enough', () => {
    const lag = adviseTurn(ds, { ...snap, bench: snap.bench.map((r) => (r.active ? { ...r, fainted: true } : r)) }, box, { items });
    expect(lag.forcedSwitch).toBe(true);
  });

  it('unknown HP is not treated as fainted, and a normal turn is unchanged', () => {
    const unknown = adviseTurn(ds, { ...snap, player: { ...snap.player!, hp: undefined } }, box);
    expect(unknown.forcedSwitch).toBeUndefined();
    const normal = adviseTurn(ds, snap, box);
    expect(normal.forcedSwitch).toBeUndefined();
    expect(normal.actions.some((x) => x.kind === 'move')).toBe(true);
    expect(normal.threat).toBeDefined();
  });

  it('a normal turn never offers Revive on the active Pokémon', () => {
    // Defensive: a card marked active and at 0 HP that does not match the Pokémon on screen.
    const odd = snap.bench.map((r) => (r.name === 'Turtwig' ? { ...r, hp: 0, fainted: true, active: true } : r));
    const n = adviseTurn(ds, { ...snap, bench: odd }, box, { items });
    expect(n.forcedSwitch).toBeUndefined();
    expect(n.actions.some((x) => x.label === 'Revive on Turtwig')).toBe(false);
  });
});

describe('forced switch with two of the same species (the user has two Aggrons)', () => {
  it('the healthy one is still listed when the other fainted', () => {
    const box: BoxMon[] = [{ uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'megadrain'], nature: 'Modest', ivs: iv(20), evs: zero }];
    const twin = { name: 'Cottonee', level: 17, hp: 40, maxHp: 40, active: false, fainted: false };
    const bench = [...snap.bench.map((r) => (r.active ? { ...r, hp: 0, fainted: true } : r)), twin];
    const a = adviseTurn(ds, { ...snap, player: { ...snap.player!, hp: 0 }, bench }, box);
    expect(a.actions.map((x) => x.label)).toContain('Send in Cottonee');
    expect(a.actions.filter((x) => x.label === 'Send in Cottonee')).toHaveLength(1);
  });
});
