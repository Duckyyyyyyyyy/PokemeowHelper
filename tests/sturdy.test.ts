import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset, NpcTeamVariant } from '../src/shared/types';
import { parseLog } from '../src/content/battleReader';
import { boxToCalc, duel, holdsOn, makeField, npcToCalc } from '../src/engine/damage';
import { checkEvent } from '../src/engine/damageCheck';
import { Lookahead } from '../src/engine/lookahead';
import { factsLine } from '../src/engine/plain';
import { battleRulesFor, dsFor } from '../src/engine/rules';
import { suggestTeam } from '../src/engine/teamSuggest';
import { adviseTurn } from '../src/engine/turnAdvisor';

// Seen live 2026-11-25, Brock rematch: Leaf Blade did 203 to a full-HP Golem (Sturdy), "Brock's Golem endured the hit!",
// its Sitrus Berry gave back 51 HP, and its Rock Slide did 152 to Farfetch'd.
const ds = structuredClone(fixture) as unknown as Dataset;
const iv = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const mon = (uid: string, species: number, level: number, moves: string[], extra: Partial<BoxMon> = {}): BoxMon => ({ uid: `game:${uid}`, gameId: uid, source: 'game', species, level, moves, nature: 'Hardy', ivs: iv(15), evs: iv(0), ...extra });
const farfetchd = (ability = 'Keen Eye') => mon('1', 83, 100, ['falseswipe', 'airslash', 'leafblade', 'furycutter'], { ability });
const blastoise = mon('2', 9, 68, ['hydropump', 'bite'], { ability: 'Torrent' });
const brock = ds.npcs.find((n) => n.name === 'Brock')!.variants.find((v) => v.label === 'Rematch')!;
const golem = brock.team[0];

const at = (hpPct: number): BattleSnapshot => ({
  v: 2, at: 0, status: 'active', kind: 'gym', opponentName: 'Brock', turn: 1,
  player: { name: 'Farfetch’d', level: 100, hp: 257, maxHp: 257 },
  opponent: { name: 'Golem', level: 55, item: 'Sitrus Berry', hpPct },
  moves: ['Leaf Blade', 'Air Slash'].map((name) => ({ name, pp: 15, maxPp: 15, disabled: false })),
  bench: [
    { name: 'Farfetch’d', level: 100, hp: 257, maxHp: 257, active: true, fainted: false },
    { name: 'Blastoise', level: 68, hp: 203, maxHp: 203, active: false, fainted: false },
  ],
  opponentTeam: [{ name: 'Golem', level: 55, hpPct, active: true, fainted: false }],
  boosts: { player: {}, opponent: {} }, log: [], events: [],
});
const leaf = (hpPct: number, me = farfetchd()) => adviseTurn(ds, at(hpPct), [me, blastoise]).actions.find((a) => a.label === 'Leaf Blade')!;

describe('Sturdy: survives one hit from full HP', () => {
  it('no KO promise at full HP, and the reason says why', () => {
    const a = leaf(100);
    expect(a.ko).toBeUndefined();
    expect(a.koChance ?? 0).toBe(0);
    expect(a.reason).toMatch(/Golem holds on at 1 HP \(Sturdy\)/);
    expect(a.reason).not.toMatch(/KOs now/);
    expect(factsLine(a.facts!)).toBe('2 hits to knock it out (Sturdy leaves it at 1 HP)');
    expect(factsLine(leaf(26).facts!)).not.toMatch(/Sturdy/);
  });

  it('below full HP it falls as before', () => {
    expect(leaf(26).ko).toBe('sure');
    expect(leaf(26).reason).toMatch(/KOs now/);
  });

  it('Mold Breaker ignores it', () => {
    expect(leaf(100, farfetchd('Mold Breaker')).ko).toBe('sure');
  });

  it('the search leaves it at 1 HP: it still gets its hit', () => {
    const look = (ability: string, pct = 100) => {
      const calc = npcToCalc(ds, { ...golem, ability });
      calc.originalCurHP = Math.round((calc.maxHP() * pct) / 100);
      return new Lookahead({ ds, mine: [{ name: 'Farfetch’d', calc: boxToCalc(ds, farfetchd()), moves: ['leafblade'] }], foes: [{ name: 'Golem', calc, moves: golem.moves }] });
    };
    expect(look('Sturdy').hitOdds(0, 'leafblade')!.ko).toBe(0);
    expect(look('Rock Head').hitOdds(0, 'leafblade')!.ko).toBe(1);
    expect(look('Sturdy', 26).hitOdds(0, 'leafblade')!.ko).toBe(1); // only from full HP
    expect(look('Sturdy').run(2)[0].rank).toBeLessThan(look('Rock Head').run(2)[0].rank - 5);
  });
});

