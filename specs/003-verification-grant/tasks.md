# Tasks: Verification Grant

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces coverage.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.

---

## T-001 — Registry field + schema branch

- **Refs**: FR-1
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/machines/registry.ts`, `schema/blueprint.schema.json`
- **Verify**: `npx vitest run src/machines/schema.test.ts src/machines/registry.test.ts` — drift guard green with the pair.

## T-002 — Compiler emission + safety diagnostics

- **Refs**: FR-2, FR-3, NFR-SEC-1, AC-1, AC-2
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/compiler/compile.ts`, `app/src/compiler/compile.test.ts`
- **Verify**: `npx vitest run src/compiler/compile.test.ts` — 76 tests incl. the 5 new checks invariants.

## T-003 — Regenerate law-ai lines + prompt wording

- **Refs**: FR-4, AC-3
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/scripts/gen-aosdlc-factory.ts`, law-ai blueprints/workflows/prompts, law-ai `BACKLOG.md` (BL-20260817-07 → Done)
- **Verify**: greps — both validator grants in pilot/triage YAML, none in concierge; law-ai validators + oneline green.

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` verified; `cd app && npm test && npm run build` green; both repos' validators green.
- **`## Follow-ups Discovered` populated below.**

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id.

- BL-20260818-01 — feature, low — Render check grants as readable phrases in `describeWorkflow` (Inspector "Capabilities · compiled" + Monitor drill-down) instead of raw Bash patterns.
