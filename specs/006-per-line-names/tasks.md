# Tasks: Per-Line Names

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces coverage.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.

---

## T-001 — lineNames helper + both call sites

- **Refs**: FR-1, FR-2, FR-3, FR-4, NFR-DET-1
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.ts`, `app/src/blueprint/types.ts`, `schema/blueprint.schema.json`
- **Verify**: `npx vitest run src/compiler/compile.test.ts src/machines/schema.test.ts` green.

## T-002 — Invariant tests

- **Refs**: AC-1, AC-2, AC-3, AC-4
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.test.ts`
- **Verify**: the five ADR-028 tests pass (auto/default/equality/collision/single-line).

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` verified; `cd app && npm test && npm run build` green.
- **`## Follow-ups Discovered` populated below.**

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id.

- BL-20260818-05 — feature, med — Migrate gitorio's main blueprint to `lineNaming: 'auto'` and fold the standalone Docs Gardener into it (regenerate + clean up the old indexed filenames) — the ADR-028 payoff redeploy.
- BL-20260818-06 — tech-debt, low — Deploy planner: detect previously-deployed `factory--*.yml` orphaned by a line rename and offer their removal in the plan.
