// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from './fixtures/wiki-mini.json';
import type { BattleEvent } from '../src/shared/battle';
import type { BoxMon, Dataset } from '../src/shared/types';
import { readBattle } from '../src/content/battleReader';
import { adviseTurn, applyState } from '../src/engine/turnAdvisor';
import { checkEvent } from '../src/engine/damageCheck';
import { npcToCalc } from '../src/engine/damage';
import { matchNpc } from '../src/engine/turnAdvisor';

// Since 2026-11-25 the game shows opponents' HP only as a bar ("57% HP"); numbers only on your side.
const html = readFileSync(resolve(__dirname, 'fixtures/battle/brock-rematch-hp-bar.reconstructed.html'), 'utf8');
const load = (h: string) => { document.body.innerHTML = h; return readBattle(document, 1)!; };
const ds = structuredClone(fixture) as unknown as Dataset;
const iv = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const snorlax: BoxMon = { uid: 'game:1', gameId: '1', source: 'game', species: 143, level: 70, moves: ['bodyslam', 'crunch'], nature: 'Hardy', ability: 'Thick Fat', ivs: iv(15), evs: iv(0) };

describe('opponent HP shown only as a bar', () => {
  const snap = load(html);

  it('reads the percent, never fake HP numbers, and your own HP as before', () => {
    expect(snap.opponent).toMatchObject({ name: 'Golem', level: 55, hpPct: 57 });
    expect(snap.opponent!.hp).toBeUndefined();
    expect(snap.opponent!.maxHp).toBeUndefined();
    expect(snap.player).toMatchObject({ hp: 329, maxHp: 329 });
    expect(snap.player!.hpPct).toBeUndefined();
  });

  it('reads the roster rows, and a fainted one is at 0 HP', () => {
    expect(snap.opponentTeam).toEqual([
      { name: 'Golem', level: 55, hpPct: 57, active: true, fainted: false },
      { name: 'Relicanth', level: 54, hpPct: 100, active: false, fainted: false },
      { name: 'Onix', level: 61, hp: 0, hpPct: 0, active: false, fainted: true },
    ]);
  });

  it('a bar rounded to 0% is still alive until the fainted badge shows', () => {
    const low = load(html.replace(/aria-valuenow="57" aria-valuetext="57% HP"/g, 'aria-valuenow="0" aria-valuetext="0% HP"'));
    expect(low.opponent!.hp).toBeUndefined();
    const golem = npcToCalc(ds, matchNpc(ds, low)!.variant.team[0]);
    expect(applyState(golem, low.opponent!).curHP()).toBe(1);
  });

  it('the advice counts hits from that HP, not from full', () => {
    const hits = (s: typeof snap) => adviseTurn(ds, s, [snorlax]).actions.find((a) => a.label === 'Crunch')!.facts!.hitsToKo!;
    expect(hits(snap)).toBeLessThan(hits({ ...snap, opponent: { ...snap.opponent!, hpPct: 100 } }));
  });

  it('the calc check still judges hits: no set mismatch, a KO hit counts as cut at its HP', () => {
    const ev: BattleEvent = { idx: 9, turn: 4, side: 'player', mon: 'Snorlax', move: 'Crunch', target: 'Golem', damage: 3, targetFainted: true, stages: { attacker: {}, target: {} } };
    const c = checkEvent(ds, [snorlax], { ...snap, opponent: { ...snap.opponent!, hpPct: 1 } }, ev)!;
    expect(c).toMatchObject({ capped: true, verdict: 'ok' });
    const full = checkEvent(ds, [snorlax], snap, { ...ev, damage: c.lo, targetFainted: false })!;
    expect(full.verdict).toBe('ok');
  });
});
