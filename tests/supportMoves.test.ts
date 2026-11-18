// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, NpcMon, NpcTeamVariant, StatTable } from '../src/shared/types';
import type { BattleEvent } from '../src/shared/battle';
import { readBattle } from '../src/content/battleReader';
import { fieldFromLog, rateSupport, supportEffect, type SupportContext } from '../src/engine/supportMoves';
import { boxToCalc, npcToCalc } from '../src/engine/damage';
import { NORMAL_RULES } from '../src/engine/rules';
import { adviseTurn } from '../src/engine/turnAdvisor';
import { supportLead } from '../src/engine/teamSuggest';
import { defeatPlan } from '../src/engine/wildDefeat';

const ds = structuredClone(fixture) as unknown as Dataset;
const sp = (n: string) => Object.values(ds.species).find((s) => s.name === n)!;
const mine = (n: string, lv: number, moves: string[]): BoxMon => ({ uid: n, species: sp(n).id, level: lv, moves, source: 'game', nature: 'Hardy' });
const npc = (n: string, lv: number, moves: string[], extra: Partial<NpcMon> = {}): NpcMon => ({ species: sp(n).id, name: n, level: lv, moves, baseStats: sp(n).baseStats, ...extra });
/** Wiki NPC set by name and level (real sets from the fixture). */
const wiki = (n: string, lv: number) => ds.npcs.flatMap((x) => x.variants.flatMap((v) => v.team)).find((m) => m.name === n && m.level === lv)!;
const attacks = (m: BoxMon) => m.moves.filter((id) => ds.moves[id].category !== 'Status');
const ctx = (me: BoxMon, foe: NpcMon, extra: Partial<SupportContext> = {}): SupportContext => ({
  ds, rules: NORMAL_RULES, me: boxToCalc(ds, me), myMoves: attacks(me), foe: npcToCalc(ds, foe), foeName: foe.name, foeMoves: foe.moves, ...extra,
});
const rate = (c: SupportContext, id: string) => rateSupport(c, id)!;

describe('support effects come from the move data', () => {
  it('reads self boosts, target drops and status from the descriptions', () => {
    expect(supportEffect(ds, 'swordsdance')).toEqual({ kind: 'boost', self: { atk: 2 } });
    expect(supportEffect(ds, 'dragondance')).toEqual({ kind: 'boost', self: { atk: 1, spe: 1 } });
    expect(supportEffect(ds, 'quiverdance')).toEqual({ kind: 'boost', self: { spa: 1, spd: 1, spe: 1 } });
    expect(supportEffect(ds, 'shellsmash')).toEqual({ kind: 'boost', self: { def: -1, spd: -1, atk: 2, spa: 2, spe: 2 } });
    expect(supportEffect(ds, 'screech')).toEqual({ kind: 'debuff', target: { def: -2 } });
    expect(supportEffect(ds, 'tickle')).toEqual({ kind: 'debuff', target: { atk: -1, def: -1 } });
    expect(supportEffect(ds, 'thunderwave')).toMatchObject({ kind: 'status', status: 'par', typeImmune: true });
    expect(supportEffect(ds, 'spore')).toMatchObject({ kind: 'status', status: 'slp', powder: true });
    expect(supportEffect(ds, 'yawn')).toMatchObject({ kind: 'status', status: 'slp', yawn: true });
  });

  it('damaging moves count only a sure (100%) effect that helps you', () => {
    expect(supportEffect(ds, 'icywind')).toEqual({ kind: 'debuff', target: { spe: -1 } });
    expect(supportEffect(ds, 'snarl')).toEqual({ kind: 'debuff', target: { spa: -1 } });
    expect(supportEffect(ds, 'nuzzle')).toMatchObject({ kind: 'status', status: 'par' });
    expect(supportEffect(ds, 'poweruppunch')).toEqual({ kind: 'boost', self: { atk: 1 } });
    for (const id of ['bodyslam', 'ancientpower', 'closecombat', 'acid', 'tackle']) expect(supportEffect(ds, id), id).toBeNull();
  });

  it('skips what it does not model: Swagger, Belly Drum, Protect, charge moves', () => {
    for (const id of ['swagger', 'bellydrum', 'protect', 'substitute', 'curse', 'memento', 'geomancy']) expect(supportEffect(ds, id), id).toBeNull();
    // Growth: the plain +1/+1 line (the Sun clause is ignored).
    expect(supportEffect(ds, 'growth')).toEqual({ kind: 'boost', self: { atk: 1, spa: 1 } });
  });

  it('a small table covers screens, weather, Tailwind and hazards', () => {
    expect(supportEffect(ds, 'reflect')).toMatchObject({ kind: 'screen', screen: 'reflect', turns: 5 });
    expect(supportEffect(ds, 'tailwind')).toMatchObject({ kind: 'tailwind', turns: 4 });
    expect(supportEffect(ds, 'raindance')).toMatchObject({ kind: 'weather', weather: 'Rain' });
    expect(supportEffect(ds, 'stealthrock')).toMatchObject({ kind: 'hazard', hazard: 'stealthrock' });
  });

  it('never parses a boost that only lowers your own stats', () => {
    for (const id of Object.keys(ds.moves)) {
      const e = supportEffect(ds, id);
      if (e?.kind === 'boost') expect(Object.values(e.self).some((v) => v! > 0), id).toBe(true);
      if (e?.kind === 'debuff') expect(Object.values(e.target).every((v) => v! < 0), id).toBe(true);
    }
  });
});

