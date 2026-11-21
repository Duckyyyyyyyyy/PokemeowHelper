// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from './fixtures/wiki-mini.json';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset, Npc } from '../src/shared/types';
import { bestAttackTypes, bestDefensiveTypes } from '../src/engine/analysis';
import { BOSS_RULES, rulesFor } from '../src/engine/rules';
import { adviseTurn, matchWithBossMoves } from '../src/engine/turnAdvisor';
import { recordObserved } from '../src/engine/observed';
import {
  BOSS_DAMAGE_MULT, RAID_MULT, asHeavyBoss, barrierMult, bossActionDamage, bossDrainHeal, bossForm, bossPhase, byRace, bossDs, bossHits, bossPool, bossVariant,
  bossFormOf, capBossBoosts, lootTier, maxMoveName, maxMovePower, overdriveMult, rateBossMember, suggestBossTeam,
} from '../src/engine/worldBoss';
import { boxToCalc, defenderVsNpc, moveDamage, npcToCalc } from '../src/engine/damage';
import { lobbySig, mergeBossLobby, readBossLobby } from '../src/content/bossLobbyReader';
import { activeBossMoves, BOSS_PICK_MAX_AGE, lobbyMovesFor, lobbyNameMatches } from '../src/ui/bossStore';

const ds = structuredClone(fixture) as unknown as Dataset;
ds.species[292] = {
  id: 292, name: 'Shedinja', types: ['Bug', 'Ghost'], baseStats: { hp: 1, atk: 90, def: 45, spa: 30, spd: 30, spe: 40 },
  abilities: [{ id: 'wonderguard', name: 'Wonder Guard', hidden: false }], levelMoves: [], machineMoves: [], eggMoves: [],
};
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (name: string, level: number, moves: string[] = [], extra: Partial<BoxMon> = {}): BoxMon => ({
  uid: name, species: sp(name), level, moves, source: 'game', nature: 'Hardy',
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ...extra,
});
// Fixture boss: Gigantamax Venusaur (Grass/Poison), pool of 8.
const venu = ds.npcs.find((n) => n.id === 'boss:venusaur-gmax')!;
const v = venu.variants[0];
const boss = v.team[0];
const POOL = [...boss.moves];

