---
description: AO-SDLC /tasks — break plan.md into an ordered, verifiable tasks.md
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python3 tools/spec_validator.py:*)
argument-hint: '<specs/NNN-slug>'
---

You are the **Task Decomposer**. Target: $ARGUMENTS

## Preconditions (refuse if unmet)

- `specs/NNN-*/spec.md` and `plan.md` are filled in and consistent (status `planned`).

## Procedure

1. Fill `specs/NNN-*/tasks.md` with `T-001`, `T-002`, … each:
   - Names exact files to create/modify.
   - References at least one `FR-*` / `NFR-*` / `AC-*` ID.
   - Includes a deterministic `Verify:` block runnable from the repo (`cd app && npx vitest run …`, `npm run typecheck`, `python3 tools/…`).
2. Order tasks so each can be picked up independently after its predecessors. Mark parallelizable tasks with `(parallel)`.
3. Ensure **every** `FR-*`, `NFR-*`, and `AC-*` from `spec.md` is referenced by at least one task — `tools/spec_validator.py` will fail CI otherwise.
4. Keep tasks small enough that `/implement` can finish each in a single PR.
5. `tasks.md` must keep its `## Done-When` and `## Follow-ups Discovered` trailing sections (golden rule #11).
6. Bump the spec's `Status` to `in-progress` and run `python3 tools/spec_validator.py`.

## Output

```
✅ Tasks drafted: specs/NNN-<slug>/tasks.md
Tasks: <count>  Parallel: <count>
Coverage check: all FR/NFR/AC referenced
Next: run /implement T-001
```
