# Seed 00 — Bootstrap & verify

**Objective:** a fresh clone builds, tests, and runs; you know the codebase.

**Context:** CLAUDE.md · docs/ARCHITECTURE.md §1–5 · app/src/compiler/compile.ts

**Tasks**
1. `cd app && npm install`. Resolve any dependency/peer issues; prefer upgrading a
   pinned range over downgrading tooling. Log anything notable in DECISIONS.md.
2. `npm test`, `npm run typecheck`, `npm run build`, `npm run dev` — all green.
   Open the dev server, drag one of each machine category, connect belts, compile.
3. Compare the compile drawer output for `.factory/blueprint.json` against
`examples/compiled/factory--issue-triage-line-1.yml`; note divergences as TODOs in compile.ts (do not fix yet — that's seed 02).
4. Fetch https://raw.githubusercontent.com/anthropics/claude-code-action/main/action.yml
   and confirm the inputs used in our templates still exist (golden rule #4).
5. Screenshot the canvas → docs/img/baseline.png. Update CLAUDE.md § Current state.

**Acceptance:** ROADMAP Phase 0 boxes. **Out of scope:** features, refactors.