describe('plan A (attack now) vs plan B (support move, then attack)', () => {
  it('self boost: Swords Dance turns a lost 1v1 into a win', () => {
    const r = rate(ctx(mine('Machamp', 56, ['swordsdance', 'brickbreak']), wiki('Quagsire', 56)), 'swordsdance');
    expect(r.better).toBe(true);
    expect(r.score!).toBeGreaterThan(r.planA);
    expect(r.reason).toMatch(/^\+2 Atk: you win the 1v1 instead of losing/);
    expect(r.reason).toMatch(/lost if you switch/);
  });

  it('enemy debuff: Screech', () => {
    const r = rate(ctx(mine('Machamp', 29, ['screech', 'brickbreak']), wiki('Victreebel', 29)), 'screech');
    expect(r.better).toBe(true);
    expect(r.reason).toMatch(/^−2 Def: you win the 1v1/);
    expect(r.reason).toMatch(/85% to hit/);
  });

  it('status: a burn halves a physical attacker', () => {
    const r = rate(ctx(mine('Machamp', 54, ['willowisp', 'brickbreak']), wiki('Relicanth', 54)), 'willowisp');
    expect(r.better).toBe(true);
    expect(r.reason).toMatch(/^Burn: you win the 1v1/);
  });

  it('status: sleep gives free hits; a less accurate sleep move scores lower; Yawn waits a turn', () => {
    const golem = wiki('Golem', 55);
    const spore = rate(ctx(mine('Machamp', 55, ['spore', 'brickbreak']), golem), 'spore');
    const hypnosis = rate(ctx(mine('Machamp', 55, ['hypnosis', 'brickbreak']), golem), 'hypnosis');
    const yawn = rate(ctx(mine('Machamp', 55, ['yawn', 'brickbreak']), golem), 'yawn');
    expect(spore.better).toBe(true);
    expect(spore.reason).toMatch(/ends with ~\d+% HP instead of ~\d+%/);
    expect(hypnosis.score!).toBeLessThan(spore.score!);
    expect(hypnosis.reason).toMatch(/60% to hit/);
    expect(yawn.score!).toBeLessThan(spore.score!);
  });

  it('speed: Agility against a faster foe whose Electro Ball depends on speed', () => {
    const r = rate(ctx(mine('Scyther', 24, ['agility', 'xscissor']), wiki('Raichu', 24)), 'agility');
    expect(r.better).toBe(true);
    expect(r.reason).toMatch(/^\+2 Spe: you win the 1v1/);
  });

  it('a damaging move with a sure drop: Icy Wind, then attack with the new speed', () => {
    const r = rate(ctx(mine('Machamp', 29, ['icywind', 'brickbreak']), wiki('Victreebel', 29)), 'icywind');
    expect(r.better).toBe(true);
    expect(r.label).toBe('−1 Spe');
  });

  it('screen: Reflect against a physical attacker', () => {
    const r = rate(ctx(mine('Machamp', 37, ['reflect', 'brickbreak']), npc('Koffing', 37, ['tackle', 'selfdestruct'])), 'reflect');
    expect(r.score!).toBeGreaterThan(r.planA);
    expect(r.reason).toMatch(/^Reflect:/);
  });

  it('weather: Rain Dance weakens their Fire moves', () => {
    const r = rate(ctx(mine('Scyther', 42, ['raindance', 'xscissor']), wiki('Growlithe', 42)), 'raindance');
    expect(r.better).toBe(true);
    expect(r.reason).toMatch(/^Rain: you win the 1v1/);
  });

  it('hazards: Stealth Rock counts the Pokémon still to come', () => {
    const c = ctx(mine('Golem', 40, ['stealthrock', 'rockslide']), npc('Snorlax', 40, ['bodyslam']));
    const zard = { name: 'Charizard', calc: npcToCalc(ds, npc('Charizard', 40, ['flamethrower'])) };
    const r = rate({ ...c, foesLeft: [zard] }, 'stealthrock');
    expect(r.score).not.toBeNull();
    expect(r.reason).toMatch(/50% to Charizard when they come in/);
    expect(rate(c, 'stealthrock').score).toBeNull(); // nobody left to switch in
    expect(rate({ ...c, foesLeft: [zard], field: { mine: {}, theirs: { stealthrock: true } } }, 'stealthrock').reason).toMatch(/already set/);
  });

  it('a move we do not model stays unscored (null rating)', () => {
    expect(rateSupport(ctx(mine('Machamp', 40, ['protect', 'brickbreak']), npc('Snorlax', 40, ['bodyslam'])), 'protect')).toBeNull();
  });

  it('a sure KO now beats any setup', () => {
    const r = rate(ctx(mine('Machamp', 60, ['swordsdance', 'brickbreak']), npc('Snorlax', 20, ['bodyslam'])), 'swordsdance');
    expect(r.better).toBe(false);
    expect(r.score!).toBeLessThan(r.planA);
    expect(r.reason).toMatch(/you can KO it now/);
  });
});

