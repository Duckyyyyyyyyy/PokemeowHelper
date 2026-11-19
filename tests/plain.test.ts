import { describe, expect, it } from 'vitest';
import { dangerOf, factsLine, factsTag, rate } from '../src/engine/plain';

describe('plain words', () => {
  it('rates scores in words; only the top option reads "Best"', () => {
    expect(rate(99, 99).label).toBe('Best');
    expect(rate(97, 99).label).toBe('Good');
    expect(rate(52, 54).label).toBe('Good'); // near-tie
    expect(rate(90, 99).label).toBe('Good');
    expect(rate(50, 99).label).toBe('OK');
    expect(rate(20, 99).label).toBe('Weak');
    expect(rate(0, 99).label).toBe('Avoid');
    expect(rate(null, 99)).toEqual({ label: 'Not rated', tone: 'none' });
    expect(rate(40, 40).label).toBe('Weak'); // a weak best is still weak
  });

  it('danger: sure KO, possible KO, safe', () => {
    expect(dangerOf({ ko: 'sure' })).toBe('ko');
    expect(dangerOf({ ko: 'chance' })).toBe('watch');
    expect(dangerOf({ koChance: 0.2 })).toBe('watch');
    expect(dangerOf({ critKo: 0.12 })).toBe('watch');
    expect(dangerOf({ koChance: 0.02 })).toBe('safe');
    expect(dangerOf(undefined)).toBe('safe');
  });

  it('facts become short sentences', () => {
    expect(factsLine({ koNow: 'sure', movesFirst: true })).toBe('Knocks it out before it moves');
    expect(factsLine({ koNow: 'sure', movesFirst: false })).toBe('Knocks it out, after their hit');
    expect(factsLine({ hitsToKo: 2, movesFirst: true, accuracy: 95 })).toBe('2 hits to knock it out · 95% to hit');
    expect(factsLine({ movesFirst: true })).toBe('Won’t knock it out');
    expect(factsTag({ koNow: 'chance', movesFirst: true })).toBe('KO?');
    expect(factsTag({ hitsToKo: 3, movesFirst: false })).toBe('3 hits');
  });
});
