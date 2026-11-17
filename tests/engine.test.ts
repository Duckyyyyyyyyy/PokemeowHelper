import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { effectiveness, typeEffectiveness } from '../src/engine/typeChart';
import { bestAttackTypes, bestDefensiveTypes, npcThreats, teamNotes } from '../src/engine/analysis';
import { scorePair, suggestTeam } from '../src/engine/teamSuggest';
import { parseDataModule } from '../src/data/literalParser';

const ds = fixture as unknown as Dataset;
const npc = (id: string) => ds.npcs.find((n) => n.id === id)!;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const box = (name: string, moves: string[] = [], level?: number): BoxMon => ({ uid: name, species: sp(name), moves, level });

describe('literal parser', () => {
  it('reads literal data without executing it', () => {
    const v = parseDataModule('const e={a:!0,b:!1,c:-1,d:`x`,e:[1,"s",null],"f-g":5e-4};export{e as default};');
    expect(v).toEqual({ a: true, b: false, c: -1, d: 'x', e: [1, 's', null], 'f-g': 0.0005 });
  });
  it('refuses code', () => {
    expect(() => parseDataModule('const e={a:alert(1)};')).toThrow();
    expect(() => parseDataModule('const e={a:`${x}`};')).toThrow();
    expect(() => parseDataModule('const e={[k]:1};')).toThrow();
  });
});

describe('type chart (game data)', () => {
  it('matches known matchups', () => {
    expect(typeEffectiveness(ds.types, 'Water', ['Rock', 'Ground'])).toBe(4);
    expect(typeEffectiveness(ds.types, 'Ground', ['Flying'])).toBe(0);
    expect(typeEffectiveness(ds.types, 'Ice', ['Dragon', 'Flying'])).toBe(4);
    expect(typeEffectiveness(ds.types, 'Fire', ['Water', 'Rock'])).toBe(0.25);
  });
  it('applies certain abilities only', () => {
    expect(effectiveness(ds.types, 'Ground', ['Ghost', 'Poison'], ['Levitate'])).toBe(0);
    // Uncertain ability (one of two) → no immunity assumed
    expect(effectiveness(ds.types, 'Ground', ['Ghost', 'Poison'], ['Levitate', 'Cursed Body'])).toBe(2);
  });
});

describe('normalized NPC data', () => {
  it('keeps full sets for gym teams', () => {
    const brock = npc('challenge:brock');
    expect(brock.levelCap).toBe(19);
    expect(brock.variants.map((v) => v.label)).toEqual(['First battle', 'Rematch']);
    const geodude = brock.variants[0].team[0];
    expect(geodude).toMatchObject({ name: 'Geodude', level: 12, ability: 'Rock Head', nature: 'Hardy' });
    expect(geodude.moves).toHaveLength(4);
  });
  it('handles every source shape', () => {
    const cats = new Set(ds.npcs.map((n) => n.category));
    for (const c of ['gym', 'elite-four', 'champion', 'tower', 'frontier', 'mega', 'rival', 'rocket', 'boss']) expect(cats).toContain(c);
    const brain = npc('frontier:tower');
    expect(brain.variants.map((v) => v.label)).toEqual(['Silver', 'Gold']);
    expect(brain.variants[0].team[0].possibleAbilities?.length).toBeGreaterThan(1);
    expect(npc('challenge:hoenn-tateandliza').variants[0].format).toBe('doubles');
    const boss = ds.npcs.find((n) => n.category === 'boss')!;
    expect(boss.variants[0].team[0].moves.every((m) => typeof m === 'string')).toBe(true);
  });
  it('every NPC move id resolves to a move', () => {
    const missing = ds.npcs.flatMap((n) => n.variants.flatMap((v) => v.team.flatMap((m) => m.moves.filter((id) => !ds.moves[id]))));
    expect(missing).toEqual([]);
  });
});