describe('when support moves are not scored', () => {
  const machamp = mine('Machamp', 40, ['thunderwave', 'toxic', 'willowisp', 'swordsdance', 'screech', 'brickbreak']);
  it('type immunity: Thunder Wave on Ground and Electric, Toxic on Steel', () => {
    expect(rate(ctx(machamp, npc('Onix', 40, ['rockthrow'])), 'thunderwave')).toMatchObject({ score: null, reason: expect.stringMatching(/immune to Electric/) });
    expect(rate(ctx(machamp, npc('Jolteon', 40, ['thunderbolt'])), 'thunderwave').reason).toMatch(/Electric types cannot be paralyzed/);
    expect(rate(ctx(machamp, npc('Steelix', 40, ['irontail'])), 'toxic').reason).toMatch(/cannot be poisoned/);
  });

  it('abilities: Insomnia stops sleep, Clear Body stops drops, Magic Bounce reflects', () => {
    expect(rate(ctx(machamp, npc('Snorlax', 40, ['bodyslam'], { ability: 'Insomnia' })), 'toxic').score).not.toBeNull();
    expect(rate(ctx(mine('Breloom', 40, ['spore', 'machpunch']), npc('Snorlax', 40, ['bodyslam'], { ability: 'Insomnia' })), 'spore').reason).toMatch(/Insomnia prevents it/);
    expect(rate(ctx(machamp, npc('Tentacruel', 40, ['surf'], { ability: 'Clear Body' })), 'screech').reason).toMatch(/Clear Body stops stat drops/);
    expect(rate(ctx(machamp, npc('Xatu', 40, ['psychic'], { ability: 'Magic Bounce' })), 'toxic').reason).toMatch(/Magic Bounce/);
  });

  it('the target already has a status', () => {
    const c = ctx(machamp, npc('Snorlax', 40, ['bodyslam']));
    c.foe.status = 'par';
    expect(rate(c, 'willowisp')).toMatchObject({ score: null, reason: expect.stringMatching(/already has a status/) });
  });

  it('stages already at ±6', () => {
    const c = ctx(machamp, npc('Snorlax', 40, ['bodyslam']));
    c.me.boosts.atk = 6;
    expect(rate(c, 'swordsdance').reason).toMatch(/Already at \+6/);
    const d = ctx(machamp, npc('Snorlax', 40, ['bodyslam']));
    d.foe.boosts.def = -6;
    expect(rate(d, 'screech').reason).toMatch(/Already at −6/);
  });

  it('you are slower and their hit KOs you first', () => {
    const c = ctx(machamp, npc('Alakazam', 40, ['psychic']));
    c.me.originalCurHP = 5;
    expect(rate(c, 'swordsdance')).toMatchObject({ score: null, reason: expect.stringMatching(/KO you before you can use it/) });
  });

  it('the NPC is likely to switch: stage drops would be lost (status is kept)', () => {
    const c = { ...ctx(machamp, npc('Snorlax', 40, ['bodyslam'])), npcMaySwitch: true };
    expect(rate(c, 'screech').reason).toMatch(/may switch out/);
    expect(rate(c, 'willowisp').score).not.toBeNull();
  });

  it('Safeguard on their side and Misty Terrain block status', () => {
    const c = ctx(machamp, npc('Snorlax', 40, ['bodyslam']));
    expect(rate({ ...c, field: { mine: {}, theirs: { safeguard: 3 } } }, 'willowisp').reason).toMatch(/Safeguard/);
    expect(rate({ ...c, field: { mine: {}, theirs: {}, misty: 2 } }, 'willowisp').reason).toMatch(/Misty Terrain/);
  });

  it('field state from the log: on turn 6, Reflect from turn 3 is still up, Light Screen from turn 1 is gone', () => {
    const ev = (turn: number, side: 'player' | 'opponent', move: string): BattleEvent => ({ idx: turn, turn, side, mon: 'X', move, stages: { attacker: {}, target: {} } });
    const id = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
    const f = fieldFromLog([ev(3, 'player', 'Reflect'), ev(1, 'player', 'Light Screen'), ev(4, 'opponent', 'Safeguard'), ev(2, 'player', 'Stealth Rock'), ev(4, 'opponent', 'Rain Dance')], 6, id);
    expect(f.mine.reflect).toBe(2);
    expect(f.mine.lightscreen).toBeUndefined();
    expect(f.theirs.safeguard).toBe(3);
    expect(f.theirs.stealthrock).toBe(true);
    expect(f.weather).toEqual({ kind: 'Rain', turns: 3 });
    const c = ctx(mine('Mr. Mime', 40, ['reflect', 'raindance', 'psychic']), npc('Machamp', 40, ['rocktomb']), { field: f });
    expect(rate(c, 'reflect').reason).toMatch(/Reflect is already up/);
    expect(rate(c, 'raindance').reason).toMatch(/Rain is already up/);
  });
});

