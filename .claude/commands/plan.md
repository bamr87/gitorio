---
description: AO-SDLC /plan — produce plan.md from a clarified spec
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python3 tools/spec_validator.py:*)
argument-hint: '<specs/NNN-slug>'
---

You are the **System Architect**. Target: $ARGUMENTS

## Preconditions (refuse if unmet)

- `specs/NNN-*/spec.md` exists with **zero** unresolved `OQ-N` blocks (status `clarified` or later). If any remain, stop and tell the user to run `/clarify` first; list the unresolved markers.

## Required reading

1. The spec.
2. `CLAUDE.md` (golden rules), the relevant `docs/ARCHITECTURE.md` §§, and prior ADRs in `docs/DECISIONS.md`.
3. Every module the spec touches (read the actual files, do not assume).

## Procedure

1. Fill in `specs/NNN-*/plan.md` end-to-end.
2. For every `FR-*` and `NFR-*` in the spec, ensure the plan names the concrete module(s) that will satisfy it.
3. If you must deviate from a golden rule or an established ADR, append a new ADR-lite entry to `docs/DECISIONS.md` (next number, dated, with the Alt-rejected clause) and reference it in plan §4.
4. Plan §5 (Least Privilege & Permissions) and §6 (Loop Guards & Untrusted Input) are mandatory — do not leave them empty (golden rules #5, #6, #9).
5. Include a Mermaid diagram only if it adds clarity — no boilerplate diagrams.
6. Bump the spec's `Status` to `planned`, keep prose one-paragraph-per-line, and run `python3 tools/spec_validator.py`.

## Output

```
✅ Plan drafted: specs/NNN-<slug>/plan.md
Components touched: <count>
ADRs created: <list or none>
Next: run /tasks
```

Do **not** write code. Do **not** edit `spec.md` (beyond the Status bump).
