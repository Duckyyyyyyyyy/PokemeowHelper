# Hunt & Grind for an NPC – spec (agreed 2026-11-19, built 2026-11-22)

Built in Prep → Hunt & grind (`src/engine/hunt.ts`, `src/ui/components/HuntCard.tsx`, hunt list in `mdHunt`).

**Goal:** pick an NPC → MeowHelper says which Pokémon to catch on maps you've unlocked, where they are, and how far to grind them so your team beats that NPC.

1. **Reachable maps only.** Guessed from data MeowRPGAdvisor already has (no new game request): maps seen on the Explore encounter card, ticked Tips, and the NPC's place on the Tips progress path. Skip maps that need Surf or a Rod you don't have. A toggle shows locked maps with "how to unlock" from Tips.
2. **Findable species only.** Common and Rare tiers; no legendary, extremely rare or event-only Pokémon.
3. **Judging a candidate.**
   - Imagine it trained to the NPC's level (or the level cap), with average IVs and the moves it learns by then.
   - Score it against the NPC's team with the Worth grinding scorer (`potential.ts`).
   - Count evolutions when the data has them (level-based ones via `evolvedAt`; the card says when it is scored as the evolved form).
4. **When it's suggested.** Only if it beats a member of your current grind team or covers an NPC Pokémon nobody in your box handles. If your box already covers everything, say so.
5. **What each card shows.**
   - Where: map, walking/Surf/Rod, rarity, day/night, level range.
   - Why: "Answers Salamence and Altaria with Ice Beam (Lv 40)".
   - Grinding: levels needed and the final moveset.
   - Catching: catch difficulty and the best ball in your bag.
6. **Hunt list.** A "Hunt list" button adds the Pokémon to a list. Explore marks those Pokémon on its maps, and a hunt-list encounter shows **CATCH**, "on your hunt list for <NPC>", alongside the Catchlist/Pokédex rule.
7. **Where it lives.** In the Team tab for the selected NPC, next to Worth grinding. The Battle tab links to it when you don't have the right Pokémon.
