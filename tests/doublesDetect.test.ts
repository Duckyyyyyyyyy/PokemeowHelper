// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readBattle } from '../src/content/battleReader';
import { doublesReason, type BattleEvent, type BattleSnapshot } from '../src/shared/battle';

const html = readFileSync(resolve(__dirname, 'fixtures/battle/brock-turn3.reconstructed.html'), 'utf8');
const load = (markup: string) => {
  document.body.innerHTML = markup;
  return document;
};
const singles = () => readBattle(load(html), 1)!;
const ev = (turn: number, side: 'player' | 'opponent', mon: string, idx: number): BattleEvent => ({ idx, turn, side, mon, move: 'Tackle', stages: { attacker: {}, target: {} } });

describe('doubles detection (safety gate)', () => {
  it('a real singles battle is not doubles (singles regression)', () => {
    const snap = singles();
    expect(snap.sides).toEqual({ player: 1, opponent: 1 });
    expect(doublesReason(snap, 'singles')).toBeNull();
    expect(doublesReason(snap)).toBeNull();
  });

  it('the arena format attribute', () => {
    const snap = readBattle(load(html.replace('data-kind="gym"', 'data-kind="gym" data-format="doubles"')), 1)!;
    expect(doublesReason(snap)).toMatch(/format/);
    expect(doublesReason({ ...snap, format: 'singles' })).toBeNull();
  });

  it('two stat boxes on one side', () => {
    const doc = load(html);
    const box = doc.querySelector('.battle-opponent-stats')!;
    box.parentElement!.appendChild(box.cloneNode(true));
    const snap = readBattle(doc, 1)!;
    expect(snap.sides).toEqual({ player: 1, opponent: 2 });
    expect(doublesReason(snap)).toMatch(/two Pokémon are on the field/);
  });

  it('two active Pokémon on the switch cards or the opponent roster', () => {
    const snap = singles();
    const bench = snap.bench.map((b, i) => ({ ...b, active: i < 2, fainted: false }));
    expect(doublesReason({ ...snap, bench })).toMatch(/your Pokémon/);
    const opponentTeam = [{ name: 'Geodude', active: true, fainted: false }, { name: 'Onix', active: true, fainted: false }];
    expect(doublesReason({ ...snap, opponentTeam })).toMatch(/their Pokémon/);
    // A fainted card still marked active does not count.
    expect(doublesReason({ ...snap, opponentTeam: [opponentTeam[0], { ...opponentTeam[1], fainted: true }] })).toBeNull();
  });

  it('the NPC team format from the wiki', () => {
    expect(doublesReason(singles(), 'doubles')).toMatch(/wiki/);
  });

  it('the log: two Pokémon of one side moving in the same turn, at least twice', () => {
    const base: BattleSnapshot = { ...singles(), events: [] };
    const once = [ev(1, 'opponent', 'Solrock', 0), ev(1, 'opponent', 'Lunatone', 1), ev(2, 'opponent', 'Solrock', 2)];
    expect(doublesReason({ ...base, events: once })).toBeNull();
    const twice = [...once, ev(2, 'opponent', 'Lunatone', 3)];
    expect(doublesReason({ ...base, events: twice })).toMatch(/battle log/);
    // One Pokémon per side per turn is singles.
    expect(doublesReason({ ...base, events: [ev(1, 'player', 'A', 0), ev(1, 'opponent', 'B', 1), ev(2, 'player', 'A', 2), ev(2, 'opponent', 'C', 3)] })).toBeNull();
  });
});
