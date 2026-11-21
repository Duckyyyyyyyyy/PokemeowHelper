import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, NpcMon } from '../src/shared/types';
import { boxToCalc, npcToCalc } from '../src/engine/damage';
import { DEEPEN_BELOW, DEEPER_BUDGET, Lookahead, runLookahead, setupScore, squash, type LookInput, type LookMon, type RootValue } from '../src/engine/lookahead';
import { CRIT_TABLE, critInfo, fxNotes, moveFx } from '../src/engine/moveEffects';
import { rateSupport } from '../src/engine/supportMoves';
import { NORMAL_RULES } from '../src/engine/rules';

const ds = structuredClone(fixture) as unknown as Dataset;
const sp = (n: string) => Object.values(ds.species).find((s) => s.name === n)!;
const mine = (n: string, lv: number, moves: string[], extra: Partial<BoxMon> = {}): BoxMon => ({ uid: n, species: sp(n).id, level: lv, moves, source: 'game', nature: 'Hardy', ...extra });
const npc = (n: string, lv: number, moves: string[], extra: Partial<NpcMon> = {}): NpcMon => ({ species: sp(n).id, name: n, level: lv, moves, baseStats: sp(n).baseStats, ...extra });
const wiki = (n: string, lv: number) => ds.npcs.flatMap((x) => x.variants.flatMap((v) => v.team)).find((m) => m.name === n && m.level === lv)!;
const L = (m: BoxMon, hpPct = 100, d = ds): LookMon => {
  const calc = boxToCalc(d, m);
  calc.originalCurHP = Math.max(0, Math.round((calc.maxHP() * hpPct) / 100));
  return { name: d.species[m.species].name, calc, moves: m.moves };
};
const F = (m: NpcMon, d = ds): LookMon => ({ name: m.name, calc: npcToCalc(d, m), moves: m.moves });
const run = (input: Partial<LookInput> & Pick<LookInput, 'mine' | 'foes'>) => runLookahead({ ds, depth: 2, ...input });
const score = (vs: RootValue[], id: string) => vs.find((v) => (v.action.kind === 'move' ? v.action.moveId : `switch:${v.action.to}`) === id)!.score;
const top = (vs: RootValue[]) => [...vs].sort((a, b) => b.score - a.score)[0];
const idOf = (v: RootValue) => (v.action.kind === 'move' ? v.action.moveId : `switch:${v.action.to}`);

describe('lookahead: World Boss hit cut', () => {
  it('foeHitMult cuts their hits everywhere: lower KO odds, setup no worse', () => {
    const quag = wiki('Quagsire', 56);
    const me = () => L(mine('Machamp', 56, ['swordsdance', 'brickbreak']), 15);
    const full = new Lookahead({ ds, mine: [me()], foes: [F(quag)] }).threatOdds();
    const cut = new Lookahead({ ds, mine: [me()], foes: [F(quag)], foeHitMult: 0.45 }).threatOdds();
    expect(full.ko).toBeGreaterThan(0);
    expect(cut.ko).toBeLessThan(full.ko);
    const sdFull = score(run({ mine: [me()], foes: [F(quag)] }).values, 'swordsdance');
    const sdCut = score(run({ mine: [me()], foes: [F(quag)], foeHitMult: 0.45 }).values, 'swordsdance');
    expect(sdCut).toBeGreaterThanOrEqual(sdFull);
  });
});