describe('World Boss move filter', () => {
  it('keeps only the selected moves, never touching the dataset; no selection = the whole pool', () => {
    const f = bossVariant(v, ['sludgebomb', 'earthpower']);
    expect(f.team[0].moves).toEqual(['earthpower', 'sludgebomb']); // pool order
    expect(boss.moves).toEqual(POOL);
    expect(bossVariant(v, [])).toBe(v);
    expect(bossVariant(v, null)).toBe(v);
    expect(bossVariant(v, ['notinpool']).team[0].moves).toEqual(POOL); // nothing valid → whole pool, never "harmless"
  });

  it('changes the best defensive types', () => {
    const all = bestDefensiveTypes(ds, v);
    const ground = bestDefensiveTypes(ds, bossVariant(v, ['earthpower']));
    const rank = (list: typeof all, t: string) => list.findIndex((x) => x.type === t);
    // Earth Power alone: Flying is immune, and Electric/Fire/Poison/Rock/Steel are weak.
    expect(ground[0].type).toBe('Flying');
    expect(ground.find((x) => x.type === 'Electric')!.weak).toBe(1);
    expect(rank(ground, 'Electric')).toBeGreaterThan(rank(all, 'Electric'));
    // Attacking types depend on the boss's typing only: unchanged.
    expect(bestAttackTypes(ds, bossVariant(v, ['earthpower']))[0].type).toBe(bestAttackTypes(ds, v)[0].type);
  });

  it('changes the counter-team', () => {
    // Pikachu fears Earth Power; Charizard (Flying) laughs at it but fears Rock-free special hits less.
    const box = [mon('Pikachu', 60, ['thunderbolt']), mon('Charizard', 60, ['flamethrower', 'airslash']), mon('Lapras', 60, ['icebeam'])];
    const onlyGround = suggestBossTeam(ds, box, bossVariant(v, ['earthpower']), { size: 3, pool: bossPool(venu) });
    const pika = (s: typeof onlyGround) => s.ranked.find((m) => m.mon.uid === 'Pikachu')!;
    const zard = (s: typeof onlyGround) => s.ranked.find((m) => m.mon.uid === 'Charizard')!;
    expect(zard(onlyGround).takenPct).toBe(0); // Max Quake can't touch a Flying type
    expect(zard(onlyGround).turns).toBe(30);
    const noGround = suggestBossTeam(ds, box, bossVariant(v, ['furycutter']), { size: 3, pool: bossPool(venu) });
    expect(pika(noGround).turns).toBeGreaterThan(pika(onlyGround).turns);
    expect(pika(noGround).total).toBeGreaterThan(pika(onlyGround).total);
    expect(onlyGround.dangers.map((d) => d.hit.moveId)).toEqual(['earthpower']);
    expect(noGround.dangers.map((d) => d.hit.moveId)).toEqual(['furycutter']);
  });

  it('changes who makes the team', () => {
    // Charizard (Flying) is immune to Max Quake; Gengar (Ghost) is immune to Max Strike and Max Knuckle.
    const box = [mon('Charizard', 60, ['flamethrower']), mon('Gengar', 60, ['shadowball']), mon('Lapras', 60, ['icebeam']), mon('Snorlax', 60, ['bodyslam'])];
    const uids = (sel: string[]) => suggestBossTeam(ds, box, bossVariant(v, sel), { size: 2, pool: bossPool(venu) }).team.map((m) => m.mon.uid);
    const ground = uids(['earthpower']);
    const normal = uids(['hyperbeam', 'rocksmash']);
    expect(ground).toContain('Charizard');
    expect(ground).not.toContain('Gengar'); // weak to Ground
    expect(normal).toContain('Gengar');
    expect(normal).not.toEqual(ground);
  });

  it('breaks equal totals by turns survived, then damage per turn, then id', () => {
    const row = (uid: string, total: number, turns: number, perTurn: number) => ({ mon: { uid }, total, turns, perTurn }) as unknown as Parameters<typeof byRace>[0];
    const sorted = [row('b', 0, 1, 50), row('a', 0, 1, 50), row('c', 0, 2, 10), row('d', 0, 1, 90), row('e', 5, 1, 5)].sort(byRace).map((r) => r.mon.uid);
    expect(sorted).toEqual(['e', 'c', 'd', 'a', 'b']);
  });

  it('reads the shared HP pool and reports damage per turn against it', () => {
    expect(bossPool(venu)).toBe(3_000_000);
    expect(bossPool({ ...venu, requirements: [] } as Npc)).toBe(10_000_000); // wiki default (Eternamax 100M)
    const m = rateBossMember(ds, mon('Charizard', 60, ['flamethrower']), boss, { pool: 3_000_000 });
    expect(m.moveName).toBe('Flamethrower');
    expect(m.perTurn).toBeGreaterThan(50);
    expect(m.perTurnPct).toBeCloseTo((100 * m.perTurn) / 3_000_000, 8);
    expect(m.totalDown).toBeCloseTo(m.perTurn * m.actions, 6); // barrier down: every action at full damage
    expect(m.total).toBeLessThan(m.totalDown); // barrier up: only this race's own damage wears it down
  });
});

describe('World Boss attacks are Max Moves', () => {
  it('uses the Gen 8 Max Move power table (assumed)', () => {
    expect(maxMovePower({ type: 'Dragon', power: 130 })).toBe(140); // Draco Meteor → Max Wyrmwind
    expect(maxMovePower({ type: 'Normal', power: 150 })).toBe(150); // Hyper Beam
    expect(maxMovePower({ type: 'Poison', power: 95 })).toBe(90); // Sludge Wave → Max Ooze
    expect(maxMovePower({ type: 'Bug', power: 40 })).toBe(90); // Fury Cutter → Max Flutterby
    expect(maxMovePower({ type: 'Fighting', power: 40 })).toBe(70);
    expect(maxMoveName({ type: 'Fire', category: 'Special' })).toBe('Max Flare');
    expect(maxMoveName({ type: 'Fire', category: 'Status' })).toBe('Max Guard');
  });

  it('boss moves never miss, have no priority, and the 55% cut applies', () => {
    const bds = bossDs(ds, ['furycutter']);
    expect(bds.moves.furycutter.power).toBe(90);
    expect(bds.moves.furycutter.accuracy).toBe(true);
    expect(ds.moves.furycutter.power).toBe(40); // the real dataset is untouched
    const me = boxToCalc(ds, mon('Lapras', 60));
    const sel = { ...boss, moves: ['furycutter'] };
    const full = bossHits(ds, sel, me, { damageMult: 1 })[0].pct;
    const cut = bossHits(ds, sel, me)[0].pct;
    expect(cut).toBeCloseTo(full * BOSS_DAMAGE_MULT, 6);
  });
});

