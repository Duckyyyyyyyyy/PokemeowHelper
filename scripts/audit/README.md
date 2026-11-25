# Battle audit

Plays whole battles in the Showdown engine, which acts as the judge, and lets the advisor (`src/engine`) pick your moves from what the extension would read. Not part of the extension, the tests or the build.

Setup, once (both folders are git-ignored):

```
npm i --prefix scripts/audit/.sim @pkmn/sim@0.11.0
mkdir -p scripts/audit/.base/0.15.1 && git archive be37854 src | tar -x -C scripts/audit/.base/0.15.1
```

- Check the harness: `npx tsx scripts/audit/audit.mts 1 1 1 scripts/audit/.out/x selftest` (13 OK).
- Run: `scripts/audit/run.sh <tag> <source dir, . = this repo> <seed0> <battles> 0 match`: 8 processes × battles. The same seeds give the same battles, so versions compare in pairs. To test a change without touching `src`, copy it to `.base/<name>/src` and pass that folder. Copy `src` too before editing it during a long run.
- Read: `node scripts/audit/pair.cjs <tag>[:policy] <tag>[:policy] …`: wins, and the first one minus each other ± SE. `show.cjs` prints the 2026-11-25 tables, `items.cjs` the item decisions.
- Env: `SIZE` (team size), `ONLY` (policies: advItems, advNoItems, greedy, greedyHeal, smartHeal, smart, and the ablations advNoSw, advForced, advSw), `BAG=0`, `NPCMED=0`, `HELD=0`, `HPFULL=1`, `NPCHEAL=seen` (NPC heals as a player reported it; default: at 25% HP or less).
- Modes: `match` (whole battles), `audit` (single item decisions, judged by playouts), `flip` (turns where real foe HP changes the advice), `selftest`.

Limits: random sets or wiki teams from the fixture, Showdown rules, the NPC never switches and comes in in the order the advisor expects. Compare versions with it; the win rates are not those of the real game. Tune on one set of seeds and confirm on others.