describe('lookahead: setup', () => {
  const quag = wiki('Quagsire', 56);

  it('picks Swords Dance when it wins in 2 turns and attacking now loses', () => {
    const { values } = run({ mine: [L(mine('Machamp', 56, ['swordsdance', 'brickbreak']))], foes: [F(quag)] });
    expect(idOf(top(values))).toBe('swordsdance');
    expect(score(values, 'swordsdance')).toBeGreaterThanOrEqual(55);
    expect(score(values, 'brickbreak')).toBeLessThan(score(values, 'swordsdance'));
    expect(top(values).line).toMatch(/^Swords Dance → Brick Break/);
  });

  it('does not set up when their hit KOs you during the setup turn', () => {
    const { values } = run({ mine: [L(mine('Machamp', 56, ['swordsdance', 'brickbreak']), 15)], foes: [F(quag)] });
    expect(idOf(top(values))).toBe('brickbreak');
    expect(score(values, 'swordsdance')).toBeLessThan(55);
  });

  it('agrees with the 4a plan-B verdict (better than attacking, or not)', () => {
    const cases: [BoxMon, NpcMon, string][] = [
      [mine('Machamp', 56, ['swordsdance', 'brickbreak']), quag, 'swordsdance'],
      [mine('Machamp', 29, ['screech', 'brickbreak']), wiki('Victreebel', 29), 'screech'],
      [mine('Machamp', 56, ['willowisp', 'brickbreak']), quag, 'willowisp'],
      [mine('Machamp', 55, ['spore', 'brickbreak']), wiki('Golem', 55), 'spore'],
      [mine('Scyther', 24, ['agility', 'xscissor']), wiki('Raichu', 24), 'agility'],
      [mine('Machamp', 60, ['swordsdance', 'brickbreak']), npc('Snorlax', 20, ['bodyslam']), 'swordsdance'],
    ];
    for (const [me, foe, id] of cases) {
      const attacks = me.moves.filter((x) => ds.moves[x].category !== 'Status');
      const r = rateSupport({ ds, rules: NORMAL_RULES, me: boxToCalc(ds, me), myMoves: attacks, foe: npcToCalc(ds, foe), foeName: foe.name, foeMoves: foe.moves }, id)!;
      // As the Battle tab runs it: auto depth (2, or 3 for small trees) and the shared setup rule.
      const { values } = runLookahead({ ds, mine: [L(me)], foes: [F(foe)] });
      const best = Math.max(...attacks.map((a) => score(values, a)));
      const sc = setupScore(score(values, id), best);
      expect(sc.better, `${id} vs ${foe.name}`).toBe(r.better);
      if (sc.better) expect(Math.round(sc.score), `${id} shows above the attack`).toBeGreaterThan(Math.round(best));
      else expect(sc.score, `${id} stays out of the win band`).toBeLessThanOrEqual(Math.min(50, best - 10));
    }
  });

  it('set up now, sweep next turn: the line says it KOs both remaining', () => {
    const weak = npc('Slowpoke', 30, ['tackle']);
    const { values } = run({ mine: [L(mine('Machamp', 56, ['swordsdance', 'brickbreak']))], foes: [F(quag), F(weak)] });
    const sd = values.find((v) => idOf(v) === 'swordsdance')!;
    expect(sd.line).toMatch(/Swords Dance → Brick Break KOs both remaining/);
    expect(sd.score).toBeGreaterThan(score(values, 'brickbreak'));
  });
});

describe('lookahead: switches and your next Pokémon', () => {
  it('switch to absorb a hit: a resisting teammate takes it and wins later', () => {
    // Pikachu can't touch Golem and takes Earthquake; Vaporeon walls it and wins.
    const golem = npc('Golem', 40, ['earthquake', 'rockslide']);
    const { values } = run({ mine: [L(mine('Pikachu', 40, ['thundershock', 'quickattack'])), L(mine('Vaporeon', 40, ['surf']))], foes: [F(golem)] });
    const sw = values.find((v) => idOf(v) === 'switch:1')!;
    expect(idOf(top(values))).toBe('switch:1');
    expect(sw.score).toBeGreaterThanOrEqual(55);
    expect(sw.line).toMatch(/^Switch to Vaporeon → Surf/);
  });

  it('chip now so the next Pokémon KOs: the chip line ranks above Growl and a switch, but stays below 55', () => {
    // A worn-down Pikachu goes down to Gyarados either way; its Thunderbolt lets Snorlax finish after it falls.
    const gyarados = F(npc('Gyarados', 40, ['waterfall']));
    const { values } = run({ mine: [L(mine('Pikachu', 40, ['thunderbolt', 'growl']), 25), L(mine('Snorlax', 40, ['bodyslam']), 30)], foes: [gyarados] });
    const chip = score(values, 'thunderbolt');
    expect(chip).toBeLessThan(55);
    expect(chip).toBeGreaterThan(score(values, 'growl'));
    expect(chip).toBeGreaterThan(score(values, 'switch:1'));
    expect(values.find((v) => idOf(v) === 'thunderbolt')!.line).toMatch(/Snorlax comes in/);
  });
});

