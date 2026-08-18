# Tasks: Issue Sweep

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces that every requirement in `spec.md` is referenced by at least one task.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.

---

## T-001 — Adopt PR #37's promptRef read-grant fix (ADR-023)

- **Refs**: FR-1, NFR-SEC-1, AC-2
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.ts`, `app/src/compiler/compile.test.ts`, `docs/DECISIONS.md`
- **Steps**: apply the PR's compiler hunks; renumber its ADR to ADR-023 (022 was taken by the AO-SDLC adoption).
- **Verify**: `cd app && npx vitest run src/compiler/compile.test.ts` — 61 passed.

## T-002 — Invariant tests for filter.condition + sink.commit_files (parallel)

- **Refs**: FR-2, NFR-TEST-1
- **Owner**: @agent:tests-machines
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.test.ts`
- **Verify**: `cd app && npx vitest run src/compiler/compile.test.ts`.

## T-003 — Per-type config subschemas + drift guard (parallel)

- **Refs**: FR-3, AC-3
- **Owner**: @agent:schema-oneof
- **Status**: `[x]`
- **Files**: `schema/blueprint.schema.json`, `app/src/machines/schema.test.ts` (new)
- **Verify**: `cd app && npx vitest run src/machines/schema.test.ts src/machines/registry.test.ts`.

## T-004 — Regen script + golden anchors, then regenerate (parallel)

- **Refs**: FR-4, AC-4
- **Owner**: @agent:regen-examples
- **Status**: `[x]`
- **Files**: `app/scripts/regen-examples.ts` (new), `examples/**`
- **Verify**: `cd app && npx vite-node scripts/regen-examples.ts` twice — second run writes nothing.

## T-005 — UI polish batch (parallel)

- **Refs**: FR-5, NFR-TEST-1
- **Owner**: @agent:ui-polish
- **Status**: `[x]`
- **Files**: `app/src/App.tsx`, Inspector, `ErrorBoundary` (new) + tests, a store test
- **Verify**: `cd app && npx vitest run` on the touched test files + `npx tsc --noEmit`.

## T-006 — ESLint flat config + Prettier + lint in CI (parallel)

- **Refs**: FR-6, AC-1
- **Owner**: @agent:lint-infra
- **Status**: `[x]`
- **Files**: `app/eslint.config.js` (new), `app/.prettierrc.json` (new), `app/package.json`, `.github/workflows/ci.yml` (build job only)
- **Verify**: `cd app && npm run lint` exits 0.

## T-007 — Gate Pages deploy on CI success (parallel)

- **Refs**: FR-7, AC-5
- **Owner**: @agent:deploy-gate
- **Status**: `[x]`
- **Files**: `.github/workflows/deploy-pages.yml`
- **Verify**: YAML parses; `workflow_run` + conclusion condition present; dispatch path intact.

## T-008 — Date-fixture sweep

- **Refs**: FR-8
- **Owner**: @agent:date-sweep
- **Status**: `[x]`
- **Files**: any `app/src/**/*.test.ts` with real-clock-windowed absolute dates
- **Verify**: `npx vitest run` on touched files.

## T-009 — Exit gates + status bumps

- **Refs**: AC-1, NFR-SEC-1, NFR-TEST-1
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: this spec package, `BACKLOG.md`
- **Steps**: full `npm test && npm run build && npm run lint`; validators; oneline check; move claimed BL items to `## Done`; bump spec status to `shipped`; also regenerated the four deployed `factory--*.yml` from their blueprints so the live lines pick up the ADR-023 grants (the spec §14 follow-up, done in-tree), and pinned `@testing-library/dom` as an explicit devDependency after the lockfile regeneration dropped it.
- **Verify**: all commands exit 0.

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` from `spec.md` covered by passing checks.
- `cd app && npm test && npm run build` green.
- `python3 tools/unwrap-prose.py --check` clean.
- **`## Follow-ups Discovered` section below populated.**

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id.

- BL-20260817-06 — tech-debt, low — Revert the `typescript` alias devDependency to a plain spec once typescript-eslint supports TS ≥ 7.1 (tracked upstream; the alias exists only so eslint can parse under the native TS 7 toolchain).
- BL-20260817-07 — tech-debt, low — Re-enable `react-hooks/set-state-in-effect` (two deliberate hits were rule-off'd) and clear the five advisory `exhaustive-deps` warnings.
