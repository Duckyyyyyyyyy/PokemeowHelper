# Wiki rules digest (read 2026-11-22, WS-R `rules-research`)

Own-words summary of the game wiki's battle rule pages. Tags: `[DIFF-MAINLINE]` differs from Gen 9, `[DIFF-CODE: file]` contradicts or is missing in our code, `[OK]` matches. No team lists or player data here.

## Double Battles (#/challenges/doubles)
- Doubles users: Tate & Liza, Raihan, Ryme (League and rematches stay doubles). Bring at least 2 team members. [OK]
- You submit one turn for both positions; both choices are validated together (no same medicine twice, no same bench mon sent in twice). [OK: doublesAdvisor.ts pairs actions]
- Moves can target one foe, an ally, self, all foes or a wider area; partner can be hit by spread moves. [OK: doublesAdvisor.ts models ally hit]
- Page says nothing about the x0.75 spread cut or Trick Room; the page has no field-effect detail. [DIFF-CODE: doublesAdvisor.ts] our x0.75 is from one live observation, still unconfirmed by wiki.
- Abilities page has a whole "Ally support" category (Battery, Friend Guard, Plus/Minus, Power Spot, Receiver, Steely Spirit, Telepathy, Costar, Power of Alchemy, Curious Medicine, Hospitality). [DIFF-CODE: doublesAdvisor.ts] none are modelled; only support moves are scored.

## Frontier battle rules (#/challenges/battle-frontier/battle-rules)
- Gen III rules: no Fairy type; former Fairy species and moves revert to Gen III typing (Charm, Sweet Kiss, Moonlight are Normal). [DIFF-MAINLINE] [OK: gen3.ts]
- Physical/special is decided by move type (Gen III split); Ghost and Steel are physical, Dark is special. [DIFF-MAINLINE] [OK: gen3.ts GEN3_PHYSICAL_TYPES]
- Steel resists Ghost and Dark. [DIFF-MAINLINE] [OK: gen3.ts]
- Moves keep Gen III power/accuracy (e.g. Thunderbolt, Flamethrower, Ice Beam, Surf 95; Blizzard 120; High Jump Kick 85). [OK: gen3.ts]
- Species use Gen III base stats and abilities. Hidden Abilities and abilities added later never carry over. [OK]
- The player CHOOSES one of the species' Gen III abilities at registration (a Hustle Rattata picks Run Away or Guts); a species with one Gen III ability uses it. [DIFF-CODE: gen3.ts] `gen3AbilityFor` maps a later ability to the species' FIRST Gen III ability and has no player choice. Only wrong for species with two.
- Only Gen I-III moves and held items. Allowed examples: Leftovers, Choice Band, Lum, Sitrus, Shell Bell, Quick Claw, Focus Band, White Herb. Life Orb, Choice Scarf, Choice Specs, Focus Sash, Assault Vest are banned. No Mega, Z, Dynamax, Tera. [OK: frontier.ts / gen3Issues]
- Actual levels, natures, IVs, EVs are kept. Opponents use Emerald Frontier teams and Emerald battle AI. [OK]
- Opponent knowledge: sees species/form, level, types, HP, status, stat changes, field, revealed ability/item. Estimates your stats from species and level. Does not know unused moves, hidden ability/item, unseen team, your current choice. [DIFF-CODE: npcModel.ts] our model does not restrict to this information.
- Frontier AI remembers up to 4 of your used moves until that Pokémon switches out; other trainers judge danger from your types. Illusion fools the AI. [DIFF-CODE: npcModel.ts] no move memory, no types-only mode.
- Wild Pokémon and World Bosses pick from their own moves without judging your build. [DIFF-CODE: npcModel.ts] we use a smart heuristic for all NPCs, including bosses.

