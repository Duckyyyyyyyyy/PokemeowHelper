/** WCAG AA (4.5:1) for every text/background pair the theme uses, in light and dark, read from theme.css itself. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WHITE_TEXT_TYPES } from '../src/ui/components/common';

const css = readFileSync(resolve(__dirname, '../src/ui/theme.css'), 'utf8');

function block(re: RegExp): Record<string, string> {
  const m = css.match(re);
  if (!m) throw new Error(`token block not found: ${re}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[k] = v;
  return out;
}
const light = block(/^:root \{([\s\S]*?)\n\}/m);
const dark = { ...light, ...block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/) };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'bg'],
  ['link', 'surface'], ['link', 'surface-2'], ['link', 'bg'], ['on-accent', 'accent'],
  ['good', 'good-soft'], ['warn', 'warn-soft'], ['bad', 'bad-soft'], ['good', 'surface'], ['bad', 'surface'], ['warn', 'surface'],
  ['text', 'good-soft'], ['text', 'warn-soft'], ['text', 'bad-soft'], ['text', 'accent-soft'], ['muted', 'accent-soft'],
  ['surface', 'link'], ['surface', 'good'], ['bg', 'text'], ['hud-text', 'hud'], ['hud-muted', 'hud'],
];

describe('theme contrast (WCAG AA)', () => {
  for (const [name, t] of [['light', light], ['dark', dark]] as const) {
    it(`${name}: every text/background pair is at least 4.5:1`, () => {
      const bad = PAIRS.map(([f, b]) => [f, b, ratio(t[f], t[b])] as const).filter(([, , r]) => r < 4.5);
      expect(bad.map(([f, b, r]) => `${f} on ${b}: ${r.toFixed(2)}`)).toEqual([]);
    });
  }
  it('type badges: dark or white text, whichever the colour needs, at least 4.5:1', () => {
    const fails: string[] = [];
    for (const [k, hex] of Object.entries(light).filter(([k]) => k.startsWith('t-'))) {
      const type = k.slice(2).replace(/^./, (c) => c.toUpperCase());
      const fg = WHITE_TEXT_TYPES.has(type) ? '#FFFFFF' : '#10141F';
      const r = ratio(fg, hex);
      if (r < 4.5) fails.push(`${type} ${r.toFixed(2)}`);
    }
    expect(Object.keys(light).filter((k) => k.startsWith('t-')).length).toBe(18);
    expect(fails).toEqual([]);
  });
});
