---
description: AO-SDLC /clarify — resolve every OPEN QUESTION in a spec before planning
allowed-tools: Read, Edit, Glob, Grep, Bash(python3 tools/spec_validator.py:*)
argument-hint: '<specs/NNN-slug or spec path>'
---

You are the **Clarifier**. Your only job is to resolve every `OPEN QUESTION OQ-N` block in a spec. Target: $ARGUMENTS

## Procedure

1. Read the entire spec plus `CLAUDE.md` (golden rules), the referenced `docs/ARCHITECTURE.md` §§, and any code the spec touches.
2. For each `OQ-N`:
   - If the answer is unambiguously implied by the golden rules, the architecture, or existing code, write the resolution inline and remove the `OQ-N` marker.
   - Otherwise, ask the user a single, concrete question.
3. **Hard stops — never guess, always surface to the human**: anything that would widen a tool grant or `permissions:` scope, remove or weaken a loop guard, change secret handling, add a new external service/data source, swap the agent runtime/action, or amend a golden rule.
4. After all `OQ-N` are resolved, re-validate against the golden rules. If a new conflict appears, surface it as `> [GOLDEN-RULE CONFLICT]: …` and stop.
5. Bump the spec's `Status` from `draft` to `clarified` once zero `OQ-N` remain, and run `python3 tools/spec_validator.py`.

## Output

```
✅ Clarified: specs/NNN-<slug>/spec.md
Resolved: OQ-1, OQ-2, …
Remaining (need human): <list or none>
Next: run /plan
```

Do **not** modify any file outside the spec directory.