describe('critical hits', () => {
  const machamp = boxToCalc(ds, mine('Machamp', 50, ['brickbreak']));
  const foe = npcToCalc(ds, npc('Snorlax', 50, ['bodyslam']));

  it('crit chance by stage: moves, Focus Energy, Super Luck, Scope Lens; Battle Armor blocks; Frost Breath always crits', () => {
    expect(critInfo(ds, machamp, foe, 'brickbreak').chance).toBeCloseTo(1 / 24);
    expect(critInfo(ds, machamp, foe, 'crosschop').chance).toBeCloseTo(1 / 8);
    expect(critInfo(ds, machamp, foe, 'crosschop', true).chance).toBe(1);
    expect(critInfo(ds, machamp, foe, 'brickbreak', true).chance).toBeCloseTo(1 / 2);
    const lucky = machamp.clone();
    lucky.ability = 'Super Luck' as typeof lucky.ability;
    expect(critInfo(ds, lucky, foe, 'brickbreak').chance).toBeCloseTo(1 / 8);
    const lens = machamp.clone();
    lens.item = 'Scope Lens' as typeof lens.item;
    expect(critInfo(ds, lens, foe, 'crosschop').chance).toBeCloseTo(1 / 2);
    const armor = foe.clone();
    armor.ability = 'Battle Armor' as typeof armor.ability;
    expect(critInfo(ds, machamp, armor, 'crosschop').chance).toBe(0);
    expect(critInfo(ds, machamp, foe, 'frostbreath')).toMatchObject({ chance: 1, always: true });
    const sniper = machamp.clone();
    sniper.ability = 'Sniper' as typeof sniper.ability;
    expect(critInfo(ds, sniper, foe, 'brickbreak').mul).toBeCloseTo(CRIT_TABLE.mul * 1.5);
  });

  it('KO odds count a crit: just above the top roll, only a crit KOs (1/24)', () => {
    const me = L(mine('Machamp', 50, ['brickbreak']));
    const snor = F(npc('Snorlax', 50, ['bodyslam']));
    const probe = new Lookahead({ ds, mine: [me], foes: [snor] });
    const d = probe.dist(0, 1, 'brickbreak', [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], '', false)!;
    const top = d.n[d.n.length - 1];
    expect(d.c[0]).toBeGreaterThan(top);
    // Their HP just above your top roll and below your lowest crit.
    snor.calc.originalCurHP = Math.ceil((snor.calc.maxHP() * (top + 0.3)) / 100);
    const eng = new Lookahead({ ds, mine: [me], foes: [snor] });
    const o = eng.hitOdds(0, 'brickbreak')!;
    expect(o.ko).toBeCloseTo(1 / 24, 3);
    expect(o.critKo).toBeCloseTo(1 / 24, 3);
    // With Focus Energy, half the time.
    const fe = new Lookahead({ ds, mine: [me], foes: [snor], focusEnergy: { me: true } });
    expect(fe.hitOdds(0, 'brickbreak')!.ko).toBeCloseTo(1 / 2, 3);
  });

  it('their crit risk on you shows up in threatOdds', () => {
    const me = L(mine('Machamp', 50, ['brickbreak']));
    const snor = F(npc('Snorlax', 50, ['bodyslam']));
    const probe = new Lookahead({ ds, mine: [me], foes: [snor] });
    const d = probe.dist(1, 0, 'bodyslam', [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], '', false)!;
    me.calc.originalCurHP = Math.ceil((me.calc.maxHP() * (d.n[d.n.length - 1] + 0.3)) / 100);
    const t = new Lookahead({ ds, mine: [me], foes: [snor] }).threatOdds();
    expect(t.critKo).toBeGreaterThan(0.03);
    expect(t.ko).toBeCloseTo(t.critKo, 5);
  });
});

