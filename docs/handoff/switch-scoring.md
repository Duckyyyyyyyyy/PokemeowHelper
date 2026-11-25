# switch-scoring: make move/switch advice beat "strongest move"
Branch/worktree: master, released as 0.16.0 · Updated: 2026-11-26 · Model: Opus @ high (engine redesign)
## Done
- Steps 1–3: harness in `scripts/audit/` (README there), switch scoring in `lookahead.ts` (`leaf()`: `v` ranks, `shown` is the 0–100 number), accepted on new seeds. Numbers: `docs/PLAN.md`, Ongoing.
- Revive (`Lookahead.revive()`), Sturdy / Focus Sash (`holdsOn` in damage.ts), lead ties (teamSuggest.ts), opponent HP bar, Truant, sure KO, drain crash.
- NPC medicine: note only (`mayHeal()`, `medicinesLeft` in turnAdvisor.ts). Scoring it cost wins unless NPCs heal exactly as reported.
## Next
1. Check 0.16.0 in a real battle (PLAN, "Needs real-game check").
2. Each measured separately with the harness: weather, terrain, screens, Tailwind, Trick Room, hazards in singles damage (`makeField('singles')` is empty; `fieldFromLog` and `snap.field` already read them); Struggle above a switch; Sitrus Berry; Sturdy in Doubles.
## Verify
- `npm test`, `npm run build`. A scoring change needs paired wins: tune on one set of seeds, confirm on another (used so far: 900, 3000–8000).
## Gotchas
- A partial run misleads: +4.4 after part of the battles became +0.8 on all 480. Wait for all of them.
- A cap of 3 projected duels costs 6.9 ± 2.2 wins; `DUELS = 12` with the calc limit at 350 (user's OK).
- The 0–100 number can dip 2–3 points against the ranking (Wave Crash); the test checks `rank` (user's OK).
- `.base/` copies need no `node_modules`. Stop leftover `audit.mts` node processes after a timeout. Git Bash heredocs eat backslashes: write scripts with the Write tool.