## World Boss Battles (#/challenges/world-bosses)
- Unlock: Dynamax Band from Galar Champion Leon. One boss per hour, 10 minutes to win, up to 100 trainers (Eternamax 150). [OK]
- Boss HP 10,000,000 (Eternamax 100,000,000). [DIFF-CODE: worldBoss.ts] `DEFAULT_BOSS_HP = 3_000_000`.
- Your damage is 125x ordinary, capped at 50,000 per action (Eternamax 350,000). [DIFF-CODE: worldBoss.ts] no 125x or per-action cap.
- Boss attacks do 55% less damage (Eternamax 70% less), applies to ALL bosses, no HP cap. [DIFF-CODE: worldBoss.ts] `BOSS_DAMAGE_MULT = 0.45` is right for ordinary bosses (header calls it UNVERIFIED; now confirmed). Eternamax needs 0.30.
- Max Barrier: you start at 20% damage, rising until it breaks after 40% HP lost or 2 minutes (Eternamax: 1% HP or 30 seconds). [DIFF-CODE: worldBoss.ts] not modelled.
- Shield at start, 75% and 40% HP for 20 seconds: damage x0.5, blocks status moves on the boss, removes secondary effects. [OK: worldBoss.ts]
- Each phase change clears the boss's status and lowered stats and removes its boosts; boss boosts capped at Atk/SpA +2 and Def/SpD +1. [DIFF-CODE: worldBoss.ts] not modelled.
- Phase 3 (below 40%): extra Max Move every third full turn you take (own count per attempt), with warning. [OK] (shown as a note, not counted)
- Boss gets one action per full turn; medicine and voluntary switches use your turn; replacing after a faint does not. Idle 20 s: boss attacks you anyway, repeating every 20 s. [DIFF-MAINLINE] [DIFF-CODE: worldBoss.ts] no idle-hit model.
- Gigantamax and Eternamax bosses use Max/G-Max for every attack; other bosses use normal moves, only phase-3 extra attacks are Max Moves. [DIFF-CODE: worldBoss.ts] header says "every attack is a Max Move", wrong for non-GMAX bosses.
- Healing from damaging moves cut 50/75/90% in phases 1/2/3. Recover-style moves, abilities, held items, Bag medicine heal in full. Shell Bell, drain, recoil use ordinary (unboosted) damage. [DIFF-MAINLINE] [DIFF-CODE: worldBoss.ts] not modelled.
- Boss cannot have types/ability/item changed. Fails: Destiny Bond, Perish Song, Endeavor, Pain Split, OHKO, Leech Seed, Curse, Salt Cure, Encore. Perish Body cannot start a countdown. Boss cannot flinch/confuse/infatuate. [DIFF-MAINLINE] [DIFF-CODE: worldBoss.ts] Encore, Leech Seed, Curse, Salt Cure missing from the fail list.
- Boss counts as very heavy: Low Kick and Grass Knot full power, Heavy Slam and Heat Crash weakest. [DIFF-CODE: worldBoss.ts / damage.ts] check weight handling.
- Sleep/freeze stops one boss action then 20 s immunity. Toxic becomes regular poison. Poison and burn deal at most 1,000 per shared 5 s tick. [DIFF-MAINLINE]
- Rocky Helmet, Jaboca, Rowap deal no damage to the boss. Its attacks bypass your Wonder Guard. [OK: rules.ts for Wonder Guard]
- Eternamax Overdrive: each Atk/SpA stage adds 75% damage on top (+2 x2.5, +4 x4, +6 x5.5); boosts carry to your next Pokémon, reset on full wipe and at the 75%/40% shockwaves; self-lowering moves (Draco Meteor, Overheat, Superpower) lower the bonus. [DIFF-CODE: worldBoss.ts] not modelled.
- Above 25 trainers, damage and the per-action cap drop 4% per extra trainer, floor 60% at 35+. [DIFF-CODE: worldBoss.ts] not modelled.
- Actions: one per 3 seconds. Rejoin 30 s after leaving. Hardcore faints are permanent. [OK, note only]
- Loot tiers 50k/150k/350k/750k damage, need 50k plus a victory (Eternamax x10). [DIFF-CODE: worldBoss.ts] check any tier text.
- Combat gives no ordinary EXP, EVs, friendship or League progress. [OK]
- Bosses are level 100, first ability, Hardy, 31 IVs, no EVs, no held item. [OK]
- 34 default bosses rotate. Moves per appearance can change. [OK]

