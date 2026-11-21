# MeowRPGAdvisor: Claude instructions

Chrome MV3 extension (side panel or floating window) that gives **advice only** for the browser game PokeMeowRPG (pokemeowrpg.com). Stack: Vite 5, TypeScript, Preact with @preact/signals, @smogon/calc, idb, Vitest. The repo is named PokemeowHelper and is **public**.

## Session workflow (token budget)

- **Start:** read `docs/PLAN.md` (short tracker). For a task with a note in `docs/handoff/`, run `/resume-task <slug>` and read only that note.
- **Don't read whole big files.** `docs/archive/PLAN-v1.md` (86 KB, Vietnamese) holds the verified DOM selectors, game-rule findings and test notes. Grep its headings and read one section. Plan section refs in code comments (§0.3, §3.3, 4b) point there.
- Explore code with Grep/Glob plus targeted Read ranges. Engine files are large.
- **Unfinished work, or context getting long:** `/handoff <slug>`, then `/clear`. Steps: `docs/WORKFLOW.md`.

## Hard rules (game admin approval depends on them)

- **No automation.** Never click, type or submit in the game, and never inject UI into game pages (no in-page HUD). Content scripts only read the DOM.
- Requests to the game happen only on a user action (Sync buttons), are read-only, and back off on 429/401/403.
- To inspect pokemeowrpg.com, use **Claude in Chrome** (the user is logged in there; the built-in browser pane hits Cloudflare). Read only.
- Public repo: no personal data, keys, box exports or wiki-data dumps in tracked files.
- Keep the IndexedDB name `meowdex` and every `md*` key in `chrome.storage` (`mdObserved`, `mdBattle`, `mdBag`, `mdWild`…). Renaming them wipes users' data.
- Changing the shape of `Dataset` means bumping `SCHEMA_VERSION` in `src/shared/types.ts`, and users must Sync again.

## Verify (before saying done or committing)

- `npm test` (Vitest) must pass. `npm run build` (tsc, vite, content bundle, content check) must pass when `src/` changed.
- A test counts only if it runs the changed code. Make a new test fail once before trusting it.
- UI changes: `.claude/launch.json` → `meowhelper-dev` (port 5174) and click through the changed flow. Dev mode has no live game, so behaviour that depends on the game is only checked through fixtures.
- Readers (`src/content/*`): test against an HTML fixture in `tests/fixtures/`. Mark reconstructed fixtures `.reconstructed`/`.unverified` and list them in PLAN "Needs real-game check".
- Fix the code, not the check. No `.skip`, no added sleeps. If a check is still red after 3 attempts, stop and tell the user.
- Report which checks ran and which were skipped. "Not checked in a real battle" is a valid and expected status.

## Model and effort (state it in one line at the start of a task)

| Task | Model @ effort |
|---|---|
| Feature, multi-file work, debugging (default) | Opus @ medium (high if it stalls) |
| Well-scoped one-file fix, copy, docs/PLAN edits | Sonnet @ medium |
| Quick Q&A | Sonnet @ low |
| Search or log-reading subagents | Haiku/Sonnet |
| Engine redesign (lookahead, calc), architecture | Opus @ high |

If the right model differs from the session's model, say so and stop so the user can switch. Switch only at a break (handoff or `/compact`).

## Working principles

- **Think first:** state assumptions. If something is ambiguous, ask instead of guessing.
- **Simplicity:** write the minimum code for the request. No speculative options or abstractions.
- **Surgical:** every changed line traces to the request. Match the existing style. Mention unrelated dead code but leave it in place.
- **Goal-driven:** bug means a repro test first. Refactor means tests pass before and after.
- Game mechanics that aren't confirmed in a real battle are **guesses**: label them in code and UI, and add them to PLAN "Needs real-game check".

## Project map

- `src/content/`: read-only DOM readers (battle, wild, bag, boss lobby) that write to `chrome.storage.local`
- `src/data/`: wiki sync (acorn literal parse, no eval), normalize, IndexedDB, box sync, tips
- `src/engine/`: pure TypeScript with tests (damage, lookahead, turnAdvisor, npcModel, teamSuggest, doubles, frontier, worldBoss…)
- `src/ui/`: Preact tabs (Battle, Wild/Explore, Prep, Guide, Settings) and stores
- `tests/`: Vitest, `tests/fixtures/` HTML snapshots
- Release steps: `docs/WORKFLOW.md#release`.