describe('World Boss rules', () => {
  it('your OHKO / Destiny Bond / Perish Song / Endeavor / Pain Split fail', () => {
    expect(rulesFor('boss')).toBe(BOSS_RULES);
    const lapras = mon('Lapras', 60, ['sheercold', 'icebeam']);
    expect(rateBossMember(ds, lapras, boss).moveId).toBe('icebeam');
    const onlyBanned = rateBossMember(ds, mon('Lapras', 60, ['sheercold', 'perishsong']), boss);
    expect(onlyBanned.moveId).toBeUndefined();
    expect(onlyBanned.total).toBe(0);
  });

  it('the boss hits through Wonder Guard', () => {
    const shed = mon('Shedinja', 60, ['shadowball'], { ability: 'Wonder Guard' });
    const r = rateBossMember(ds, shed, bossVariant(v, ['sludgebomb']).team[0]); // not super effective on Bug/Ghost
    expect(r.takenPct).toBeGreaterThan(0);
    expect(r.turns).toBe(1);
  });

  it('values setup and support: a screen against the selected moves, a status the boss can take', () => {
    // Lapras with Light Screen vs special-only moves: the screen plan deals more in total.
    const special = bossVariant(v, ['earthpower', 'sludgebomb']).team[0];
    const ls = rateBossMember(ds, mon('Lapras', 60, ['icebeam', 'lightscreen']), special);
    const plain = rateBossMember(ds, mon('Lapras', 60, ['icebeam']), special);
    expect(ls.plan).toMatchObject({ kind: 'screen', supportMove: 'lightscreen' });
    expect(ls.total).toBeGreaterThan(plain.total);
    expect(ls.turns).toBeGreaterThan(plain.turns);
    // Reflect does nothing against special-only moves: never chosen.
    expect(rateBossMember(ds, mon('Lapras', 60, ['icebeam', 'reflect']), special).plan.kind).toBe('attack');
    // Grass/Poison boss: Toxic can't poison it, so it is never a plan.
    expect(rateBossMember(ds, mon('Lapras', 60, ['icebeam', 'toxic']), boss).plan.kind).toBe('attack');
    // Burn halves its physical hits; flagged as blocked while the shield is up.
    const physical = bossVariant(v, ['furycutter', 'knockoff']).team[0];
    const wisp = rateBossMember(ds, mon('Charizard', 60, ['flamethrower', 'willowisp']), physical);
    expect(wisp.plan).toMatchObject({ kind: 'status', supportMove: 'willowisp', shieldBlocked: true });
    expect(wisp.notes.join(' ')).toMatch(/shield/);
    expect(wisp.total).toBeGreaterThan(rateBossMember(ds, mon('Charizard', 60, ['flamethrower']), physical).total);
  });
});

/* ---------------- World Boss page reader (fixture from the game's class names, UNVERIFIED live) ---------------- */

const html = readFileSync(resolve(__dirname, 'fixtures/worldboss/lobby.unverified.html'), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};

describe('World Boss page reader (unverified fixture)', () => {
  const read = readBossLobby(load(html), 5)!;

  it('reads the next scheduled boss', () => {
    expect(read.next).toEqual({ name: 'Eternatus', form: 'eternamax', types: ['Poison', 'Dragon'], startsAt: '2026-11-20T20:00:00.000Z', staff: undefined });
  });

  it('reads the details dialog: facts and "Moves this appearance"', () => {
    expect(read.build).toMatchObject({ name: 'Eternatus', form: 'eternamax', level: 100, ability: 'Pressure', nature: 'Hardy', at: 5 });
    expect(read.build!.moves).toEqual([
      { name: 'Draco Meteor', type: 'Dragon', category: 'Special' },
      { name: 'Fire Blast', type: 'Fire', category: 'Special' },
      { name: 'Sludge Wave', type: 'Poison', category: 'Special' },
      { name: 'Flash Cannon', type: 'Steel', category: 'Special' },
    ]);
  });

  it('no moves listed = undefined (not an empty list)', () => {
    const noMoves = html.replace(/<section aria-labelledby="world-boss-info-moves">[\s\S]*?<\/section>/, '<p class="world-boss-note">Its moves are confirmed when it appears.</p>');
    expect(readBossLobby(load(noMoves))!.build!.moves).toBeUndefined();
  });

  it('keeps the moves after the dialog closes, and ignores read times in the change signature', () => {
    const first = mergeBossLobby(null, read, 5);
    const closed = readBossLobby(load(html.replace(/<div role="dialog"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '</div>')), 9)!;
    expect(closed.build).toBeUndefined();
    const after = mergeBossLobby(first, closed, 9);
    expect(Object.values(after.builds)[0].moves).toHaveLength(4);
    expect(lobbySig(readBossLobby(load(html), 1))).toBe(lobbySig(readBossLobby(load(html), 2)));
  });

  it('returns null on other pages', () => {
    expect(readBossLobby(load('<main><div class="wild-encounter"></div></main>'))).toBeNull();
  });
});

