# Tasks: Label-Gated Merge Line

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces coverage.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.

---

## T-001 — Trigger firing mode + schema

- **Refs**: FR-1, FR-5
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/machines/registry.ts`, `schema/blueprint.schema.json`, `app/src/compiler/compile.ts`
- **Verify**: `npx vitest run src/machines/schema.test.ts` (drift guard) + the labeled/default emission tests.

## T-002 — Warning logic + terminal-line safety

- **Refs**: FR-2, FR-3, NFR-SEC-1, AC-2, AC-3
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.ts`, `app/src/compiler/compile.test.ts`
- **Verify**: scoped line has zero unscoped-merge warnings; unscoped labeled mode warns; no bot guard on the terminal line.

## T-003 — Gallery template

- **Refs**: FR-4, AC-1
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/templates/catalog.ts`
- **Verify**: `npx vitest run src/templates/catalog.test.ts` — compiles with zero error diagnostics.

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` verified; `cd app && npm test && npm run build` green.
- **`## Follow-ups Discovered` populated below.**

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id.

- BL-20260818-04 — doc-gap, low — Dogfood note: wire the Dependency Warden's vetting to the new label-gated automerge line on gitorio itself (Warden labels, deterministic line merges) and retire the Warden's own merge grant — the full ADR-015 end-state.