describe('credit for your later Pokémon', () => {
  const voltorb = mine('Voltorb', 30, ['screech', 'tackle']);
  const onix = npc('Onix', 30, ['rockthrow']);
  const machamp = { name: 'Machamp', calc: boxToCalc(ds, mine('Machamp', 30, ['crosschop'])), moves: ['crosschop'] };

  it('Screech lets Machamp KO in 1 hit instead of 2, so it beats a weak Tackle', () => {
    const alone = rate(ctx(voltorb, onix), 'screech');
    const r = rate(ctx(voltorb, onix, { bench: [machamp] }), 'screech');
    expect(r.reason).toMatch(/lets Machamp KO in 1 hit instead of 2/);
    expect(r.score!).toBeGreaterThan(alone.score!);
    expect(r.score!).toBeGreaterThan(r.planA);
  });

  it('your own boosts give no later credit (lost on switch), and neither does sleep (it wakes up)', () => {
    const sd = ctx(mine('Voltorb', 30, ['swordsdance', 'tackle']), onix);
    expect(rate({ ...sd, bench: [machamp] }, 'swordsdance').score).toBe(rate(sd, 'swordsdance').score);
    const hyp = ctx(mine('Voltorb', 30, ['hypnosis', 'tackle']), onix);
    expect(rate({ ...hyp, bench: [machamp] }, 'hypnosis').score).toBe(rate(hyp, 'hypnosis').score);
  });

  it('boosts do carry on against their next Pokémon while you stay in', () => {
    const c = ctx(mine('Machamp', 56, ['swordsdance', 'brickbreak']), wiki('Quagsire', 56));
    const next = { ...c, foesLeft: [{ name: 'Lapras', calc: npcToCalc(ds, wiki('Lapras', 56)) }] };
    const r = rate(next, 'swordsdance');
    expect(r.score!).toBeGreaterThanOrEqual(rate(c, 'swordsdance').score!);
  });
});

