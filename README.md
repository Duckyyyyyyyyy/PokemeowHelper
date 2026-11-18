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

**Phase 2 – damage calc** (current):
- Every matchup uses real damage from `@smogon/calc` (Gen 9). The inputs are real stats, moves, abilities and items, with species stats and move power taken from the game's own data. The stat formula was checked against the game: a synced Lv 16 Timburr gives exactly the stats the game shows.
- Each matrix cell is a 1v1 estimate: both sides use their best move each turn, and speed and priority decide who hits first. Tap a cell to see the damage ranges and the result.
- **Move advice** suggests the best 4 damaging moves for a fight, from moves the Pokémon knows, level-up moves at its level, and TMs.
- NPC Pokémon show their real stats. Frontier Brain sets have no level in the wiki, so Lv 50 is assumed.
- **Challenge rules** (Gym, Elite Four, Champion): OHKO moves, Destiny Bond, Perish Song, Endeavor and Pain Split are ignored, and the NPC's attacks hit through Wonder Guard.
- **Team controls**: 🔓 lock a Pokémon onto the team, ✕ exclude one, tap a bench name to lock it in, and **Copy team** puts the team on the clipboard as Showdown-style text.

**Phase 3 – in-battle tips** (current, singles):
- Open a battle on pokemeowrpg.com and the **Battle** tab follows it live: both Pokémon with exact HP, status and stat changes (rebuilt from the battle log).
- Every option is ranked: your 4 moves and each switch, with damage %, KO chance and a short reason. It also shows the NPC's most dangerous hit and who moves first.
- How it reads the battle: a content script watches the battle screen and only reads it. It never clicks, types, changes the page or calls the game's API. After installing or updating MeowDex, reload the game tab once.
- **Likely next move** (a guess): the NPC's moves with a probability each, and how often the guess was right this battle. The KO warning still uses their strongest hit.
- **Calc check**: each hit in the battle log ("It dealt 12 damage") is compared with the calc's range for that hit, when both Pokémon's exact sets are known.
- **Seen in battle**: moves NPC Pokémon actually used are remembered across battles (on this computer only, separate from the wiki data). The NPC tab marks moves the wiki doesn't list, and the Battle tab counts them as possible threats. ⚙ → Seen in battle → Forget clears them. Only battles watched with the panel open are recorded.
- Accuracy and evasion changes (e.g. Double Team) lower the expected damage of your moves in the ranking.
- **May switch** (a guess): shown when the NPC's Pokémon can't win the 1v1 and a teammate takes your best hit much better.
- Not yet: Doubles, crits and move side effects, multi-turn planning.

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
src/content/      read-only content script: battleReader (selectors + parsers) → chrome.storage → Battle tab
src/data/         literalParser (acorn), normalize (one adapter per NPC source), sync (wiki data), boxSync (your box), db (IndexedDB)
src/engine/       typeChart, analysis, damage (@smogon/calc wrapper + 1v1 duel), rules (challenge rules), moveset, teamSuggest, turnAdvisor – plain TypeScript, with tests
src/ui/           side panel (Preact + signals): App (tab registry), tabs/, components/, theme.css
public/           manifest.json, icons
```
To add a new tab: create a component in `src/ui/tabs/`, then add one line to `TABS` in `src/ui/App.tsx`.
