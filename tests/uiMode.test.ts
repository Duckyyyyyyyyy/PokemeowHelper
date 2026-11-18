import { describe, expect, it } from 'vitest';
import { DEFAULT_BOUNDS, isGameUrl, normalizeMode, sanitizeBounds } from '../src/shared/uiMode';

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
