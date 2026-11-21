import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, NpcMon } from '../src/shared/types';
import { boxToShowdown, npcToShowdown, toShowdownSet, toShowdownTeam } from '../src/engine/showdownExport';

const ds = structuredClone(fixture) as unknown as Dataset;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const all = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });

describe('Showdown export', () => {
  it('box mon with mixed IVs/EVs, item, gender, shiny', () => {
    const b: BoxMon = {
      uid: 'a', species: sp('Geodude'), level: 40, source: 'game', gender: 'F', shiny: true, item: 'sitrusberry', ability: 'Sturdy', nature: 'adamant',
      moves: ['absorb', 'acid'], evs: { hp: 44, atk: 37, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { ...all(31), hp: 15, atk: 28 },
    };
    expect(toShowdownSet(boxToShowdown(ds, b))).toBe([
      `Geodude (F) @ ${ds.items.sitrusberry.name}`, 'Ability: Sturdy', 'Level: 40', 'Shiny: Yes', 'EVs: 44 HP / 37 Atk', 'Adamant Nature', 'IVs: 15 HP / 28 Atk',
      `- ${ds.moves.absorb.name}`, `- ${ds.moves.acid.name}`,
    ].join('\n'));
  });

  it('NPC with perfect IVs and zero EVs has no IV/EV lines; unknown ability and nature are left out', () => {
    const n: NpcMon = { species: sp('Geodude'), name: 'Geodude', level: 12, gender: 'N', moves: ['absorb'], item: null, baseStats: all(50), ivs: all(31), evs: all(0) };
    const t = toShowdownSet(npcToShowdown(ds, n));
    expect(t).toBe(`Geodude\nLevel: 12\n- ${ds.moves.absorb.name}`);
    expect(t).not.toMatch(/EVs|IVs|Ability|Nature|\(/);
  });

  it('manual box mon without IVs is assumed 15, and the team is blank-line separated', () => {
    const b: BoxMon = { uid: 'm', species: sp('Geodude'), moves: [], source: 'manual' };
    const s = boxToShowdown(ds, b);
    expect(toShowdownSet(s)).toContain('IVs: 15 HP / 15 Atk / 15 Def / 15 SpA / 15 SpD / 15 Spe');
    expect(toShowdownTeam([s, s]).split('\n\n')).toHaveLength(2);
  });
});
