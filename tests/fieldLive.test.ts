// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readField } from '../src/content/battleReader';

// Real field status read live on 2026-11-22 (Gym battle vs Koga, Rain from Drizzle).
// The button has no aria-label: its text is the label ("Rain"), title "About rain"; no turns are shown.
describe('battle reader: live field status (Rain)', () => {
  it('reads Rain from the field button next to the turn counter', () => {
    document.body.innerHTML = readFileSync('tests/fixtures/battle/field-rain.live.html', 'utf8');
    const arena = document.querySelector('.battle-arena')!;
    expect(readField(arena)).toEqual({ weather: 'Rain', labels: ['Rain'] });
  });

  it('falls back to the weather layer when the button is missing', () => {
    document.body.innerHTML = readFileSync('tests/fixtures/battle/field-rain.live.html', 'utf8');
    document.querySelector('.battle-field-status')!.remove();
    expect(readField(document.querySelector('.battle-arena')!)).toEqual({ weather: 'Rain' });
  });
});
