# Tasks: Cross-Repo Signal Trigger

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces coverage.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.

---

## T-001 — Machine + schema + emitter (rule #8 DoD)

- **Refs**: FR-1, FR-2, FR-3, FR-4, NFR-SEC-1
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/machines/registry.ts`, `schema/blueprint.schema.json`, `app/src/compiler/compile.ts`, `docs/ARCHITECTURE.md`
- **Verify**: `npx vitest run src/machines/registry.test.ts src/machines/schema.test.ts` — drift guards green with the 22nd type.

## T-002 — Invariant tests

- **Refs**: AC-1, AC-2, AC-3
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.test.ts`
- **Verify**: the five ADR-029 tests pass (typed emission, empty-type warning, survey grants, numbers-not-bodies, deterministic NUMBER chain).

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` verified; `cd app && npm test && npm run build` green.
- **`## Follow-ups Discovered` populated below.**

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id.

- BL-20260818-07 — feature, med — `sink.repository_dispatch`: the sending end of the belt (POST `/dispatches` on a target repo with a scoped PAT secret + event type + `number` pointer), pairing with the new trigger.
- BL-20260818-08 — feature, low — Combined-canvas inter-repo belts (sharpened from BL-20260816-22's remainder): render dispatch sender→receiver edges across observed repos in the Fleet map.
