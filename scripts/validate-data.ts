/**
 * Checks a downloaded wiki data file end-to-end: parse → normalize → analysis.
 * Use after a game update to see whether MeowRPGAdvisor still understands the data.
 *
 *   npx tsx scripts/validate-data.ts <path-to-downloaded-wiki-data.js>
 */
import { readFileSync } from 'node:fs';
import { parseDataModule } from '../src/data/literalParser';
import { normalizeDataset } from '../src/data/normalize';
import { bestAttackTypes } from '../src/engine/analysis';

const t0 = performance.now();
const ds = normalizeDataset(parseDataModule(readFileSync(process.argv[2], 'utf8')) as any, 'check');
const byCat: Record<string, number> = {};
const badMoves = new Set<string>();
const badSpecies = new Set<number>();
let mons = 0;
let noLevel = 0;
for (const n of ds.npcs) {
  byCat[n.category] = (byCat[n.category] ?? 0) + 1;
  for (const v of n.variants) {
    if (!v.team.length) console.log('empty team:', n.id, v.label);
    for (const m of v.team) {
      mons++;
      if (!ds.species[m.species]) badSpecies.add(m.species);
      if (m.level === undefined) noLevel++;
      m.moves.forEach((id) => !ds.moves[id] && badMoves.add(id));
    }
    bestAttackTypes(ds, v);
  }
}
console.log({ ms: Math.round(performance.now() - t0), npcs: ds.npcs.length, byCat, mons, noLevel, badMoves: [...badMoves], badSpecies: [...badSpecies] });