describe('secondary effects', () => {
  it('parses flinch, status, Tri Attack, recoil, drain, drops and first-turn moves', () => {
    expect(moveFx(ds, 'firefang')).toMatchObject({ flinch: 0.1, status: [{ status: 'brn', chance: 0.1 }] });
    expect(moveFx(ds, 'bite').flinch).toBeCloseTo(0.3);
    expect(moveFx(ds, 'triattack').status.map((s) => s.status).sort()).toEqual(['brn', 'frz', 'par']);
    expect(moveFx(ds, 'triattack').status[0].chance).toBeCloseTo(0.2 / 3);
    expect(moveFx(ds, 'doubleedge').recoil).toBeCloseTo(0.33);
    expect(moveFx(ds, 'takedown').recoil).toBeCloseTo(0.25);
    expect(moveFx(ds, 'gigadrain').drain).toBeCloseTo(0.5);
    expect(moveFx(ds, 'closecombat').userDrop).toEqual({ def: -1, spd: -1 });
    expect(moveFx(ds, 'crunch').targetDrop).toEqual({ boosts: { def: -1 }, chance: 0.2 });
    expect(moveFx(ds, 'triplearrows')).toMatchObject({ flinch: 0.3, targetDrop: { boosts: { def: -1 }, chance: 0.5 } });
    expect(moveFx(ds, 'fakeout')).toMatchObject({ flinch: 1, firstTurnOnly: true });
    expect(moveFx(ds, 'psybeam').confuse).toBeCloseTo(0.1);
    expect(moveFx(ds, 'poisonsting').status).toEqual([{ status: 'psn', chance: 0.3 }]);
  });

  // Same move with and without its effect text: the difference is the effect's expected value.
  const without = (id: string) => {
    const d = structuredClone(ds);
    d.moves[id] = { ...d.moves[id], description: '' };
    return d;
  };

  it('flinch counts only when you move first', () => {
    const plain = without('headbutt');
    const value = (d: Dataset, myLv: number) => {
      const foe = npc('Electrode', 40, ['tackle']);
      // Same Pokémon, its speed set by level: Lv 60 Persian outspeeds Electrode, a Lv 20 one does not.
      return runLookahead({ ds: d, depth: 2, mine: [L(mine('Persian', myLv, ['headbutt']), 100, d)], foes: [F(foe, d)] }).values[0].score;
    };
    expect(value(ds, 60)).toBeGreaterThan(value(plain, 60));
    expect(value(ds, 20)).toBeCloseTo(value(plain, 20), 6);
  });

  it('a burn chance is worth something against a physical attacker, nothing against a Fire type', () => {
    const plain = without('firepunch');
    const v = (d: Dataset, foe: NpcMon) => runLookahead({ ds: d, depth: 2, mine: [L(mine('Hitmonchan', 40, ['firepunch']), 100, d)], foes: [F(foe, d)] }).values[0].score;
    // (Not Machoke: the fixture's Machoke has Guts, and burning it really is worse.)
    const kanga = npc('Kangaskhan', 40, ['bodyslam']);
    expect(v(ds, kanga)).toBeGreaterThan(v(plain, kanga));
    const magmar = npc('Magmar', 40, ['karatechop']);
    expect(v(ds, magmar)).toBeCloseTo(v(plain, magmar), 6);
  });

  it('reason notes: flinch only when faster, chances, drain and recoil', () => {
    const atk = boxToCalc(ds, mine('Persian', 40, ['bite']));
    const def = npcToCalc(ds, npc('Snorlax', 40, ['bodyslam']));
    expect(fxNotes(ds, 'bite', { atk, def, youFirst: true, dmgPct: 20 })).toContain("30% flinch – you're faster");
    expect(fxNotes(ds, 'bite', { atk, def, youFirst: false, dmgPct: 20 })).toContain('no flinch – they move first');
    expect(fxNotes(ds, 'firefang', { atk, def, youFirst: false, dmgPct: 20 })).toContain('10% burn');
    expect(fxNotes(ds, 'doubleedge', { atk, def, youFirst: true, dmgPct: 30 }).join()).toMatch(/~10% recoil/);
    expect(fxNotes(ds, 'gigadrain', { atk, def, youFirst: true, dmgPct: 30 }).join()).toMatch(/heals ~15%/);
    const fire = npcToCalc(ds, npc('Magmar', 40, ['ember']));
    expect(fxNotes(ds, 'firefang', { atk, def: fire, youFirst: true, dmgPct: 20 }).join()).not.toMatch(/burn/);
  });
});

