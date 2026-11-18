/**
 * Builds the SMALL raw explore fixture (maps, ball/held items, catch fields) from a
 * downloaded copy of the wiki data file. Only species already in wiki-mini.json are kept.
 *
 *   npx tsx scripts/make-explore-fixture.ts <path-to-downloaded-wiki-data.js>
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { parseDataModule } from '../src/data/literalParser';

const src = process.argv[2];
if (!src) throw new Error('Usage: tsx scripts/make-explore-fixture.ts <wiki-data.js>');
const raw = parseDataModule(readFileSync(src, 'utf8')) as any;
const mini = JSON.parse(readFileSync('tests/fixtures/wiki-mini.json', 'utf8'));
const keep = new Set<number>(Object.keys(mini.species).map(Number));
const MAPS = ['verdant-trail', 'azure-shore', 'stone-ridge', 'haunted-wood', 'power-plant', 'safari-zone'];

const maps = raw.maps
  .filter((m: any) => MAPS.includes(m.id))
  .map((m: any) => ({
    id: m.id, name: m.name, theme: m.theme, levels: m.levels, description: m.description,
    encounters: m.encounters.filter((e: any) => keep.has(e.species)),
  }));
const used = new Set<number>(maps.flatMap((m: any) => m.encounters.map((e: any) => e.species)));
const species = raw.species
  .filter((s: any) => keep.has(s.id))
  .map((s: any) => ({ id: s.id, name: s.name, catchRate: s.catchRate, rarity: s.rarity, availability: s.availability, spawnRequirement: s.spawnRequirement, evolutions: (s.evolutions ?? []).filter((e: any) => e.from === s.id) }));
const items = raw.items
  .filter((i: any) => i.category === 'balls' || (i.wildSources ?? []).some((w: any) => used.has(w.species)))
  .map((i: any) => ({
    id: i.id, name: i.name, category: i.category, description: i.description, itemEffect: i.itemEffect, heldEffect: i.heldEffect, notes: i.notes,
    universalWildSource: i.universalWildSource, wildSources: (i.wildSources ?? []).filter((w: any) => used.has(w.species)),
  }));

const out = 'tests/fixtures/wiki-explore-raw.json';
writeFileSync(out, JSON.stringify({ maps, species, items, mechanics: raw.mechanics }));
console.log(`wrote ${out}: ${maps.length} maps, ${used.size} wild species, ${items.length} items, ${(statSync(out).size / 1e3).toFixed(0)} KB`);
