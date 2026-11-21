# MeowRPGAdvisor – PokeMeowRPG Battle Helper

A Chrome extension (side panel) that helps you plan and fight NPC battles in [PokeMeowRPG](https://pokemeowrpg.com): look up any NPC's team, get a team picked from your own box, and get live tips during a battle.

**Advice only.** MeowRPGAdvisor never clicks, types or plays for you. It only reads what is on the screen (game rule: *"Play yourself. Do not use bots or automation"*). The game's staff said a helper like this is fine as long as there is no automation, and it stays that way.

Fan-made, not affiliated with PokeMeowRPG.

- [Install (for players)](#install-for-players)
- [Share with a friend](#share-with-a-friend)
- [Features](#features)
- [Privacy](#privacy)
- [Build from source](#build-from-source)
- [Project layout](#project-layout)

## Install (for players)

You need a `MeowRPGAdvisor-x.y.z.zip` file (from a friend, or from the [Releases](../../releases) page).

1. Unzip it into a folder you will keep, for example `Documents\MeowRPGAdvisor`. Don't delete the folder later; Chrome runs the extension from it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder (the one with `manifest.json` in it).
4. Pin MeowRPGAdvisor from the puzzle-piece menu, then click its icon. By default MeowRPGAdvisor opens in a small floating window (see **Window or side panel** below).
5. Log in to pokemeowrpg.com. In MeowRPGAdvisor's ⚙ tab click **Sync data** (the game's wiki data, about 8 MB, once), then **Sync box from game** (your Pokémon).
6. Reload any open game tab once, so the Battle tab can see battles.
7. Open the game's **Bag** page once, so MeowRPGAdvisor knows your TMs and items. Open it again after buying or using items.

**Updating:** unzip the new version over the same folder, then click the ↻ reload button on MeowRPGAdvisor in `chrome://extensions` and reload the game tab. Your synced data and settings are kept.

Chrome may show a "developer mode extensions" notice at startup; that is normal for extensions installed this way.

**Brave, Edge and other Chromium browsers** work the same way: open `brave://extensions` (or `edge://extensions`), turn on Developer mode and **Load unpacked**. In Brave the panel opens in Brave's sidebar when you click the MeowRPGAdvisor icon. Brave has had bugs with extension side panels (for example [the panel closing by itself](https://github.com/brave/brave-browser/issues/32132) or [crashes in some versions](https://github.com/brave/brave-browser/issues/40262)); if that happens, update Brave or use Chrome.

## Window or side panel

In ⚙ → **Where MeowRPGAdvisor opens** you can choose:

- **Floating window** (default): the toolbar icon opens a small standalone window, or focuses it if it is already open. Its size and position are remembered. It does not follow you between tabs. Live battle and bag data still arrive, because the game page writes them to extension storage, not to "the current tab". Chrome has no always-on-top option for windows, so the browser window can cover it; put it on a second monitor or snap the two side by side.
- **Side panel on game tabs only**: the docked panel is enabled only on pokemeowrpg.com tabs and disappears on other sites.

After switching, close the old window or panel and click the icon again.

## Share with a friend

```bash
npm run package
```

This builds the extension and writes `release/MeowRPGAdvisor-<version>.zip`. Send that zip (Discord, Drive…), or attach it to a GitHub Release so friends can always download the latest one. They follow [Install (for players)](#install-for-players). Each friend syncs their own wiki data and box; nothing of yours is in the zip.

Don't send a `.crx` file: Chrome on Windows blocks `.crx` files that don't come from the Chrome Web Store. Publishing on the Web Store (one-time $5 developer fee, a review, and a privacy policy) is the way to get one-click installs and automatic updates later.

## Share what MeowRPGAdvisor learned about NPCs

MeowRPGAdvisor remembers which moves NPC Pokémon used in your battles. You can swap that with friends, by file only (nothing is uploaded anywhere):

1. **Export:** Settings → *Share NPC data* → *Export file*. Tick "Only NPCs I have data for" to skip empty NPCs. Send the `.json` through Discord, Drive, etc.
2. **Import:** Settings → *Share NPC data* → *Import file*. The file is checked strictly (max 2 MB, known NPCs and moves only, unknown fields ignored) and merged: the NPC tab and the Battle tab's "Seen in earlier battles" line show those moves as "seen by others (n)", where n is how many imported files saw it. Moves you saw yourself have no label.
3. **Undo:** *Remove imported data* drops everything imported and keeps your own observations. Importing the same file twice does nothing; a newer file from the same friend replaces their older one.

The file contains: format version, export date, MeowRPGAdvisor version, a random id (made on your computer, so a re-import isn't double-counted) and NPC id → variant → Pokémon → move ids. No player name, box, team, bag or account id. Wild and player battles are never exported.

## Features

**NPC tab** – 460 NPCs (Gym, Elite Four, Champion, Tower, Frontier, Mega Chamber, Rival, Rocket, World Boss) with search and filters. Each shows its team, moves, ability, item, nature, EVs and Rematch/Silver/Gold versions, plus the best attacking/defensive types, priority and setup moves, the medicine it carries and challenge requirements. Moves an NPC was seen using in battle that the wiki doesn't list are marked.

**Team tab** – picks a team from your box with real damage numbers (`@smogon/calc`, Gen 9, using the game's own stats and move data), scores every matchup, suggests a lead and leaves out Pokémon over the level cap. Tap a matrix cell for damage ranges. Lock 🔓 or exclude ✕ Pokémon, and **Copy team** as Showdown text.
- **Move advice** in steps, following the game's learning rules (wiki: *Learning and Changing Moves*): *Ready now* (moves it knows), *Re-learn* (level-up moves it already passed: free only if it still has an unspent learning chance, otherwise a cost such as a Heart Scale), *By the level cap* (free: level-up moves it learns as it levels up), *With TMs in your bag*.
- **Held items** 🎒: one item per Pokémon from your bag. Gems and type boosters are scored with the calc (a Gem only counts for the first hit); other items use rules of thumb (status-curing berries vs the NPC's status moves, Wide Lens for inaccurate moves, Light Clay with screens…). World Boss and Mega Chamber rules are applied there (your OHKO moves, Destiny Bond, Perish Song, Endeavor and Pain Split fail; their attacks hit through Wonder Guard).

**Battle tab** (singles) – follows the battle live: both Pokémon with exact HP, status and stat changes.
- Ranks each of your moves and switches with damage %, KO chance and a short reason; accuracy/evasion changes lower a move's expected damage.
- Shows the NPC's most dangerous hit and who moves first.
- **Likely next move** (a guess) with how often the guess was right this battle.
- **Calc check**: every "It dealt N damage" in the log is compared with the calc's range.
- **Seen in battle**: moves NPC Pokémon actually used are remembered across battles.
- **May switch** (a guess): when the NPC's Pokémon can't win and a teammate takes your hit much better.
- **Items** 🎒 (from your bag): a Potion when HP is under 75% (the smallest one that fills most of the gap), a cure when your Pokémon has a status (Full Heal or a status Berry), and Revive/Max Revive for the fainted team member that would do best. Using an item takes your turn, so each is scored after the NPC's free hit. Amounts from the wiki (Potion 20, Super Potion 60, Hyper Potion 120 HP, Revive half HP). No item advice in Battle Towers, where Bag medicine is not allowed.
- **Destiny Bond**: if the NPC moves first and your move would KO, it warns you and suggests baiting it for a turn (a move that doesn't KO, or a switch).

**Settings** – sync wiki data and box, see when your bag was last read, export/import your box as JSON, forget seen moves or bag, light/dark theme.

Not yet: Double battles, scoring support moves (stat boosts, debuffs, screens) for the next Pokémon, crits and move side effects, multi-turn planning. See [docs/PLAN.md](docs/PLAN.md).

## Privacy

Everything stays in your own Chrome:
- **Wiki data**: read from the game's `/wiki/` page with your login and parsed as plain data (no game code runs). Stored in IndexedDB; downloaded again only after a game update.
- **Your box**: read with the same read-only request the game's team picker uses, 30 Pokémon per page about 1 s apart, stopping if the game asks it to wait.
- **Battles and bag**: a content script reads the battle screen and the Bag page as they are shown. It never clicks, types, changes the page or calls the game's API. From the bag it keeps item ids and counts only.

Nothing is sent anywhere else. There are no analytics.

## Build from source

Needs Node 20 or newer.

```bash
npm install
```

```bash
npm run build
```

Then load the `dist/` folder with **Load unpacked** as above.

| Command | What it does |
|---|---|
| `npm run dev` | Panel in a normal tab at `http://localhost:5174/sidepanel.html`; ⚙ → **Load sample data** uses a small fixture (real sync only works in the extension) |
| `npm test` | Unit tests (vitest) |
| `npm run package` | Build and zip into `release/` |
| `npm run validate-data -- <wiki-data.js>` | Check a full downloaded wiki data file after a game update |
| `npm run fixture -- <wiki-data.js>` | Rebuild the small test fixture in `tests/fixtures/` |

## Project layout

```
public/           manifest.json, icons (copied into dist/)
sidepanel.html    side panel entry page
src/
  background/     service worker (floating window / side panel toolbar handling)
  content/        read-only content script: battleReader (selectors + log parser), bagReader (Bag page)
  data/           wiki sync, box sync, data parsing, IndexedDB
  engine/         damage calc, team picker, move and held-item advice, turn advisor, NPC move guess, seen-in-battle store
  shared/         types shared by the panel and the content script
  ui/             Preact side panel: App (tab list), tabs/, components/, theme.css
tests/            unit tests and fixtures (a small trimmed wiki sample, a rebuilt battle page)
scripts/          data checks, fixture builder, packaging
docs/             PLAN.md (tracker), WORKFLOW.md, archive/ (detailed notes, Vietnamese), design/
```

To add a tab: create a component in `src/ui/tabs/` and add one line to `TABS` in `src/ui/App.tsx`.
