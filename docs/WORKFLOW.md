# Workflow

## Session loop

1. **Start:** read `docs/PLAN.md`. If the task has a note, `/resume-task <slug>` reads `docs/handoff/<slug>.md` only.
2. **Work:** use a branch or worktree per feature (`claude/<slug>`). Grep before reading, and read line ranges of big files.
3. **Verify:** `npm test`, then `npm run build` if `src/` changed. For UI, use the `meowhelper-dev` preview.
4. **Finish:**
   - Move the PLAN item to Done with one line and the version.
   - Delete `docs/handoff/<slug>.md` if it exists.
   - Commit when the user asks.
5. **Not finished, or context is long:** `/handoff <slug>`, then `/clear`, then `/resume-task <slug>` in the fresh session.

## Handoff note format (`docs/handoff/<slug>.md`)

These notes are tracked in a public repo, so write no personal data. Keep each note under about 40 lines.

```
# <slug>: <one-line goal>
Branch/worktree: <name> · Updated: <YYYY-MM-DD>
## Done
- <what changed, file:line>
## Next
1. <concrete next step>
## Verify
- <commands run + result; what is not verified>
## Gotchas
- <decisions, dead ends, assumptions to check>
```

## Real-game checks

- The user plays and Claude only reads the page, using Claude in Chrome. Never click game actions.
- Record what was confirmed in the PLAN "Needs real-game check" list (tick or remove the item). Long findings go in a short section of `docs/archive/PLAN-v1.md` or a new `docs/notes/<topic>.md`.

## Release

1. Merge to master, then run `npm install` (branches may add dependencies).
2. Bump the version in `package.json`, `package-lock.json` and `public/manifest.json`: minor for features, patch for fixes.
3. Add one line under PLAN → Done. Commit as `MeowRPGAdvisor x.y.z: …`, and merge as `Merge MeowRPGAdvisor x.y.z: …`.
4. Run `npm run package`, which writes `release/MeowRPGAdvisor-x.y.z.zip`.
5. Push master, then send the zip to the user with SendUserFile. The gh CLI isn't installed, so don't create a GitHub Release.
