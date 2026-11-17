# MeowDex – PokeMeowRPG Battle Helper

A Chrome extension (side panel) for looking up NPCs and getting team suggestions in [PokeMeowRPG](https://pokemeowrpg.com).
**Advice only**: the extension never clicks or plays for you (game rule: *"Play yourself. Do not use bots or automation"*).

Full plan: [docs/PLAN.md](docs/PLAN.md) · Mockup: [docs/ui-mockup.html](docs/ui-mockup.html)

## Phase 1 (current)
- **NPC tab**: 460 NPCs (Gym, Elite Four, Champion, Tower, Frontier, Mega Chamber, Rival, Rocket, World Boss) with search and filters. Each NPC shows its team, moves, ability, item, nature, EVs, and Rematch/Silver/Gold versions.
- **Type analysis**: best attacking types, best defensive types, priority/setup moves, medicine the NPC carries, challenge requirements.
- **Box sync**: one click reads your own Pokémon from the game (level, moves, nature, ability, item, IVs/EVs), using the same read-only request as the game's team picker. It reads 30 Pokémon per page, about 1 s apart, and stops if the game asks it to wait. It can refresh automatically when you open MeowDex (at most every 5 min). Pokémon you add by hand are kept.
- **Team tab**: MeowDex picks a team from your box, scores every matchup, suggests a lead, and excludes Pokémon over the level cap. Rematches have no cap.
- **Settings**: sync wiki data, export/import your box as JSON, light/dark theme.

Phase 1 only uses the game's **type chart** plus known abilities. Damage calc is Phase 2; in-battle tips are Phase 3.

## Install in Chrome (load unpacked)
```bash
npm install
```
```bash
npm run build
```
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `dist/` folder.
3. Click the MeowDex icon in the toolbar to open the side panel.
4. Log in to pokemeowrpg.com in Chrome. Open MeowDex's ⚙ tab and click **Sync data** (wiki data), then **Sync box from game** (your Pokémon).

What sync does: reads the `/wiki/` page to find the data file, downloads it (~8 MB), then parses it as plain data (no game code runs). The result is stored in IndexedDB. Syncing again only downloads when the game has updated.

## Development
```bash
npm run dev
```
Open `http://localhost:5174/sidepanel.html`, go to the ⚙ tab and click **Load sample data** (a 20-NPC fixture). Real sync only works inside the extension.

```bash
npm test
```

```bash
npx tsx scripts/validate-data.ts <wiki-data-file.js>
```
This checks a full downloaded wiki data file; run it after each game update. `npm run fixture -- <file>` rebuilds the small fixture in `tests/fixtures/`.

## Structure
```
src/background/   service worker (opens the side panel when the icon is clicked)
src/data/         literalParser (acorn), normalize (one adapter per NPC source), sync (wiki data), boxSync (your box), db (IndexedDB)
src/engine/       typeChart, analysis, teamSuggest – plain TypeScript, with tests
src/ui/           side panel (Preact + signals): App (tab registry), tabs/, components/, theme.css
public/           manifest.json, icons
```
To add a new tab: create a component in `src/ui/tabs/`, then add one line to `TABS` in `src/ui/App.tsx`.
