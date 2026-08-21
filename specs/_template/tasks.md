# Tasks: {Feature Name}

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces that every requirement in `spec.md` is referenced by at least one task.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.
- Each task lists exact files to touch and how to verify.

---

## T-001 — {Short imperative title}

- **Refs**: FR-1, AC-1
- **Owner**: @bamr87
- **Status**: `[ ]`
- **Files**:
  - `app/src/…` (new)
  - `app/src/compiler/compile.test.ts` (extend)
- **Steps**:
  1. …
  2. …
- **Verify**:
  - `cd app && npx vitest run src/compiler/compile.test.ts` passes.
  - `cd app && npm run typecheck` clean.

## T-002 — …

- **Refs**: FR-2, NFR-SEC-1
- **Owner**: …
- **Status**: `[ ]`
- **Files**: …
- **Steps**: …
- **Verify**: …

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` from `spec.md` covered by passing tests.
- `cd app && npm test && npm run build` green.
- New machine type? The golden rule #8 DoD is complete (registry + config + emitter + invariant test + ARCHITECTURE §4 catalog line + renders on canvas).
- `python3 tools/unwrap-prose.py --check` clean (the markdown-oneline CI rule).
- **`## Follow-ups Discovered` section below populated** — at minimum, every implementer must record one of: a new BACKLOG entry, a refactor candidate, a missing test, or `_none_` (must be justified in the PR).

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id (`python3 tools/next_backlog_id.py`). CI ([tools/spec_validator.py](../../tools/spec_validator.py)) checks this section exists. CI ([tools/backlog_lint.py](../../tools/backlog_lint.py)) checks the BACKLOG mirror.

- _none_  <!-- replace with bullets like: "BL-YYYYMMDD-NN — feature, med — short description." -->
