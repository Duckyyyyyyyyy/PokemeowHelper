// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWild } from '../src/content/wildReader';

// Real wild battle read live on 2026-11-22 (battle view is data-view="menu"; both combatants are .battle-partner).
describe('wild reader: live battle view (Palpitoad, The Blue Sea 4)', () => {
  it('reads the wild Pokémon, your lead and your moves', () => {
    document.body.innerHTML = readFileSync('tests/fixtures/explore/wild-battle-palpitoad.html', 'utf8');
    const w = readWild(document, 0)!;
    expect(w).toMatchObject({
      view: 'menu', map: 'The Blue Sea 4', name: 'Palpitoad', gender: 'F', level: 37, rarity: 'Rare',
      shiny: false, registered: true, inBox: 1, hp: 32, maxHp: 108,
      lead: { name: 'Alakazam', level: 55, hp: 139, maxHp: 139, gender: 'M' },
    });
    expect(w.status).toBeUndefined();
    expect(w.moves?.map((m) => [m.name, m.pp, m.maxPp, m.disabled])).toEqual([
      ['Teleport', 20, 20, false], ['Psybeam', 20, 20, false], ['Psycho Cut', 19, 20, false], ['Future Sight', 10, 10, false],
    ]);
    expect(w.moves?.[2]).toMatchObject({ type: 'Psychic', category: 'Physical', power: 70, accuracy: 100 });
  });
});
