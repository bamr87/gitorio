# Spec: Label-Gated Merge Line

- **ID**: 005-label-gated-merge
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-18
- **Roadmap link**: BL-20260816-06 (parked by ADR-015 after the live merge incident)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

ADR-015's incident: an agent merged a held PR because a prose guardrail lost to a plausible reason. The structural fix — merge policy compiled to YAML with no agent judgment in the merge path — stayed parked for six weeks.

## 2. Origin & Background

- Backlog items claimed: BL-20260816-06.
- Builds on: ADR-014 (terminal `sink.merge_pr` + bot-guard relaxation), ADR-015 (the incident), ADR-009 (actor-based guards).

## 3. Goals

- G1: "Merge anything labelled `X`" is expressible as a two-node deterministic line.

## 4. Non-Goals

- NG1: A new machine type (this is a firing mode of the existing PR trigger).
- NG2: Replacing branch protection — `--auto` defers to required checks.

## 5. User Stories

- As an operator, I want the Warden to *label* and a deterministic line to *merge*, so no agent's judgment sits in the merge path.

## 6. Functional Requirements

- **FR-1**: `trigger.pr_opened` gains `fireOn` (opened | labeled) + `label`; labeled mode emits `pull_request: [labeled]` and, with a label set, the job guard `github.event.label.name == '<label>'`.
- **FR-2**: A label-scoped trigger suppresses the unscoped-merge warning; labeled mode with no label warns ("fires on EVERY label add").
- **FR-3**: The labeled→merge line stays terminal: no bot guard (the labeler may be the vetting bot), deterministic `gh pr merge` step, `contents`+`pull-requests: write`.
- **FR-4**: A `label-gated-automerge` gallery template ships and compiles clean.
- **FR-5**: Default `fireOn: opened` keeps existing blueprints byte-identical.

## 7. Non-Functional Requirements

- **NFR-SEC-1**: No agent step appears in the compiled line; the only write is the merge itself.

## 8. Blueprint & Schema Impact

Two new optional config keys on `trigger.pr_opened` (schema branch updated; drift guard green).

## 9. Compiler & Workflow Impact

Trigger case gains the labeled branch + `prLabelScoped` feeds the merge-warning condition. Deterministic merge emission unchanged (already existed, ADR-014).

## 10. UI Impact

Fields render from the registry; the describe() string shows `[labeled: <label>]`.

## 11. Security Impact

Strictly narrowing: the merge fires only on an exact label event, auto-merge honors required checks, and removing the label before checks pass cancels nothing the operator didn't ask for. Bot-guard omission is deliberate and terminal-only (ADR-014).

## 12. Acceptance Criteria

- **AC-1**: The template's YAML contains `labeled`, the exact-label guard, `gh pr merge "$NUMBER" --squash --auto`, and no `claude-code-action`.
- **AC-2**: No `sender.type != 'Bot'` guard appears on the terminal line.
- **AC-3**: Scoped line → zero unscoped-merge warnings; unscoped labeled mode → the every-label warning.

## 13. Risks & Open Questions

- **R-1**: A stolen label could trigger a merge — mitigated: label-add rights require triage permission, `--auto` still waits for required checks, and branch protection is the enforcement backstop (documented in the template blurb).

## 14. Out of Scope / Follow-ups

- A `labeled` mode for `trigger.issue_labeled` parity on PR *un*label events (none identified as needed; revisit on demand).
