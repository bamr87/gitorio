# Seed 05 — Prompt Studio & scheduling view

**Objective:** prompts are first-class: browsable, editable, linted, reviewable.

**Context:** docs/ARCHITECTURE.md §7 · .factory/prompts/*

**Tasks**
1. Prompt library: list `.factory/prompts/`, open in an editor with frontmatter as a form + body as markdown; show which machines reference each prompt.
2. Writes go through a PR by default (branch `factory/prompts-<slug>`), direct commit behind a checkbox. Diff view before submitting.
3. Lint: frontmatter present; `inputs` and obligations note stated; no obvious
secrets (regex for key-like strings); warn on "ignore previous instructions"-bait and on missing untrusted-content clause.
4. Schedule overview: parse cron machines, render next 5 runs each (client-side), flag overlapping heavy schedules.

**Acceptance:** ROADMAP Phase 5 boxes. **Out of scope:** prompt versioning UI beyond git history, A/B runs.
