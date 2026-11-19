import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { Dataset } from '../src/shared/types';
import { obsKey, observedMoves, seenByOthers, seenByYou, type ObservedStore } from '../src/engine/observed';
import { MAX_IMPORT_BYTES, addImport, applyImports, buildExport, contentHash, parseImport, type ImportLedger } from '../src/engine/share';

const ds = structuredClone(fixture) as unknown as Dataset;
const B = 'challenge:brock#firstbattle';
const mine: ObservedStore = {
  [obsKey(B, 'Onix', 14)]: { name: 'Onix', level: 14, moves: ['screech'], lastSeen: 1 },
  // wild/player battles carry names of other players: must never be exported
  [obsKey('name:SomePlayer#player', 'Pikachu', 5)]: { name: 'Pikachu', level: 5, moves: ['thundershock'], lastSeen: 1 },
};
const exp = (over: object = {}) => ({
  format: 'meowhelper-npc-data', formatVersion: 1, exportedAt: '2026-01-01T00:00:00Z', appVersion: '0.10.0', sourceId: 'aaaaaaaa-1111',
  npcs: { 'challenge:brock': { 'First battle': [{ name: 'Onix', level: 14, moves: ['rockthrow', 'screech', 'notamove'] }] } },
  ...over,
});
const parse = (o: unknown) => parseImport(JSON.stringify(o), ds);

describe('export', () => {
  const f = buildExport(ds, mine, { sourceId: 'me-me-me-me', appVersion: '0.10.0', now: new Date('2026-02-03T00:00:00Z') }, true);
  it('has only NPC observations, no personal fields', () => {
    expect(Object.keys(f).sort()).toEqual(['appVersion', 'exportedAt', 'format', 'formatVersion', 'npcs', 'sourceId']);
    expect(f.npcs).toEqual({ 'challenge:brock': { 'First battle': [{ name: 'Onix', level: 14, moves: ['screech'] }] } });
    const json = JSON.stringify(f);
    for (const bad of ['SomePlayer', 'Pikachu', 'box', 'bag', 'team', 'username']) expect(json).not.toContain(bad);
  });
  it('all-NPCs mode lists every NPC', () => {
    const all = buildExport(ds, mine, { sourceId: 'me-me-me-me', appVersion: 'x' }, false);
    expect(Object.keys(all.npcs).length).toBe(ds.npcs.length);
  });
});

describe('import validation', () => {
  it('accepts a good file, drops unknown moves and extra fields', () => {
    const p = parse(exp({ evil: '<script>', npcs: { 'challenge:brock': { 'First battle': [{ name: 'Onix', level: 14, moves: ['rockthrow', 'notamove'], x: 1 }] } } }));
    expect(p.mons[obsKey(B, 'Onix', 14)].moves).toEqual(['rockthrow']);
  });
  it('rejects bad input', () => {
    expect(() => parseImport('nope', ds)).toThrow(/JSON/);
    expect(() => parse({ ...exp(), format: 'other' })).toThrow(/not a MeowHelper/);
    expect(() => parse({ ...exp(), formatVersion: 2 })).toThrow(/version/);
    expect(() => parse({ ...exp(), sourceId: '<script>' })).toThrow(/source id/);
    expect(() => parse({ ...exp(), npcs: [] })).toThrow(/NPC data/);
    expect(() => parseImport('x'.repeat(MAX_IMPORT_BYTES + 1), ds)).toThrow(/too large/);
  });
  it('rejects unknown NPCs (and files with nothing known)', () => {
    expect(() => parse(exp({ npcs: { 'challenge:nobody': { 'First battle': [] } } }))).toThrow(/No known/);
    const p = parse(exp({ npcs: { ...exp().npcs, 'challenge:nobody': { x: [] } } }));
    expect(p.skipped).toBe(1);
    expect(p.accepted).toBe(1);
  });
  it('skips Pokémon that are not on that team, bad levels and huge lists', () => {
    expect(() => parse(exp({ npcs: { 'challenge:brock': { 'First battle': [{ name: 'Mewtwo', moves: ['screech'] }] } } }))).toThrow(/No known/);
    const many = Array.from({ length: 41 }, () => 'screech');
    expect(() => parse(exp({ npcs: { 'challenge:brock': { 'First battle': [{ name: 'Onix', moves: many }] } } }))).toThrow(/No known/);
  });
});

describe('merge, dedupe, undo', () => {
  const p1 = parse(exp());
  const p2 = parse(exp({ sourceId: 'bbbbbbbb-2222', npcs: { 'challenge:brock': { 'First battle': [{ name: 'Onix', level: 14, moves: ['rockthrow', 'bind'] }] } } }));
  const add = async (l: ImportLedger, p: typeof p1, own?: string) => addImport(l, p, await contentHash(p.mons), own);

  it('sums counts, unions moves, keeps yours separate', async () => {
    let l: ImportLedger = {};
    for (const p of [p1, p2]) {
      const r = await add(l, p);
      if (!r.ok) throw new Error(r.reason);
      l = r.ledger;
    }
    const store = applyImports(mine, l);
    const o = store[obsKey(B, 'Onix', 14)];
    expect(o.moves).toEqual(['screech']);
    expect(o.others).toEqual({ rockthrow: 2, screech: 1, bind: 1 });
    expect(observedMoves(store, B, 'Onix', 14).sort()).toEqual(['bind', 'rockthrow', 'screech']);
    expect(seenByOthers(store, B, 'Onix', 14, 'rockthrow')).toBe(2);
    expect(seenByYou(store, B, 'Onix', 14, 'rockthrow')).toBe(false);
    expect(seenByYou(store, B, 'Onix', 14, 'screech')).toBe(true);
  });
  it('does not double-count the same file, a copy under another id, or your own export', async () => {
    const r = await add({}, p1);
    if (!r.ok) throw new Error();
    expect((await add(r.ledger, p1)).ok).toBe(false);
    expect((await add(r.ledger, { ...p1, sourceId: 'cccccccc-3333' })).ok).toBe(false);
    expect((await add({}, p1, 'aaaaaaaa-1111')).ok).toBe(false);
  });
  it('newer export from the same source replaces, older is refused', async () => {
    const r = await add({}, p1);
    if (!r.ok) throw new Error();
    const newer = { ...p2, sourceId: p1.sourceId, exportedAt: '2026-03-01T00:00:00Z' };
    const r2 = await add(r.ledger, newer);
    expect(r2.ok && r2.replaced).toBe(true);
    if (!r2.ok) throw new Error();
    expect(applyImports({}, r2.ledger)[obsKey(B, 'Onix', 14)].others).toEqual({ rockthrow: 1, bind: 1 });
    expect((await add(r2.ledger, p1)).ok).toBe(false);
  });
  it('undo removes imports and leaves your data (and drops import-only entries)', async () => {
    const r = await add({}, p1);
    if (!r.ok) throw new Error();
    const withImport = applyImports({ ...mine, [obsKey(B, 'Geodude', 12)]: { name: 'Geodude', moves: [], lastSeen: 1, others: { tackle: 1 } } }, r.ledger);
    const undone = applyImports(withImport, {});
    expect(undone).toEqual(mine);
  });
});