/* ---------------- lobby → picks → Battle tab ---------------- */

// An Eternamax Eternatus like the wiki's, built on the fixture's boss slot (its species stats don't matter here).
const eternaPool = ['assurance', 'dracometeor', 'fireblast', 'fly', 'shadowball', 'solarbeam', 'hyperbeam', 'sludgewave', 'meteorbeam', 'flashcannon'];
const eterna: Npc = {
  ...venu, id: 'boss:eternatus-eternamax', name: 'Eternamax Eternatus',
  variants: [{ ...v, team: [{ ...boss, name: 'Eternamax Eternatus', moves: eternaPool }] }],
};
const ds2: Dataset = { ...ds, npcs: [...ds.npcs, eterna] };

describe('World Boss lobby → selected moves', () => {
  const lobby = mergeBossLobby(null, readBossLobby(load(html), 1000)!, 1000);

  it('matches "Eternatus" + the Eternamax icon to Eternamax Eternatus, never another boss', () => {
    expect(lobbyNameMatches(eterna, 'Eternatus', 'eternamax')).toBe(true);
    expect(lobbyNameMatches(eterna, 'Eternatus')).toBe(false);
    expect(lobbyNameMatches(venu, 'Eternatus', 'eternamax')).toBe(false);
    expect(lobbyMovesFor(ds2, venu, lobby)).toBeNull();
  });

  it('pre-selects the lobby moves ("From lobby · next spawn")', () => {
    const m = lobbyMovesFor(ds2, eterna, lobby)!;
    expect(m.ids).toEqual(['dracometeor', 'fireblast', 'sludgewave', 'flashcannon']);
    expect(m.isNext).toBe(true);
    expect(activeBossMoves(ds2, eterna, lobby, {}, 2000)).toMatchObject({ source: 'lobby', ids: m.ids });
  });

  it('"next spawn" only while the read build belongs to the current next spawn time', () => {
    expect(Object.values(lobby.builds)[0].startsAt).toBe('2026-11-20T20:00:00.000Z');
    const later = { ...lobby, next: { ...lobby.next!, startsAt: '2026-11-21T04:00:00.000Z' } };
    const m = lobbyMovesFor(ds2, eterna, later)!;
    expect(m.isNext).toBe(false); // still shown (by boss name), no longer claimed as the next spawn
    expect(m.startsAt).toBeUndefined();
    expect(m.ids).toHaveLength(4);
    // A dialog read for a boss that is NOT the next one never gets the next card's time.
    const other = mergeBossLobby(null, { next: { name: 'Zacian', types: ['Fairy'], startsAt: 'x' }, build: readBossLobby(load(html), 7)!.build }, 7);
    expect(Object.values(other.builds)[0].startsAt).toBeUndefined();
  });

  it('the newer of your pick and the lobby wins; old ones expire', () => {
    expect(activeBossMoves(ds2, eterna, lobby, { [eterna.id]: { moves: ['fly'], at: 1500 } }, 2000)).toMatchObject({ source: 'manual', ids: ['fly'] });
    expect(activeBossMoves(ds2, eterna, lobby, { [eterna.id]: { moves: ['fly'], at: 500 } }, 2000)!.source).toBe('lobby');
    expect(activeBossMoves(ds2, eterna, lobby, {}, 1000 + BOSS_PICK_MAX_AGE + 1)).toBeNull();
    expect(activeBossMoves(ds2, eterna, null, { [eterna.id]: { moves: ['fly'], at: 0 } }, BOSS_PICK_MAX_AGE + 1)).toBeNull();
  });
});

