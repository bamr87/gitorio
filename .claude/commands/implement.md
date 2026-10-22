---
description: AO-SDLC /implement — implement one task from tasks.md, with gates + follow-ups
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm test:*), Bash(npm run build:*), Bash(npm run typecheck:*), Bash(npx vitest:*), Bash(python3 tools/*), Bash(git:*), Bash(gh pr create:*), Bash(gh pr view:*)
argument-hint: '<T-NNN inside specs/NNN-slug>'
---

You are the **Implementation Agent** for a single task: $ARGUMENTS

## Required reading

1. The task block in `tasks.md`.
2. The referenced `FR-*` / `NFR-*` / `AC-*` lines in `spec.md`.
3. The matching section of `plan.md`.
4. `AGENTS.md` golden rules (always).
5. The actual current contents of every file the task lists under `Files`.

## Procedure

1. Mark the task `[~]` (in-progress) in `tasks.md`.
2. Make the smallest possible change that satisfies the task and its referenced ACs. Do **not** refactor unrelated code. Never hand-edit generated `factory--*.yml` (golden rule #2).
3. Add or update invariant tests per golden rule #3 (critical YAML fragments, not golden strings). A new machine type follows the full golden rule #8 DoD (`/add-machine`).
4. Run the task's `Verify:` block plus `cd app && npm test && npm run build`.
5. Mark the task `[x]` only when verification passes.
6. **Record follow-ups (mandatory, golden rule #11).** Before opening the PR:
   - Add at least one bullet under `## Follow-ups Discovered` in `tasks.md` for any refactor opportunity, missing test, doc gap, or stretch feature you noticed but did not implement. If there are truly none, replace the placeholder with `_none — justified: <reason>_`.
   - Mirror each new bullet into `BACKLOG.md` under `## Open` with a `BL-YYYYMMDD-NN` id (`python3 tools/next_backlog_id.py`).
   - Run `python3 tools/spec_validator.py` and `python3 tools/backlog_lint.py` — both must exit 0.
   - Run `python3 tools/unwrap-prose.py --check` (markdown-oneline CI rule).
7. If asked to open a PR: branch first (never commit to `main` directly), reference `specs/NNN-<slug>/` + the task ID in the description, complete the PR-template checklist, and copy the new follow-up bullets into the body. Otherwise report and stop before committing.

## Output

```
✅ Implemented T-XXX (specs/NNN-<slug>)
Files changed: <list>
Tests: <pass count> / <total>
Follow-ups added: <BL-...>, <BL-...>
PR: <url or "not opened">
```

Stop after one task. Do **not** start the next task without a fresh `/implement` invocation.
