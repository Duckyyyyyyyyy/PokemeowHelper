---
description: Continue a task from its handoff note (docs/handoff/<slug>.md)
argument-hint: <slug>
---

1. If no slug was given, list `docs/handoff/` and ask which one.
2. Read `docs/handoff/$ARGUMENTS.md`, and only the `Ongoing` section of `docs/PLAN.md`. Don't read other docs unless the note points to them.
3. Check the branch/worktree named in the note (`git status`, `git log -3 --oneline`) and confirm the "Done" items exist in code.
4. State the model/effort line (CLAUDE.md), give a 3-line summary of where the task stands, and start the first "Next" step.