describe('World Boss moves handed to the Battle tab', () => {
  const snap: BattleSnapshot = {
    v: 2, at: 1, status: 'active', kind: 'world-boss', turn: 1, opponentName: 'Gigantamax Venusaur',
    player: { name: 'Charizard', level: 60, hp: 180, maxHp: 180 }, opponent: { name: 'Gigantamax Venusaur', level: 100 },
    moves: [{ name: 'Flamethrower', pp: 15, maxPp: 15, disabled: false }],
    bench: [], opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [], events: [],
  };
  const box = [mon('Charizard', 60, ['flamethrower'])];
  const sel = { [venu.id]: ['earthpower', 'sludgebomb'] };

  it('narrows the boss to the selected moves (a copy; the dataset keeps its pool)', () => {
    const m = matchWithBossMoves(ds, snap, sel)!;
    expect(m.bossFiltered).toBe(true);
    expect(m.variant.team[0].moves).toEqual(['earthpower', 'sludgebomb']);
    expect(boss.moves).toEqual(POOL);
    expect(matchWithBossMoves(ds, snap, {})!.variant.team[0].moves).toEqual(POOL);
  });

  it('its likely moves come only from the selected set', () => {
    const a = adviseTurn(ds, snap, box, { lookahead: 0, bossMoves: sel });
    expect(a.prediction!.map((g) => g.moveId).sort()).toEqual(['earthpower', 'sludgebomb']);
    expect(a.notes.join(' ')).toMatch(/World Boss: its likely moves come only from the 2 moves/);
    const all = adviseTurn(ds, snap, box, { lookahead: 0 });
    expect(all.prediction!.length).toBeGreaterThan(2);
  });

  it('moves recorded at EARLIER spawns are not added back (only this battle counts)', () => {
    // An earlier spawn used Outrage; this one is narrowed to Earth Power + Sludge Bomb.
    const earlier: BattleSnapshot = { ...snap, events: [{ idx: 1, turn: 1, side: 'opponent', mon: 'Gigantamax Venusaur', move: 'Outrage', stages: { attacker: {}, target: {} } }] };
    const observed = recordObserved(ds, {}, earlier, 1);
    expect(Object.keys(observed).length).toBeGreaterThan(0);
    const a = adviseTurn(ds, snap, box, { lookahead: 0, bossMoves: sel, observed });
    expect(a.prediction!.map((g) => g.moveId).sort()).toEqual(['earthpower', 'sludgebomb']);
    expect(a.notes.join(' ')).not.toMatch(/Outrage/);
    // Without a narrowed set the old behaviour stays: a seen move is a possible threat.
    expect(adviseTurn(ds, snap, box, { lookahead: 0, observed }).prediction!.map((g) => g.moveId)).toContain('outrage');
  });

  it('a move it is seen using outside the set is added back, with a note', () => {
    const seen: BattleSnapshot = { ...snap, events: [{ idx: 1, turn: 1, side: 'opponent', mon: 'Gigantamax Venusaur', move: 'Outrage', stages: { attacker: {}, target: {} } }] };
    const a = adviseTurn(ds, seen, box, { lookahead: 0, bossMoves: sel });
    expect(a.prediction!.map((g) => g.moveId)).toContain('outrage');
    expect(a.notes.join(' ')).toMatch(/Outrage, which is not in the moves picked for this appearance/);
  });
});

/* ---------------- 2026-11 rules (wiki World Boss Battles, read 2026-11-22) ---------------- */