describe('Battle tab, Team tab and Explore', () => {
  document.body.innerHTML = readFileSync(resolve(__dirname, 'fixtures/battle/brock-turn3.reconstructed.html'), 'utf8');
  const snap = readBattle(document, 1)!;
  const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
  const box: BoxMon[] = [{ uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: iv(0) }];
  ds.species[546] ??= { id: 546, name: 'Cottonee', types: ['Grass', 'Fairy'], baseStats: { hp: 40, atk: 27, def: 60, spa: 37, spd: 50, spe: 66 }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };

  it('a status move on a healthy target is scored as a Setup option', () => {
    const a = adviseTurn(ds, { ...snap, opponent: { ...snap.opponent!, status: undefined } }, box);
    const stun = a.actions.find((x) => x.label === 'Stun Spore')!;
    expect(stun.tag).toBe('setup');
    expect(stun.score).not.toBeNull();
    expect(stun.reason).toMatch(/^Paralysis:/);
  });

  it('on the already paralyzed Onix it is not scored, with the reason', () => {
    const stun = adviseTurn(ds, snap, box).actions.find((x) => x.label === 'Stun Spore')!;
    expect(stun.score).toBeNull();
    expect(stun.reason).toMatch(/already has a status/);
  });

  it('Team tab: marks a Pokémon whose support move is worth it against the NPC lead', () => {
    const v: NpcTeamVariant = { label: 'Test', format: 'singles', team: [wiki('Quagsire', 56), wiki('Lapras', 56)], medicines: [] };
    const lead = supportLead(ds, mine('Machamp', 56, ['swordsdance', 'brickbreak']), v);
    expect(lead).toMatchObject({ title: 'Setup lead', moveName: 'Swords Dance' });
    expect(lead!.gain).toBeGreaterThanOrEqual(5);
    expect(supportLead(ds, mine('Machamp', 56, ['brickbreak']), v)).toBeUndefined();
    expect(supportLead(ds, mine('Machamp', 56, ['screech', 'brickbreak']), v)?.title).toBe('Debuff lead');
    expect(supportLead(ds, mine('Machamp', 56, ['swordsdance', 'brickbreak']), { ...v, format: 'doubles' })).toBeUndefined();
  });

  it('Explore Defeat mode lists attacks only, never setup moves', () => {
    const plan = defeatPlan(ds, [mine('Squirtle', 20, ['tackle', 'watergun', 'tailwhip', 'withdraw'])], {
      v: 1, at: 1, view: 'intro', name: 'Geodude', level: 12, shiny: false, balls: [], lead: { name: 'Squirtle', level: 20, hp: 50, maxHp: 50 },
    });
    const labels = plan.options[0].moves.map((m) => m.label);
    expect(labels).toContain('Water Gun');
    expect(labels).not.toContain('Tail Whip');
    expect(labels).not.toContain('Withdraw');
  });
});
