# Game update catch-up plan (game changes Nov 14–21, 2026)

Status: **plan, nothing started**. Base version: 0.12.2 (+ unreleased World Boss work).
Each workstream has a slug for `/handoff <slug>` and `/resume-task <slug>`, a model @ effort from the CLAUDE.md table, the files it touches, how to verify it, and what it depends on.

Where each finding comes from:
**[CL]** game "Recent changes" panel · **[WIKI]** wiki page · **[SIM]** Battle Simulator, observed (its guide text or a captured calc response) · **[DATA]** the wiki data file · **[CODE]** our repo.
Nothing here has been checked in a real battle yet unless marked **[SIM]**.

---

## 1. What changed and why it matters to us

### 1.1 The Battle Simulator (wiki → Challenges → Battle Simulator)

- It runs **on the server**: `POST /api/wiki/battle-sim/calc`. Other endpoints: `battle-sim/npc`, `battle-sim/team` and `battle-sim/presets`. The engine is not shipped to the browser, so there is no game JS to study, only inputs and outputs. **[SIM]**
- Request: `{ mode, field: { weather, terrain, gravity?, magicRoom?, wonderRoom?, trickRoom?, yours: {reflect, lightScreen, auroraVeil, tailwind, stealthRock, spikes}, theirs: {…} }, team: [{ set }], opponent: { set } }`. Each `set` holds species id, level, moves (ids), ability, nature, item, ivs, evs, friendship and gender. **[SIM]**
- Response, per matchup: both sides' final stats, HP and speed, `first` (who moves first), and for every move: type, category, BP, priority, accuracy, `critChance`, effectiveness, 16 `rolls`, `critRolls` [max, min], % range, `ko: {hits, chance}` (counts hazards and end-of-turn effects), and `effects` (recoil and drain with % ranges). It also returns notes. **[SIM]**
- Modes: `trainer`, `league` (the opponent uses its **source edition's base stats**), `chamber` (Mega Chamber protections), `wild`, `player` (no Friendship) and `worldBoss` (boss HP, minutes since spawn, shield, Overdrive, crowd scaling, per-action cap; boss boosts capped at +2 Atk/SpA and +1 Def/SpD). **[SIM]**
- Field options: weather (Sun, Rain, Sandstorm, **Snow**), terrain (Electric, Grassy, Misty, Psychic), Gravity, Magic Room, Wonder Room, Trick Room, per-side screens, Tailwind, Stealth Rock and Spikes 1–3. **[SIM]**
- **Calibration result:** for a plain trainer-mode matchup (two level 50+ Pokémon, held item, mixed IVs and EVs), `@smogon/calc` Gen 9 gives **exactly** the same stats, 16 rolls and crit rolls as the game. Crit chance is 1/24. **[SIM vs CODE]** So the damage core is right. Calibration only needs to cover the game-specific rules below.

### 1.2 Battle rules the engine does not model yet

| Rule | Source | Engine today |
|---|---|---|
| **Friendship, your side only** (trainer, League, Chamber, wild; not Player Battles or World Boss): at 180 or more a KO hit has a 10% chance to leave you at 1 HP (15% at 220, 20% at 255). At 255, your crit chance doubles and opposing moves lose 10 accuracy. | [SIM] [WIKI] | not modelled |
| **League teams use source-edition base stats** | [SIM] [DATA] (`baseStats` on each NPC Pokémon) | we read NPC `baseStats`; need to check that the calc uses them and not the species' stats |
| Field: terrain (only Misty is rebuilt from the log), Gravity, Magic Room, Wonder Room, Trick Room (Doubles only), hazards in KO odds, end-of-turn effects (Leftovers, weather chip, poison and burn, Grassy heal) in KO odds | [SIM] | partial (`supportMoves.ts` covers weather, screens and Misty) |
| Abilities that set weather or terrain on entry (Drought, Electric Surge…) | [SIM] | not modelled |
| Battle screen now shows **weather and terrain with effect buttons beside the turn counter** | [CL Nov 14] | we rebuild the field from the log; reading it from the screen would be more reliable |
| **What NPCs know:** species, level, types, HP, status, stat changes, field, and your ability or item once revealed. They **estimate your stats from species and level**. Regular trainers judge danger from your **types**. Frontier remembers up to 4 of your used moves until that Pokémon switches out. Wild Pokémon and bosses pick from their moves without judging. | [WIKI preparation] | `npcModel.ts` is a "mainline AI" heuristic built on very few observations |
| **NPC trainers always lead with the first Pokémon on their team** | [CL Nov 14] | lead is guessed |
| The first two scientists in each Mega Chamber are less eager to switch into a counter | [CL Nov 14] | not modelled |
| Frontier: Hidden Abilities and abilities added after Gen III don't carry over; the player chooses a Gen III ability when registering | [CL Nov 21] | `frontier.ts` should use the chosen ability |
| Status: sleep lasts 1–3 turns, freeze has a 1-in-5 thaw chance, badly poisoned resets on switch-out | [WIKI battle-basics] | check against `lookahead.ts` guesses (PLAN "Needs real-game check") |
| Forms never change in battle; no in-battle Mega, Z-Moves or Dynamax in the League | [WIKI] | fine |

### 1.3 World Boss: our constants are out of date (`worldBoss.ts`)

The code has 3,000,000 HP and a ×0.45 cut on boss hits. The changelog changed these several times; the **latest** values are:

- New bosses: **10,000,000 HP**, full damage multiplier **125×**, rewards from 25k, then **50k / 150k / 350k / 750k** loot tiers. Eternamax: 100M HP, tiers ×10. **[CL Nov 18, 19]**
- **Max Barrier:** your damage starts at 20% and reaches 100% after the boss loses 40% HP or after 2 minutes. Shields let through part of your damage. **[CL Nov 17, 18] [SIM]**
- Healing from damaging moves is cut by 50%, 75% and 90% in phases 1, 2 and 3. Status heals, abilities, items and Bag medicine heal in full. Drain and Shell Bell use your normal damage, not the boss bonus. **[CL Nov 19]**
- Encore fails. Bosses count as very heavy (Low Kick and Grass Knot at full power, Heavy Slam and Heat Crash at their weakest). A phase change ends Aqua Ring, Ingrain, Focus Energy, Charge and Magnet Rise. **[CL Nov 19, 20]**
- Eternamax Overdrive: each Atk or SpA boost adds 75% damage, up to a 350k per-action limit. Boosts carry over between your Pokémon. Its hits deal 70% less. Above 25 trainers, damage drops 4% per extra trainer, down to 60%. **[CL Nov 19]**
- If you don't act for 20 seconds, the boss attacks you, and keeps doing so every 20 seconds. **[CL Nov 19]**
- Still open from PLAN: the Battle tab uses raw boss moves, while Prep uses Max Moves.

### 1.4 Battle-screen and log changes that may break our readers

All from **[CL]**. Released 0.12.2 may already be misreading battles because of these:
- Stat changes now show as **Showdown-style tags with real multipliers** ("2× Atk", "0.67× Def"). `battleReader.ts` reads `title="Evasion +1"`.
- Red −N% and green +N% chips on damage and heals. Crit-stage tags (Focus Energy, Dragon Cheer).
- Log wording: the opponent's Pokémon is named with the trainer ("Brock's Geodude"), large numbers have commas, revealed abilities and item-boost lines are logged, World Boss logs drop "Opponent's", and Belly Drum and Anger Point "maximized" lines are new.
- Unavailable moves are greyed out and crossed out. The Items button is now "Healing and PP" (Balls appear in wild battles). Ether and Revive appear as shortcuts. The Weaknesses/EV panel is open by default and sits as a small card under the wild actions.
- Unrevealed NPC Pokémon show as silhouettes on League cards and in team lists.

### 1.5 Wiki data file (`_pokemon-star-wiki-data-*.js`, now about 7.9 MB)

- NPC team Pokémon carry ability, nature, item, **gender**, `baseStats`, IVs and EVs. **[DATA]** We already read these. **[CODE]**
- `species[].evolutions` (`{from, to, methods, supported}`) exists. **[DATA]** We only use it for Moon Stone hints (`normalize.ts` `fromWild`), so `potential.ts` still says "evolution is not in the dataset". This known data gap can be closed.
- New wiki pages worth reading for rules (not read yet): Doubles, Frontier battle rules, World Bosses, Max Moves (with calculator), Held items, Mega Chambers, Player Battles, Rivals (full level-120 teams), League Rematches, Abilities (316), EV training, IVs.

### 1.6 Non-battle changes (lower priority, Explore and Prep)

Dawn (06:00–06:59 UTC) and Dusk (18:00–18:59 UTC) phases. Dusk Ball ×3.5 at Dusk. Some species are about twice as likely at Dawn or Dusk. Rockruff (Dusk) and new Lycanroc rules. Starter "attraction" abilities (25% type pick). Map-chest TM odds cut. Rival TMs per rival. NPC Player Battles award EVs. EXP now scales with base HP. Scientist Ivo IV research. Exp. Share gives full EXP to every holder.

---

## 2. Workstreams

### WS-R `rules-research` · **Haiku or Sonnet @ low** (read-only subagent)
Read the wiki pages listed in 1.5 through Claude in Chrome (read only). Write **short summaries in our own words, no copied text** to `docs/design/wiki-rules-2026-11.md`, each line tagged with its page. Focus: Doubles targeting and AI, Frontier battle rules, World Boss rules, Max Move power table, held-item effects that differ from mainline, Mega Chamber protections, Player Battles rules.
- Feeds: WS1, WS3, WS5. Touches no `src/`.
- Done when: the file exists, and every rule that differs from mainline or from our code is flagged.

### WS0 `reader-recheck` · **Opus @ medium** · P0
Make the battle and wild readers handle the new screen (1.4) and read the on-screen field (weather and terrain buttons beside the turn counter).
- **Needs from the user:** Ctrl+S saves of (a) a League or Gym battle mid-turn with a stat change and active weather or terrain, (b) a wild battle, (c) a Doubles battle, (d) a World Boss battle. Saved into `tests/fixtures/`. Claude can also read a live battle through Claude in Chrome (read only).
- Files: `src/content/battleReader.ts`, `wildReader.ts`, the log parser, `tests/fixtures/*`, reader tests.
- Verify: reader tests against the new fixtures (first make each one fail on the old selectors), `npm test`, `npm run build`, then click through on the dev server (`meowhelper-dev`).
- Depends on: user saves. Blocks: WS3 (field read).

### WS1 `world-boss-2` · **Opus @ medium**
Update `worldBoss.ts` to the 1.3 values. Read HP from the data's "Shared HP" line first and fall back to 10M. Add: the barrier ramp (20%→100%), shield pass-through, per-phase drain cut, Encore fail, very-heavy weight, phase clears, Eternamax Overdrive and cap, and crowd scaling. Unify the Battle tab with the Prep Max Moves (the open PLAN gap). Show loot-tier progress (50k/150k/350k/750k).
- Calibrate against the simulator's World Boss mode (manual, a few cases, see WS2).
- Files: `src/engine/worldBoss.ts`, its tests, the Battle and Prep boss views, `bossStore.ts`.
- Verify: unit tests per rule; `npm test`, `npm run build`; click through Prep → World Boss on the dev server. "Not checked in a real boss battle" until the user plays one.
- Depends on: WS-R (World Boss page) is helpful but not required. Can run alongside WS0 (no shared files).

### WS2 `sim-golden-tests` · Claude in Chrome capture + **Sonnet @ medium** for the harness
Golden tests built from simulator output, **only for game-specific rules**: League source stats, Friendship 180/220/255, Mega Chamber, terrain, Gravity, the rooms, hazards and end-of-turn KO odds, and World Boss.
- **NPC vs NPC or made-up sets only.** Never the user's team, IVs, EVs or username (public repo). Keep each case small: inputs, rolls, `ko`, `first`.
- Capture by hand through the simulator UI, **about 30 calcs, only with the user's OK** (it is still a server request).
- Files: `tests/fixtures/simcalc/*.json`, `tests/simcalc.test.ts`. Expected failures for unmodelled rules are written as `it.todo`, not `.skip`, then switched on by WS3, WS4 and WS5.
- Depends on: user OK. Feeds: WS1, WS3, WS4.

### WS4 `friendship-mechanics` · **Opus @ medium**
Your-side Friendship: the survive-at-1-HP chance, crit ×2 at 255, and the −10 accuracy on opposing moves at 255. Only in modes that have it.
- First check that the box sync gives friendship (the simulator's "My team" does, so the data exists). If the box data shape changes, decide whether it is a `Dataset` change (it is probably box data, so no `SCHEMA_VERSION` bump).
- Files: `boxSync.ts`, `damage.ts` or `lookahead.ts` (crit, accuracy, survival node), `turnAdvisor.ts` (note "Friendship may let it survive"), tests.
- Verify: WS2 friendship cases turned on; `npm test`, `npm run build`.

### WS3 `field-effects` · **Opus @ high** (engine)
The full field model: all four terrains, Gravity, Magic Room, Wonder Room, Trick Room in Singles, hazards, and end-of-turn chip in KO odds (as the simulator does), and weather or terrain set by abilities on entry. Prefer the on-screen field from WS0 over rebuilding it from the log.
- Files: `supportMoves.ts` (field state), `damage.ts` (pass the Field to the calc), `lookahead.ts`, `turnAdvisor.ts`, `doublesAdvisor.ts`.
- Verify: WS2 field cases turned on; existing lookahead tests unchanged; `npm test`, `npm run build`; dev-server click-through with a fixture.
- Depends on: WS0 (field read), WS2.

### WS5 `npc-ai-model` · **Opus @ high** (engine)
Rebuild the NPC guess around 1.2's "What NPCs know":
- The NPC judges moves against **your estimated stats** (species and level; the IV and EV assumption is a guess, labelled as one).
- Regular trainers switch based on your **types**. Frontier remembers up to 4 of your moves.
- **The lead is always NPC slot 1.** Drop the lead guess and use it in `teamSuggest` and `leadPairs` (counter-lead).
- Mega Chamber: the first two scientists switch less.
- Files: `npcModel.ts`, `lookahead.ts` (switch guess), `teamSuggest.ts`, `leadPairs.ts`, `frontier.ts` (also the chosen Gen III ability), tests.
- Verify: unit tests; `npm test`, `npm run build`; then "Needs real-game check" for switch behaviour.
- Depends on: WS-R (Doubles and Frontier pages).

### WS6 `data-refresh` · **Sonnet @ medium**
- Re-run the sync against the current 7.9 MB file (acorn parse time and memory, any new or renamed fields). Add a test with a trimmed made-up sample, not a dump.
- Add `evolutions` to `Species` in `Dataset` → **bump `SCHEMA_VERSION` 5→6** (users must Sync again). Use it in `potential.ts` (Worth grinding counts the evolved form) and take it off PLAN "Known data gaps".
- Check that League NPCs' `baseStats` (source edition) reach the calc unchanged.
- Files: `src/data/normalize.ts`, `src/shared/types.ts`, `src/engine/potential.ts`, tests.

### WS7 `explore-time-of-day` · **Sonnet @ medium** (optional)
Dawn and Dusk phases in Explore and the catch plan: Dusk Ball ×3.5 at Dusk, the Dawn and Dusk species boosts, and the Rockruff (Dusk) rule. Optional add-on: an EV-training helper built on the wiki's EV yields.
- Files: `catching.ts`, `explore.ts`, `catchPlan.ts`, the Wild tab. Mark mechanics as guesses until seen.

### WS8 `sim-handoff` · **Sonnet @ medium** (quick win, no new requests)
An "Open in Battle Simulator" button plus "Copy as Showdown text" for the current matchup (Battle tab) and for a planned team vs an NPC (Prep). The user pastes it into the simulator's Text import. This gives exact game numbers with zero automation and zero extra requests.
- Files: a new small `src/engine/showdownExport.ts` with tests, and buttons in the Battle and Prep tabs.

### ~~WS9 `live-sim-calc`~~ · **dropped** (2026-11-22)
The extension would have sent the current matchup to `/api/wiki/battle-sim/calc` when the user pressed a button. Dropped by the user: the game admin is unlikely to approve a new kind of game request. WS8 (copy as Showdown text, paste into the simulator) covers the need.

### Release `release-0.13` · **Sonnet @ medium**
After WS0, WS1 and WS6 at minimum: 0.13.0 with World Boss 2, the reader fixes and the schema bump (users must Sync). Steps: `docs/WORKFLOW.md#release`.

---

## 3. Order and what can run in parallel

```
Phase A (parallel):   WS-R research · WS6 data-refresh · WS8 sim-handoff · (user: Ctrl+S saves, OK for WS2)
Phase B (parallel):   WS0 reader-recheck · WS1 world-boss-2 · WS2 sim-golden-tests
Phase C (one at a time, they share damage/lookahead/turnAdvisor):  WS4 friendship → WS3 field-effects → WS5 npc-ai-model
Phase D:              release-0.13 (can ship after B) · WS7 (any time)
```

- **Shared-file conflicts:** WS3, WS4 and WS5 all edit `lookahead.ts` and `turnAdvisor.ts` (WS3 and WS4 also edit `damage.ts`), so run them one after another on separate branches and merge each before the next starts. WS1 only touches `worldBoss.ts` and the boss UI. WS0 only touches `src/content/`. WS6 touches `src/data/`, `types.ts` and `potential.ts`. WS8 touches the UI plus one new engine file.
- `SCHEMA_VERSION` is bumped only in WS6.
- The previously planned **Hunt & Grind** (`docs/design/hunt-and-grind-spec.md`) waits until after Phase B. It benefits from WS6 (evolutions).

## 4. To add to PLAN "Needs real-game check"

- [ ] New stat-change tags, ±N% chips, and the field buttons beside the turn counter (WS0)
- [ ] Friendship survive and crit effects in a real battle (WS4)
- [ ] NPC switching based on your types, and NPC slot-1 lead (WS5)
- [ ] World Boss barrier ramp, drain cuts, loot tiers in a real raid (WS1)
- [ ] Dusk Ball ×3.5 and Dawn/Dusk spawn boosts (WS7)

## 5. Decisions for the user

1. **WS2:** OK to run about 30 manual simulator calcs (NPC vs NPC) to build golden tests?
2. ~~**WS9:** ask the game admin about an opt-in "Check with game calc" button?~~ Decided: no, WS8 instead.
3. **"Environment":** this plan reads it as the battle field (weather, terrain, rooms, hazards = WS3). If you also meant Dawn/Dusk and time of day, WS7 moves up.
4. **WS0:** send Ctrl+S saves of the 4 battle screens listed under WS0.
5. **Priority:** Phase A+B before Hunt & Grind?