## Max Moves (#/moves/max-moves)
- Only owned GMAX Pokémon (every battle) and World Bosses use Max Moves; no Dynamax, no 3-turn limit, no HP boost. Not used in Frontier. [DIFF-MAINLINE] [DIFF-CODE: damage.ts] check that your own GMAX mons convert moves in the Battle tab (PLAN open item: Battle tab uses raw boss moves).
- A damaging move becomes the Max Move of its type; the GMAX species' signature-type moves become the G-Max move. Status moves become Max Guard (priority, repeat use less likely to work). [OK]
- Original move PP is used; no accuracy check; Max Moves lose original priority. [OK in header assumptions]
- Power table: base <=40 -> 90, 45-50 -> 100, 55-60 -> 110, 65-70 -> 120, 75-100 -> 130, 110-140 -> 140, >=150 -> 150. Fighting and Poison are lower (70/75/80/85/90/95/100). G-Max Drum Solo, Fireball, Hydrosnipe are always 160. [OK: matches mainline Gen 8 table]
- Spread moves become single-target in doubles. [DIFF-MAINLINE]
- Protect/Detect still let about 25% through; Max Guard blocks fully except G-Max One Blow and Rapid Flow. [DIFF-CODE: worldBoss.ts] check.
- Max Move side effects: terrain and weather setting, stat changes on all allies or foes (list on the page); G-Max moves as in mainline. [DIFF-CODE: supportMoves.ts] not modelled for field.

## Held items (#/items/held-items)
- Held equipment consumed, removed, flung or swapped in battle is restored for the next battle (unlike Bag use). [DIFF-MAINLINE]
- Exp. Share is a held item: every living holder gets full base EXP. Lucky Egg +50% EXP. Soothe Bell x1.5 friendship gain (still capped at 160 for walking/level-ups/vitamins; berries reach 255). Destiny Knot also infatuates the opponent in battle. [DIFF-CODE: heldItems.ts] not modelled; Soothe Bell relevant to WS4.
- Page is mostly drop rates; battle-relevant held effects are described per item elsewhere. [OK]

## Mega Chambers (#/challenges/mega-chambers)
- 3 battles (two Scientists, then the Master), teams of 6 at level 100 using the Mega form's types; Master's sixth slot is the Mega form. Teams are fixed per chamber and stage. [OK]
- Entry 1,000 Mega Energy (hatch +100, evolve +50, level +5, catch +2). Healing allowed between battles; changing your team ends the attempt. [OK]
- Mega Evolution in League is not used; the Bracelet gives permanent Mega via Evolve in My Pokémon. [DIFF-MAINLINE]
- Nothing on switching AI for the first two scientists. [DIFF-CODE: npcModel.ts] the earlier note (CL Nov 14) is not on this page.

## Player battles (#/challenges/player-battles)
- Two modes: NPC (computer plays a saved team) and Live PvP. Formats Singles, Doubles, Triples at actual level, Level 50 or Level 100. Bag medicine is unavailable in both. [DIFF-MAINLINE]
- Triples exists: edge Pokémon reach only adjacent positions; center reaches all; edge can shift to center; if each side has one Pokémon left and non-adjacent they auto-center. [DIFF-MAINLINE] [DIFF-CODE: doublesAdvisor.ts] no Triples support.
- No friendship, quests, League progress, coins or items. EVs only at actual levels (NPC mode). [OK: friendship is not changed here]
- Live PvP: 60 s decision timer (miss = loss), 30-minute match limit, restrictions (disabled items, generations, No Mega, No Gigantamax). Hardcore faints are temporary in PvP. [DIFF-MAINLINE]

## Rivals (#/challenges/rivals) (rules only)
- 36 rivals unlocked after clearing every active League rematch in a region. Six fully evolved level-120 Pokémon, trained IVs/EVs, some Megas. [OK]
- Bag medicine allowed. 4 independent 5% drop rolls (battle item, special balls, Elixir, own exclusive TM) plus a 1-in-1000 icon. [OK]
- Level 120 is above the mainline cap of 100. [DIFF-MAINLINE] [DIFF-CODE: damage.ts] check that the calc and any level clamp allow 120.

## League rematches (#/challenges/league-rematches) (rules only)
- Rematch Pokémon: 31 IVs, 508 total EVs, trained nature and item; each trainer has two Full Restores. [DIFF-CODE: npcModel.ts] NPC healing items not modelled (they spend a turn).
- No level cap for your team. No Mega, Z, Dynamax, Gigantamax or Tera in the League. [OK]
- Four final opponents swap in rematches (Blue->Red, Wallace->Steven, Alder->Iris, Geeta->Nemona). [DIFF-CODE: matchNpc in turnAdvisor.ts] verify name matching.
- Quick-leave penalty: fewer than 2 turns or within 20 seconds counts as leaving; repeated leaves cause a short wait. [OK, not relevant to advice]
- Tate & Liza, Raihan, Ryme stay doubles in rematches. [OK]