describe('World Boss rules 2026-11', () => {
  // The fixture's only boss is Gigantamax Venusaur: a plain and an Eternamax boss from the same mon.
  const plain = { ...boss, name: 'Venusaur', species: sp('Venusaur') };
  const eterna = { ...boss, name: 'Eternamax Venusaur', species: sp('Venusaur') };
  const ds2 = structuredClone(ds);
  ds2.npcs.push({ ...venu, id: 'boss:venusaur', name: 'Venusaur', requirements: [], variants: [{ ...v, team: [plain] }] });
  const snapFor = (name: string, extra: Partial<BattleSnapshot> = {}): BattleSnapshot => ({
    v: 2, at: 1, status: 'active', kind: 'world-boss', turn: 1, opponentName: name,
    player: { name: 'Charizard', level: 60, hp: 180, maxHp: 180 }, opponent: { name, level: 100 },
    moves: [{ name: 'Flamethrower', pp: 15, maxPp: 15, disabled: false }],
    bench: [], opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [], events: [], ...extra,
  });
  const knock = (id: string) => ({ [id]: ['knockoff'] });
  const zard = [mon('Charizard', 60, ['flamethrower'])];

  it('only GMAX and Eternamax bosses use Max Moves (name test, a guess)', () => {
    expect(bossForm('Gigantamax Venusaur')).toBe('gmax');
    expect(bossForm('G-Max Venusaur')).toBe('gmax');
    expect(bossForm('Eternamax Eternatus')).toBe('eternamax');
    expect(bossForm('Venusaur', 'Venusaur')).toBe('normal');
    const me = boxToCalc(ds, mon('Lapras', 60));
    const hit = (b: typeof boss) => bossHits(ds, { ...b, moves: ['furycutter'] }, me)[0];
    expect(hit(boss).maxName).toBe('Max Flutterby');
    expect(hit(plain).maxName).toBeUndefined();
    expect(hit(boss).pct).toBeGreaterThan(hit(plain).pct * 1.5); // 90 BP Max Move vs 40 BP Fury Cutter
  });

  it('the Battle tab uses the same rule: Max Move only for GMAX, 55% cut on its one-turn hits', () => {
    const g = adviseTurn(ds2, snapFor('Gigantamax Venusaur'), zard, { lookahead: 0, bossMoves: knock(venu.id) });
    const p = adviseTurn(ds2, snapFor('Venusaur'), zard, { lookahead: 0, bossMoves: knock('boss:venusaur') });
    const me = defenderVsNpc(boxToCalc(ds, zard[0]), BOSS_RULES);
    const maxFull = moveDamage(bossDs(ds, ['knockoff']), npcToCalc(ds, boss), me, 'knockoff')!;
    const rawFull = moveDamage(ds, npcToCalc(ds, plain), me, 'knockoff')!;
    expect(g.threat!.maxPct).toBeCloseTo(maxFull.maxPct * BOSS_DAMAGE_MULT, 4);
    expect(p.threat!.maxPct).toBeCloseTo(rawFull.maxPct * BOSS_DAMAGE_MULT, 4);
    expect(g.prediction![0].maxPct).toBeCloseTo(maxFull.maxPct * BOSS_DAMAGE_MULT, 4);
    expect(g.notes.join(' ')).toMatch(/every attack it makes is a Max Move/);
    expect(p.notes.join(' ')).toMatch(/normal moves/);
    // Your side also uses Knock Off: one dataset, so it keeps its normal power (and says so).
    const withKnock = { moves: [{ name: 'Flamethrower', pp: 15, maxPp: 15, disabled: false }, { name: 'Knock Off', pp: 20, maxPp: 20, disabled: false }] };
    const both = adviseTurn(ds2, snapFor('Gigantamax Venusaur', withKnock), [mon('Charizard', 60, ['flamethrower', 'knockoff'])], { lookahead: 0, bossMoves: knock(venu.id) });
    expect(both.threat!.maxPct).toBeLessThan(g.threat!.maxPct);
    expect(both.notes.join(' ')).toMatch(/Knock Off: your side uses it too/);
    // A box Pokémon that is not in this battle does not count.
    const boxed = adviseTurn(ds2, snapFor('Gigantamax Venusaur'), [...zard, mon('Gengar', 60, ['knockoff'])], { lookahead: 0, bossMoves: knock(venu.id) });
    expect(boxed.threat!.maxPct).toBeCloseTo(g.threat!.maxPct, 6);
    expect(boxed.notes.join(' ')).not.toMatch(/your side uses it too/);
    // The form is read the same way everywhere, also from the species name alone.
    expect(bossFormOf(ds, { name: 'Venusaur', species: boss.species }, 'Venusaur')).toBe(ds.species[boss.species].name.startsWith('Gigantamax') ? 'gmax' : 'normal');
    // The lookahead cuts its hits too: at an HP only the uncut hit would KO, its KO odds agree with the cut row.
    const cutMax = adviseTurn(ds2, snapFor('Gigantamax Venusaur'), zard, { bossMoves: knock(venu.id) }).threat!.maxPct;
    const hp = Math.round(180 * Math.min(0.95, (cutMax * 1.5) / 100));
    expect(hp / 1.8).toBeGreaterThan(cutMax);
    expect(hp / 1.8).toBeLessThan(cutMax / 0.45);
    const low = adviseTurn(ds2, snapFor('Gigantamax Venusaur', { player: { name: 'Charizard', level: 60, hp, maxHp: 180 } }), zard, { bossMoves: knock(venu.id) }).threat!;
    expect(low.ko).toBeUndefined();
    // Only a critical hit (×1.5 on the cut hit) can still KO here; the uncut hit would KO almost always.
    expect(low.koChance).toBeLessThan(0.05);
    expect(low.koChance).toBeCloseTo(low.critKo ?? 0, 9);
  });

  it('boss boosts stop at +2 Atk/SpA and +1 Def/SpD', () => {
    expect(capBossBoosts({ atk: 6, spa: 3, def: 4, spd: 2, spe: 6 })).toEqual({ atk: 2, spa: 2, def: 1, spd: 1, spe: 6 });
    const at = (atk: number) => adviseTurn(ds2, snapFor('Gigantamax Venusaur', { boosts: { player: {}, opponent: { atk } } }), zard, { lookahead: 0, bossMoves: knock(venu.id) }).threat!.maxPct;
    expect(at(6)).toBeCloseTo(at(2), 6);
    expect(at(2)).toBeGreaterThan(at(0));
  });

  it('Encore, Leech Seed and Salt Cure fail; the Battle tab says so', () => {
    for (const id of ['encore', 'leechseed', 'saltcure']) expect(BOSS_RULES.bannedMoves.has(id)).toBe(true);
    const a = adviseTurn(ds2, snapFor('Gigantamax Venusaur', { moves: [{ name: 'Flamethrower', pp: 15, maxPp: 15, disabled: false }, { name: 'Encore', pp: 5, maxPp: 5, disabled: false }] }),
      [mon('Charizard', 60, ['flamethrower', 'encore'])], { lookahead: 0, bossMoves: knock(venu.id) });
    expect(a.actions.find((x) => x.moveId === 'encore')).toMatchObject({ score: 0, reason: expect.stringMatching(/Fails/) });
    // Ghost-type Curse also fails: never the pick, in the Battle tab or in Prep.
    const ghost = { player: { name: 'Gengar', level: 60, hp: 150, maxHp: 150 }, moves: [{ name: 'Shadow Ball', pp: 15, maxPp: 15, disabled: false }, { name: 'Curse', pp: 10, maxPp: 10, disabled: false }] };
    for (const look of [0, 2]) {
      const c = adviseTurn(ds2, snapFor('Gigantamax Venusaur', ghost), [mon('Gengar', 60, ['shadowball', 'curse'])], { lookahead: look, bossMoves: knock(venu.id) });
      const curse = c.actions.find((x) => x.moveId === 'curse')!;
      const ball = c.actions.find((x) => x.moveId === 'shadowball')!;
      expect(curse.score ?? 0).toBeLessThanOrEqual(ball.score ?? 0);
    }
    expect(rateBossMember(ds, mon('Gengar', 60, ['shadowball', 'curse']), boss).plan.kind).toBe('attack');
  });

  it('shared HP from the data first, else 10M (Eternamax 100M)', () => {
    expect(bossPool(venu)).toBe(3_000_000);
    expect(bossPool({ ...venu, requirements: [] } as Npc)).toBe(10_000_000);
    expect(bossPool({ ...venu, name: 'Eternamax Eternatus', requirements: [] } as Npc)).toBe(100_000_000);
  });

  it('its hits deal 55% less (Eternamax 70% less)', () => {
    const me = boxToCalc(ds, mon('Lapras', 60));
    const sel = { ...eterna, moves: ['furycutter'] };
    expect(bossHits(ds, sel, me)[0].pct).toBeCloseTo(bossHits(ds, sel, me, { damageMult: 1 })[0].pct * 0.3, 6);
    const g = { ...boss, moves: ['furycutter'] };
    expect(bossHits(ds, g, me)[0].pct).toBeCloseTo(bossHits(ds, g, me, { damageMult: 1 })[0].pct * 0.45, 6);
  });

  it('your damage: 125x, Max Barrier 20% → 100% at 40% HP lost (Eternamax 1%), capped per action', () => {
    expect(barrierMult(0)).toBeCloseTo(0.2, 9);
    expect(barrierMult(0.2)).toBeCloseTo(0.6, 9); // straight-line ramp: a guess
    expect(barrierMult(0.4)).toBe(1);
    expect(barrierMult(0.01, 'eternamax')).toBe(1);
    expect(bossActionDamage(100, 'normal', { barrierDown: true })).toBe(100 * RAID_MULT);
    expect(bossActionDamage(100, 'normal')).toBeCloseTo(100 * RAID_MULT * 0.2, 6);
    expect(bossActionDamage(1000, 'normal', { barrierDown: true })).toBe(50_000);
    expect(bossActionDamage(10_000, 'eternamax', { barrierDown: true })).toBe(350_000);
    const m = rateBossMember(ds, mon('Charizard', 60, ['flamethrower']), boss);
    expect(m.perTurn).toBeLessThanOrEqual(50_000);
    expect(m.total).toBeGreaterThan(0.19 * m.totalDown);
  });

  it('drain and Shell Bell heal from ordinary damage, cut 50/75/90% by phase', () => {
    expect(bossDrainHeal(200, 0.5, 1)).toBe(50);
    expect(bossDrainHeal(200, 0.5, 2)).toBe(25);
    expect(bossDrainHeal(200, 0.5, 3)).toBeCloseTo(10, 9);
    expect([bossPhase(0), bossPhase(0.3), bossPhase(0.7)]).toEqual([1, 2, 3]);
    // A normal-type boss: Drain Punch vs Brick Break (same power and type) on the same Pokémon.
    // Its own base stats: NPC baseStats reach the calc, so spreading `boss` would keep the boss's.
    const snorlax = { ...boss, name: 'Snorlax', species: sp('Snorlax'), baseStats: ds.species[sp('Snorlax')].baseStats, moves: ['hyperbeam'] };
    const punch = rateBossMember(ds, mon('Machamp', 60, ['drainpunch']), snorlax);
    const brick = rateBossMember(ds, mon('Machamp', 60, ['brickbreak']), snorlax);
    expect(brick.turns).toBeLessThan(30);
    expect(punch.perTurn).toBeCloseTo(brick.perTurn, 6);
    expect(punch.turns).toBeGreaterThan(brick.turns);
    expect(punch.notes.join(' ')).toMatch(/cut 50% \/ 75% \/ 90%/);
    // Shell Bell adds 1/8 of the ordinary damage (cut the same way).
    const bell = rateBossMember(ds, mon('Machamp', 60, ['brickbreak'], { item: 'Shell Bell' }), snorlax);
    expect(bell.turns).toBeGreaterThanOrEqual(brick.turns);
    expect(bell.turns).toBeLessThanOrEqual(punch.turns);
    expect(bell.notes.join(' ')).toMatch(/Shell Bell/);
  });

  it('the boss is very heavy: Low Kick at full power, Heavy Slam at its weakest', () => {
    const me = boxToCalc(ds, mon('Machamp', 60));
    const foe = npcToCalc(ds, boss);
    const light = { lk: moveDamage(ds, me, foe, 'lowkick')!, hs: moveDamage(ds, me, foe, 'heavyslam')! };
    asHeavyBoss(foe);
    const heavy = { lk: moveDamage(ds, me, foe, 'lowkick')!, hs: moveDamage(ds, me, foe, 'heavyslam')! };
    expect(heavy.lk.hi).toBeGreaterThan(light.lk.hi);
    expect(heavy.hs.hi).toBeLessThan(light.hs.hi);
    const r = rateBossMember(ds, mon('Machamp', 60, ['lowkick']), boss);
    expect(r.perTurn).toBeCloseTo(((heavy.lk.lo + heavy.lk.hi) / 2) * RAID_MULT, 6);
  });

  it('Eternamax Overdrive: +75% per Atk/SpA stage makes setup worth more', () => {
    expect([overdriveMult(2), overdriveMult(4), overdriveMult(6), overdriveMult(-1)]).toEqual([2.5, 4, 5.5, 1]);
    expect(bossActionDamage(1000, 'eternamax', { stage: 2, barrierDown: true })).toBe(312_500);
    const sd = mon('Machamp', 60, ['crosschop', 'swordsdance']);
    const plainSd = mon('Machamp', 60, ['crosschop']);
    const gain = (b: typeof boss) => rateBossMember(ds, sd, b).total / rateBossMember(ds, plainSd, b).total;
    const e = rateBossMember(ds, sd, eterna);
    expect(e.plan.kind).toBe('boost');
    expect(e.plan.label).toMatch(/Overdrive/);
    expect(gain(eterna)).toBeGreaterThan(gain(plain));
  });

  it('loot tiers 50k / 150k / 350k / 750k (Eternamax x10)', () => {
    expect(lootTier(49_999)).toEqual({ tier: 0, next: 50_000 });
    expect(lootTier(150_000)).toEqual({ tier: 2, next: 350_000 });
    expect(lootTier(800_000)).toEqual({ tier: 4, next: undefined });
    expect(lootTier(800_000, 'eternamax')).toEqual({ tier: 1, next: 1_500_000 });
    const s = suggestBossTeam(ds, [mon('Charizard', 60, ['flamethrower'])], v, { size: 1 });
    expect(s.form).toBe('gmax');
    expect(s.totalDown).toBeGreaterThan(s.total);
    expect(s.notes.join(' ')).toMatch(/Max Barrier/);
  });
});