describe('performance budget', () => {
  const lapras = wiki('Lapras', 54);
  const team = ds.npcs.flatMap((n) => n.variants).find((v) => v.team.includes(lapras))!.team;
  const allFoes = [lapras, ...team.filter((m) => m !== lapras), wiki('Quagsire', 56)].map((m) => F(m));
  const allBench = [
    mine('Snorlax', 55, ['bodyslam', 'earthquake', 'crunch', 'rockslide']),
    mine('Vaporeon', 55, ['surf', 'icebeam', 'bite', 'quickattack']),
    mine('Pikachu', 55, ['thunderbolt', 'quickattack', 'irontail', 'brickbreak']),
    mine('Golem', 55, ['earthquake', 'rockslide', 'explosion', 'tackle']),
    mine('Gengar', 55, ['shadowball', 'sludgebomb', 'thunderbolt', 'psychic']),
  ].map((m) => L(m));
  const me = L(mine('Machamp', 55, ['swordsdance', 'brickbreak', 'crosschop', 'rockslide']));
  /** Best of several runs after a warm-up: the machine's noise only ever adds time. */
  const timed = (input: LookInput) => {
    runLookahead(input);
    let best = Infinity;
    let r!: ReturnType<typeof runLookahead>;
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      r = runLookahead(input);
      best = Math.min(best, performance.now() - t);
    }
    return { r, best };
  };

  it('a full board (4 moves incl. setup, 5 bench, 6 foes) stays at depth 2 and small', () => {
    const { r, best } = timed({ ds, mine: [me, ...allBench], foes: allFoes });
    console.log('full board', { depth: r.depth, nodes: r.engine.nodes, calcs: r.engine.calcs, bestMs: best.toFixed(1) });
    expect(r.depth).toBe(2);
    expect(r.engine.nodes).toBeLessThan(800);
    expect(r.engine.calcs).toBeLessThan(250);
    // ~8 ms alone; the whole suite runs files in parallel, so the time bound is loose (counts are the real check).
    expect(best).toBeLessThan(100);
  });

  it('the worst case is a tree just under the deepening threshold: depth 3 within its budget', () => {
    // 4 moves, 2 bench, 1 foe: ~380 nodes at depth 2, so it goes one turn deeper.
    const { r, best } = timed({ ds, mine: [me, ...allBench.slice(0, 2)], foes: allFoes.slice(0, 1) });
    console.log('near threshold', { depth: r.depth, nodes: r.engine.nodes, calcs: r.engine.calcs, bestMs: best.toFixed(1) });
    expect(r.depth).toBe(3);
    expect(r.engine.nodes).toBeLessThan(DEEPEN_BELOW + DEEPER_BUDGET);
    expect(r.engine.calcs).toBeLessThan(150);
    // Target ~50 ms per turn in the Battle tab: ~25 ms alone, ~50 ms with the whole suite running in parallel.
    expect(best).toBeLessThan(100);
    expect(squash(120)).toBeLessThanOrEqual(100);
  });
});