describe('analysis', () => {
  it('Brock is weak to Water/Grass/Fighting/Ground/Steel', () => {
    const top = bestAttackTypes(ds, npc('challenge:brock').variants[0]).slice(0, 5).map((t) => t.type);
    expect(top).toEqual(expect.arrayContaining(['Water', 'Grass']));
    expect(top).not.toContain('Fire');
  });
  it('lists threats and notes', () => {
    const v = npc('challenge:brock').variants[0];
    expect(npcThreats(ds, v).length).toBeGreaterThan(0);
    expect(bestDefensiveTypes(ds, v)[0].score).toBeGreaterThan(0);
    expect(Array.isArray(teamNotes(ds, v))).toBe(true);
  });
});

describe('team suggestion', () => {
  it('prefers a Water type vs Brock over a Fire type', () => {
    const v = npc('challenge:brock').variants[0];
    const water = scorePair(ds, box('Squirtle'), v.team[0]);
    const fire = scorePair(ds, box('Charmander'), v.team[0]);
    expect(water.score).toBeGreaterThan(fire.score);
  });
  it('respects level cap and team size', () => {
    const v = npc('challenge:brock').variants[0];
    const res = suggestTeam(ds, [box('Squirtle', [], 15), box('Bulbasaur', [], 25), box('Charmander', [], 10), box('Pikachu', [], 12)], v, { levelCap: 19, size: 2 });
    expect(res.team.length).toBe(2);
    expect(res.team.map((c) => ds.species[c.mon.species].name)).not.toContain('Bulbasaur');
    expect(res.ranked.find((c) => ds.species[c.mon.species].name === 'Bulbasaur')!.eligible).toBe(false);
    expect(res.team[0].mon.uid).toBe('Squirtle');
  });
  it('fills the team to size even when one Pokémon already covers every NPC Pokémon', () => {
    const v = npc('challenge:blaine').variants[0]; // all Fire
    const mons = ['Squirtle', 'Geodude', 'Pidgey', 'Rattata', 'Pikachu', 'Caterpie', 'Ekans', 'Zubat'].map((n) => box(n, [], 15));
    const res = suggestTeam(ds, mons, v);
    expect(res.team.length).toBe(6);
    expect(new Set(res.team.map((c) => c.mon.uid)).size).toBe(6);
  });
  it('rematch teams have no level cap (wiki: League Rematches)', () => {
    const brock = npc('challenge:brock');
    expect(brock.variants[0].levelCap).toBe(19);
    expect(brock.variants[1].levelCap).toBeUndefined();
    const res = suggestTeam(ds, [box('Squirtle', [], 60), box('Bulbasaur', [], 70)], brock.variants[1], { levelCap: brock.variants[1].levelCap });
    expect(res.ranked.every((c) => c.eligible)).toBe(true);
    expect(res.team.length).toBeGreaterThan(0);
  });
  it('keeps STAB options when fewer than 4 moves are entered', () => {
    const v = npc('challenge:brock').variants[0];
    const r = scorePair(ds, box('Lapras', ['icebeam']), v.team[0]); // Geodude: Water ×4
    expect(r.bestHit.option?.type).toBe('Water');
    expect(r.bestHit.mult).toBe(4);
  });
  it('uses your synced ability for incoming moves (Levitate vs Ground)', () => {
    const v = npc('challenge:giovanni').variants[0];
    const groundUser = v.team.find((m) => m.moves.some((id) => ds.moves[id]?.type === 'Ground' && ds.moves[id]?.category !== 'Status'))!;
    const npcOnlyGround = { ...groundUser, moves: groundUser.moves.filter((id) => ds.moves[id]?.type === 'Ground' && ds.moves[id]?.category !== 'Status') };
    const plain = scorePair(ds, box('Koffing'), npcOnlyGround);
    const levitate = scorePair(ds, { ...box('Koffing'), ability: 'Levitate' }, npcOnlyGround);
    expect(plain.worstTaken.mult).toBe(2);
    expect(levitate.worstTaken.mult).toBe(0);
    expect(levitate.score).toBeGreaterThan(plain.score);
  });
  it('uses entered moves instead of STAB when given', () => {
    const v = npc('challenge:brock').variants[0];
    const r = scorePair(ds, box('Charmander', ['metalclaw']), v.team[0]);
    expect(r.bestHit.option?.moveName).toBe('Metal Claw');
    expect(r.bestHit.mult).toBe(2);
  });
});
