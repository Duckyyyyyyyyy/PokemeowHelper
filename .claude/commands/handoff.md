---
description: Save a short handoff note for the current task so a fresh session can continue it
argument-hint: <slug>
---

Write `docs/handoff/$ARGUMENTS.md` (if no slug was given, pick a short kebab-case one from the task) using the format in `docs/WORKFLOW.md` → "Handoff note format".

Rules:
- Keep it under 40 lines. Point to `file:line` rather than pasting code.
- "Next" must be concrete enough that a fresh session can start without rereading this conversation.
- "Verify" says exactly which commands ran and their result, plus what is still unverified.
- No personal data (this repo is public).
- Update the task's line in `docs/PLAN.md` → Ongoing to `(handoff: <slug>)`.

Then tell the user: "Saved. Run /clear, then /resume-task <slug>."
