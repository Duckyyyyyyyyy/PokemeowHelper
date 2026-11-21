# MeowRPGAdvisor: Plan

Current version: **0.12.2** · Details and history: `docs/archive/PLAN-v1.md` (Vietnamese; grep, don't read whole)
Legend: ✅ done · 🔶 code done, not checked in a real battle · ⏳ ongoing · ⬜ planned

## ⏳ Ongoing

- 🔶 **Hunt & Grind for an NPC** (Prep step 3): wild Pokémon to catch and train, hunt list (`mdHunt`), Explore marker, wild CATCH rule, Battle link. Merged after 0.12.2, **not released yet**. Spec: `docs/design/hunt-and-grind-spec.md`.
- 🔶 **World Boss**: per-spawn move picker, lobby reader, counter team (Prep). Merged after 0.12.2 and **not released yet**.
  - World Boss 2 (2026-11 wiki rules, WS1): 10M HP fallback (Eternamax 100M), 125x with a 50k cap per action (350k), Max Barrier, drain cut by phase, Encore/Leech Seed/Salt Cure fail, very heavy, boss boost cap, Eternamax Overdrive, loot tiers in Prep.
  - Gap resolved: Battle and Prep share one rule (`bossRules`/`bossAttackDs` in worldBoss.ts: Max Moves only for GMAX/Eternamax, 55%/70% cut). The Battle tab cuts every row: threat, likely moves, the 2–3-turn plan and switch-ins (`foeHitMult` in lookahead.ts).
  - Lobby fixture is unverified. Archive: "World Boss".

## ⬜ Planned (in order)

0. **Game update catch-up (Nov 14–21 changes, Battle Simulator)**: reader fixes, World Boss 2, field effects, Friendship, NPC AI, data refresh. Plan with workstreams and models: `docs/design/game-update-2026-11-plan.md`. Waiting on user decisions (§5 there).
1. Release the next version with World Boss and Hunt & Grind once World Boss has been checked once on the real lobby page.
2. Later: Chrome Web Store listing ($5 and a privacy policy), and Triples.

## 🔍 Needs real-game check

Claude reads the page through Claude in Chrome and the user plays. Tick an item or remove it when confirmed.

- [ ] World Boss lobby selectors (`tests/fixtures/worldboss/lobby.unverified.html`) and the battle `kind`/boss name
- [ ] World Boss in a real raid: Max Moves only for GMAX/Eternamax (name test), barrier ramp (straight line 20%→100% is a guess), order 125x → Overdrive → barrier → cap, Overdrive stacked on top of the normal stage boost, drain cut phases (75%/40% HP), loot tiers
- [ ] Battle Frontier battle: `data-kind`, Brain name, Gen III damage vs Calc check
- [ ] Battle Tower: opponent name, fainted roster, reserve PP
- [ ] Doubles build in a live battle: own Pokémon fainting, switching mid-battle, status badges
- [ ] Support-move scoring (4a) and lookahead (4d) guesses: sleep turns, crit 1/24, flinch, confusion
- [ ] Wild battle screen after clicking Battle (HP %, status); Catchlist marker
- [ ] In-battle Items panel markup (`battle-items-panel.reconstructed.html`)
- [ ] Hunt & Grind reachable maps (guess): map ids from the encounter card title, the Tips gate table (`GATE_TIP` in hunt.ts) and the region-order guess; Surf/rod known only from ticked Tips, Bag or a box Pokémon knowing Surf
- [ ] Hunt list on a live wild encounter: CATCH with "On your hunt list for <NPC>" and the Explore "hunt:" marker
- [ ] Battle tab "Hunt for a counter →" link (shows when nothing rates 45+ vs a known NPC; not seen in a live battle)
- [ ] Replace the Brock fixture (`brock-turn3.reconstructed.html`) with a real Ctrl+S save

## Known data gaps (not bugs)

- No tutor moves, no weight (Heavy Ball). Worth grinding applies level-based evolutions only (stone, trade, friendship, Mega are not).
- Restricted list for the Frontier is guessed (Emerald list). There is no pool of regular Frontier trainers.

## ✅ Done

| Ver | What |
|---|---|
| 0.1–0.4 | MV3 shell, wiki sync (acorn, no eval), NPC browser, type analysis, box sync from API, @smogon/calc damage, team builder with lock/exclude, moveset advice, challenge rules |
| 0.5 | Battle reader + live turn advice, log parsing, calc check, NPC move prediction, moves seen across battles, accuracy/evasion, NPC switch guess. Admin approved (no automation). Renamed to MeowHelper |
| 0.6 | Bag reader, TM-aware moves, held-item advice, in-battle items, wiki rule fixes |
| 0.7 | Floating window, Worth grinding, Explore tab (maps, catch plan, balls, wild reader) |
| 0.8 | Support-move scoring (Setup), lead tags, wild switch fixes, grind team of 6 |
| 0.9 | Explore catch plan from the carried team, Catchlist/Pokédex FIGHT/CATCH rules |
| 0.10 | Tips tab (151 tips, progress path) |
| 0.11 | 2–3-turn expectimax, crit and side effects, Doubles, Battle Frontier (Gen III) and Battle Tower, item advisor v2, NPC data sharing (JSON) |
| 0.12.0 | Renamed to **MeowRPGAdvisor**, Arena HUD UI (Battle / Wild / Prep / Guide) |
| 0.12.1 | Fix for the "random" nature showing "No effect"; twin NPC Pokémon keep their own seen moves |
| 0.12.2 | Wild encounter: the adjust card no longer pops up; battle plate alignment |
