import { describe, expect, it } from 'vitest';
import { DEFAULT_BOUNDS, isGameUrl, normalizeMode, retryNoSw, sanitizeBounds } from '../src/shared/uiMode';

describe('uiMode', () => {
  it('defaults to window', () => {
    expect(normalizeMode(undefined)).toBe('window');
    expect(normalizeMode('junk')).toBe('window');
    expect(normalizeMode('panel')).toBe('panel');
  });
  it('matches only the game host', () => {
    expect(isGameUrl('https://pokemeowrpg.com/')).toBe(true);
    expect(isGameUrl('https://pokemeowrpg.com/battle?x=1')).toBe(true);
    expect(isGameUrl('http://pokemeowrpg.com/')).toBe(false);
    expect(isGameUrl('https://evilpokemeowrpg.com/')).toBe(false);
    expect(isGameUrl('https://pokemeowrpg.com.evil.io/')).toBe(false);
    expect(isGameUrl('https://example.com/pokemeowrpg.com')).toBe(false);
    expect(isGameUrl(undefined)).toBe(false);
    expect(isGameUrl('not a url')).toBe(false);
  });
  it('sanitizes bounds', () => {
    expect(sanitizeBounds(undefined)).toEqual(DEFAULT_BOUNDS);
    expect(sanitizeBounds({ width: 10, height: 99999 })).toEqual({ width: 320, height: 4000 });
    expect(sanitizeBounds({ width: 500, height: 700, left: 100, top: 50 })).toEqual({ width: 500, height: 700, left: 100, top: 50 });
    expect(sanitizeBounds({ width: 500, height: 700, left: -99999, top: 50 })).toEqual({ width: 500, height: 700 });
  });
});

describe('retryNoSw (Chrome "No SW" right after an install or update)', () => {
  const noWait = async () => {};
  it('retries "No SW" until the call works', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error('No SW');
      return 'ok';
    };
    expect(await retryNoSw(fn, 4, 1, noWait)).toBe('ok');
    expect(calls).toBe(3);
  });
  it('gives up after the last try, and never retries other errors', async () => {
    let calls = 0;
    await expect(retryNoSw(async () => { calls++; throw new Error('No SW'); }, 3, 1, noWait)).rejects.toThrow('No SW');
    expect(calls).toBe(3);
    calls = 0;
    await expect(retryNoSw(async () => { calls++; throw new Error('Tabs cannot be edited'); }, 3, 1, noWait)).rejects.toThrow('Tabs');
    expect(calls).toBe(1);
  });
});
