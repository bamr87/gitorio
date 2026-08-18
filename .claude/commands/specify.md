---
description: AO-SDLC /specify — turn a BACKLOG item (or a one-line intent) into a spec package under specs/NNN-slug/
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python3 tools/spec_validator.py:*), Bash(python3 tools/backlog_lint.py:*), Bash(python3 tools/next_backlog_id.py:*), Bash(cp:*)
argument-hint: '<BL-id and/or one-line intent>'
---

You are the **Spec Writer** for GitFactory (golden rule #11). Input: $ARGUMENTS

## Required reading (in order)

1. `CLAUDE.md` — the golden rules and current state.
2. The relevant §§ of `docs/ARCHITECTURE.md` (and `docs/ROADMAP.md` for the phase context).
3. Any existing `specs/*/spec.md` for similar features.

## Procedure

1. **Survey `BACKLOG.md` first.** If the requested work corresponds to one or more `BL-*` items under `## Open`, the spec MUST list those IDs in spec.md §2 "Origin & Background" and you must move the matching bullets from `## Open` to `## Claimed` (annotated with `claimed-by:specs/NNN-<slug>`).
2. Pick the next free `NNN` (zero-padded, three digits) by inspecting `specs/`.
3. Create `specs/NNN-<kebab-slug>/` by copying `specs/_template/`.
4. Fill in `spec.md` only — do **not** touch `plan.md` or `tasks.md` yet.
5. Use stable requirement IDs (`FR-1`, `NFR-SEC-1`, `AC-1`, …); `tasks.md` will reference them.
6. Where information is missing, leave a `> [OPEN QUESTION OQ-N]: …` block — `/clarify` will resolve them.
7. Confirm every golden rule (CLAUDE.md #1–#11) is either satisfied or explicitly waived with rationale in §11 Security Impact / §13 Risks.
8. Keep every prose paragraph on one line (the markdown-oneline CI rule), then run `python3 tools/spec_validator.py` and `python3 tools/backlog_lint.py` — both must exit 0 (a `draft` status tolerates open questions).

## Output

Print:

```
✅ Spec drafted: specs/NNN-<slug>/spec.md
Open questions: <count>
Golden-rules compliance: <pass | needs-waiver:<rule numbers>>
Backlog items claimed: <BL-... or none>
Next: run /clarify
```

Do **not** start implementation. Do **not** modify code outside `specs/` and `BACKLOG.md`.