describe('Sturdy in the 1v1 projection (Pokémon still to come)', () => {
  // The first foe has no attack and falls on turn 1; the second duel is only projected.
  const easy = () => ({ name: 'Pikachu', calc: npcToCalc(ds, { species: 25, name: 'Pikachu', level: 5, moves: [], baseStats: ds.species[25].baseStats }), moves: [] as string[] });
  it('theirs: the next one takes two hits', () => {
    const rank = (ability: string) => new Lookahead({
      ds, mine: [{ name: 'Farfetch’d', calc: boxToCalc(ds, farfetchd()), moves: ['leafblade'] }],
      foes: [easy(), { name: 'Golem', calc: npcToCalc(ds, { ...golem, ability }), moves: golem.moves }],
    }).run(1)[0].rank;
    expect(rank('Sturdy')).toBeLessThan(rank('Rock Head') - 5);
  });
  it('yours: it gets one more hit in', () => {
    const me = (ability: string) => boxToCalc(ds, mon('3', 74, 40, ['rockthrow'], { ability })); // Geodude
    const rank = (ability: string) => new Lookahead({
      ds, mine: [{ name: 'Geodude', calc: me(ability), moves: ['rockthrow'] }],
      foes: [easy(), { name: 'Blastoise', calc: npcToCalc(ds, { species: 9, name: 'Blastoise', level: 70, moves: ['hydropump'], baseStats: ds.species[9].baseStats }), moves: ['hydropump'] }],
    }).run(1)[0].rank;
    expect(rank('Sturdy')).toBeGreaterThan(rank('Rock Head'));
  });
});

describe('your own Sturdy', () => {
  const geodude = (ability: string) => mon('3', 74, 40, ['rockthrow'], { ability });
  const snap = (hp: number, forced = false): BattleSnapshot => ({
    v: 2, at: 0, status: 'active', opponentName: 'Someone', turn: 1,
    player: forced ? { name: 'Farfetch’d', level: 100, hp: 0, maxHp: 257 } : { name: 'Geodude', level: 40, hp, maxHp: 100 },
    opponent: { name: 'Blastoise', level: 70, hpPct: 100 },
    moves: forced ? [] : [{ name: 'Rock Throw', pp: 15, maxPp: 15, disabled: false }],
    bench: [
      ...(forced ? [{ name: 'Farfetch’d', level: 100, hp: 0, maxHp: 257, active: true, fainted: true }] : []),
      { name: 'Geodude', level: 40, hp, maxHp: 100, active: !forced, fainted: false },
    ],
    opponentTeam: [{ name: 'Blastoise', level: 70, hpPct: 100, active: true, fainted: false }],
    boosts: { player: {}, opponent: {} }, log: [], forcedSwitch: forced || undefined,
    events: [{ idx: 1, turn: 0, side: 'opponent', mon: 'Blastoise', move: 'Hydro Pump', stages: { attacker: {}, target: {} } }],
  });
  const advise = (hp: number, ability: string, forced = false) => adviseTurn(ds, snap(hp, forced), [geodude(ability), farfetchd()]);
  it('full HP: their hit is no KO; hurt, it is', () => {
    expect(advise(100, 'Rock Head').threat!.ko).toBe('sure');
    expect(advise(100, 'Sturdy').threat!.ko).toBeUndefined();
    expect(advise(60, 'Sturdy').threat!.ko).toBe('sure');
  });
  it('the same for a Pokémon you send in', () => {
    const ko = (ability: string) => advise(100, ability, true).actions.find((a) => a.label === 'Send in Geodude')!.threat!.ko;
    expect(ko('Rock Head')).toBe('sure');
    expect(ko('Sturdy')).toBeUndefined();
  });
});

