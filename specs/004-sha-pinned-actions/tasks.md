# Tasks: SHA-Pinned Actions Mode

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces coverage.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.

---

## T-001 — Verify upstream SHAs (golden rule #4)

- **Refs**: NFR-PURE-1
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: none (research)
- **Verify**: `gh api repos/…/git/ref/tags/…` for checkout@v4, fetch-metadata@v2, claude-code-action@v1 (annotated tag dereferenced) — SHAs recorded in the table comment.

## T-002 — Types + schema + compiler transform

- **Refs**: FR-1, FR-2, FR-3
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/blueprint/types.ts`, `schema/blueprint.schema.json`, `app/src/compiler/compile.ts`
- **Verify**: `npx vitest run src/compiler/compile.test.ts src/machines/schema.test.ts` — 85 tests green.

## T-003 — Invariant tests incl. drift guards

- **Refs**: FR-4, AC-1, AC-2, AC-3
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.test.ts`
- **Verify**: pinned/unpinned/override/fetch-metadata assertions + the source-reading pin-table guard all pass.

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` verified; `cd app && npm test && npm run build` green.
- **`## Follow-ups Discovered` populated below.**

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id.

- BL-20260818-02 — infra, low — `/compile-check` step that re-verifies `PINNED_ACTIONS` against live upstream tag refs and reports drift.
- BL-20260818-03 — feature, low — Inspector meta-form toggle for `pinActions` (the flag is JSON-only today).
