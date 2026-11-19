/**
 * Builds a SMALL test/dev fixture from a downloaded copy of the game's wiki data file.
 * The full file is never committed; only this trimmed subset is.
 *
 *   npm run fixture -- <path-to-downloaded-wiki-data.js>
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { parseDataModule } from '../src/data/literalParser';
import { normalizeDataset } from '../src/data/normalize';
import type { Dataset } from '../src/shared/types';

const src = process.argv[2];
if (!src) throw new Error('Usage: npm run fixture -- <wiki-data.js>');

const t0 = performance.now();
const raw = parseDataModule(readFileSync(src, 'utf8')) as any;
const full = normalizeDataset(raw, 'fixture', 0);
console.log(`parsed+normalized in ${Math.round(performance.now() - t0)} ms; npcs=${full.npcs.length}`);
console.log('full normalized JSON size (MB):', (JSON.stringify(full).length / 1e6).toFixed(2));

const keepNpc = (id: string) =>
  /^challenge:(brock|misty|ltsurge|lt-surge|erika|koga|sabrina|blaine|giovanni|lorelei|bruno|agatha|lance|kanto-.*|hoenn-tateandliza)$/.test(id);
const pickOne = (prefix: string) => full.npcs.find((n) => n.id.startsWith(prefix));
const npcs = [
  ...full.npcs.filter((n) => keepNpc(n.id)),
  ...['tower:', 'frontier:', 'mega:', 'rival:', 'rocket:', 'boss:'].map(pickOne).filter(Boolean),
] as Dataset['npcs'];

const speciesIds = new Set<number>();
for (let i = 1; i <= 151; i++) speciesIds.add(i);
for (const n of npcs) for (const v of n.variants) for (const m of v.team) speciesIds.add(m.species);

const items = new Set<string>();
for (const n of npcs) for (const v of n.variants) {
  v.medicines.forEach((i) => items.add(i));
  v.team.forEach((m) => m.item && items.add(m.item));
}

const fixture: Dataset = {
  ...full,
  // Generated tips carry wiki prose: never commit them to the public repo.
  tips: undefined,
  species: Object.fromEntries([...speciesIds].filter((id) => full.species[id]).map((id) => [id, full.species[id]])),
  moves: Object.fromEntries(Object.entries(full.moves).map(([k, m]) => [k, { ...m, description: m.description.slice(0, 160) }])),
  items: Object.fromEntries([...items].filter((i) => full.items[i]).map((i) => [i, full.items[i]])),
  npcs,
};

const out = 'tests/fixtures/wiki-mini.json';
writeFileSync(out, JSON.stringify(fixture));
console.log(`wrote ${out}: ${npcs.length} npcs, ${Object.keys(fixture.species).length} species, ${(statSync(out).size / 1e3).toFixed(0)} KB`);
console.log('npc ids:', npcs.map((n) => n.id).join(', '));