describe('who holds on', () => {
  const me = boxToCalc(ds, farfetchd());
  const foe = (over: object) => npcToCalc(ds, { ...golem, ...over });
  it('Sturdy or Focus Sash, not through several hits, not in Gen III', () => {
    expect(holdsOn(ds, me, foe({}), 'leafblade')).toBe('Sturdy');
    expect(holdsOn(ds, me, foe({ ability: 'Rock Head', item: 'focussash' }), 'leafblade')).toBe('Focus Sash');
    expect(holdsOn(ds, me, foe({ ability: 'Rock Head' }), 'leafblade')).toBeUndefined();
    expect(holdsOn(ds, me, foe({}), 'doublekick')).toBeUndefined();
    const g3 = dsFor(ds, battleRulesFor(undefined, undefined, true));
    const old = npcToCalc(g3, golem); // (its Gen III ability is picked from the species: force Sturdy)
    old.ability = 'Sturdy' as typeof old.ability;
    expect(holdsOn(g3, boxToCalc(g3, farfetchd()), old, 'slash')).toBeUndefined();
  });
});

describe('Prep: the lead', () => {
  it('the duel counts the hit Golem gets back', () => {
    const d = duel(ds, boxToCalc(ds, farfetchd()), farfetchd().moves, npcToCalc(ds, golem), golem.moves, makeField('singles'));
    expect(d.win).toBe(true);
    expect(d.hpLeftPct).toBeLessThan(50);
  });

  it('the duel gives your own Sturdy its extra turn', () => {
    const foe = npcToCalc(ds, { species: 9, name: 'Blastoise', level: 70, moves: ['hydropump'], baseStats: ds.species[9].baseStats });
    const d = (ability: string) => duel(ds, boxToCalc(ds, mon('3', 74, 40, ['rockthrow'], { ability })), ['rockthrow'], foe, ['hydropump'], makeField('singles')).score;
    expect(d('Sturdy')).toBeGreaterThan(d('Rock Head'));
  });

  it('Brock rematch: Blastoise leads, it takes the smaller hit', () => {
    expect(suggestTeam(ds, [farfetchd(), blastoise], brock).lead!.mon.uid).toBe('game:2');
  });

  it('a tie on score: the one that would take less leads, whatever the order', () => {
    const v: NpcTeamVariant = { label: 'x', format: 'singles', medicines: [], team: [{ ...golem, ability: 'Rock Head' }] };
    for (const box of [[farfetchd(), blastoise], [blastoise, farfetchd()]]) {
      const s = suggestTeam(ds, box, v);
      expect(s.team.map((c) => c.pairs[0].score)).toEqual([100, 100]);
      expect(s.lead!.mon.uid).toBe('game:2');
    }
  });
});

describe('Prep: the lead, same hit taken', () => {
  it('the more accurate move leads', () => {
    const v: NpcTeamVariant = { label: 'x', format: 'singles', medicines: [], team: [{ ...golem, ability: 'Rock Head' }] };
    const pump = mon('2', 9, 68, ['hydropump'], { ability: 'Torrent' });
    const surf = mon('4', 9, 68, ['surf'], { ability: 'Torrent' });
    for (const box of [[pump, surf], [surf, pump]]) expect(suggestTeam(ds, box, v).lead!.mon.uid).toBe('game:4');
  });
});

describe('damage check', () => {
  it('a hit that was endured is not compared with the damage range', () => {
    const { events } = parseLog([
      { text: 'Farfetch’d used Leaf Blade! It\'s super effective! It dealt 203 damage.', turn: 1 },
      { text: 'Brock’s Golem endured the hit!', turn: 1 },
      { text: 'Brock’s Golem used or lost its Sitrus Berry.', turn: 1 },
    ], 'Brock');
    const ev = { ...events[0], side: 'player' as const, mon: 'Farfetch’d', target: 'Golem' };
    expect(ev.damage).toBe(203);
    expect(checkEvent(ds, [farfetchd()], at(100), ev)).toBeNull();
  });
});