## Battle supplies (#/items/battle-supplies)
- Using Bag medicine takes your turn and the opponent still acts; useless items are refused and not consumed. [DIFF-MAINLINE]
- Potion heals 20, Super 60, Hyper 120, Max full, Moomoo Milk 100, Revive half HP, Max Revive full; revives unavailable in Hardcore. Full Restore heals and cures. [DIFF-MAINLINE] [DIFF-CODE: turnAdvisor.ts] check heal amounts if the advisor suggests medicine.
- Ether/Max Ether (one move), Elixir/Max Elixir (all). Berries usable from the Bag: Oran 10 HP, Sitrus quarter HP, status berries, Leppa 10 PP. Held berry triggers automatically and is restored after battle. [DIFF-MAINLINE]
- In wild battles balls appear in the Healing and PP panel. [OK]

## Abilities (#/abilities)
- Every Pokémon has exactly one ability; wild Pokémon never get Hidden Abilities. [DIFF-MAINLINE]
- Forms stay fixed in battle: Zen Mode, Stance Change, Battle Bond, Power Construct, Schooling, Shields Down, Forecast, Flower Gift, Disguise and Ice Face keep the selected form. Read each signature ability's page for what still works. [DIFF-MAINLINE] [DIFF-CODE: damage.ts / rules.ts] check any form-change assumptions.
- 316 abilities in 16 categories; 29 have overworld effects and some have Pike/Pyramid effects (not battle-relevant). [OK]
- Weather and terrain setters on entry (Drought, Drizzle, Sand Stream, Snow Warning, the Surge abilities, Desolate Land, Primordial Sea, Delta Stream, Seed Sower...) exist. [DIFF-CODE: supportMoves.ts] not modelled.

## Action items by workstream

### WS1 world-boss-2
- HP to 10M (Eternamax 100M); damage multiplier 125x with per-action cap 50k (Eternamax 350k); boss attack cut 55% (Eternamax 70%).
- Max Barrier (20% start, breaks at 40% HP or 2 min; Eternamax 1% or 30 s) and the 4%-per-trainer reduction above 25 trainers (floor 60%).
- Only GMAX and Eternamax bosses use Max Moves for every attack; ordinary bosses use normal moves, Max only in phase-3 extra attacks.
- Heal reduction 50/75/90% in phases for damaging-move healing only; Shell Bell and drain use unboosted damage.
- Add fails: Encore, Leech Seed, Curse, Salt Cure; very heavy weight; phase-change clears and boost caps (+2 offense, +1 defense); poison/burn tick cap 1,000; sleep/freeze 20 s immunity; Toxic becomes poison.
- Idle 20 s boss hit, 3 s action rate, Overdrive Mode (75% per Atk/SpA stage, carry-over, resets), loot tier numbers.
- Own GMAX Pokémon convert moves everywhere, including the Battle tab (PLAN open item).

### WS3 field-effects
- Weather and terrain entry abilities; Max Move weather/terrain side effects; Max Move partial Protect pass-through (25%).
- Terrain beyond Misty and Trick Room are not described on these pages; confirm on Battle Simulator or in a real battle.

### WS4 friendship-mechanics
- Soothe Bell (x1.5 gain) and Luxury Ball (+1 on each gain) belong to friendship growth tracking; no battle friendship effects on these pages (Player Battles and World Boss grant none).

### WS5 npc-ai-model
- NPC knowledge limits: types-only judging for ordinary trainers, 4-move memory for Frontier, wild and bosses pick moves without judging.
- League rematch trainers carry two Full Restores.
- Mega Chamber AI note is not on the page.

### Other
- Frontier: player chooses a Gen III ability at registration; `gen3AbilityFor` picks the first one (gen3.ts).
- Triples format in Player Battles has no engine support.
- Rival teams are level 120; check the calc and level clamps.
- Medicine heal amounts (Potion 20, Super 60, Hyper 120, Moomoo Milk 100) if medicine is ever suggested.
- Held equipment is restored after battle; Destiny Knot infatuation reflection; Exp. Share and Lucky Egg only matter for EXP planning.
