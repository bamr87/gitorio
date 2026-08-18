# Plan: Label-Gated Merge Line

> Companion to `spec.md`.

## 1. Architecture Overview

A firing-mode extension of the PR trigger composed with the existing terminal merge sink — the two ADR-014 invariants (terminal = no retrigger, terminal-only = no bot guard) do the safety work.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Registry | `app/src/machines/registry.ts` | `fireOn` + `label` fields on `trigger.pr_opened` |
| Schema | `schema/blueprint.schema.json` | pr_opened branch gains both keys |
| Compiler | `app/src/compiler/compile.ts` | labeled branch in the trigger case; `prLabelScoped` in the merge-warning condition |
| Templates | `app/src/templates/catalog.ts` | `label-gated-automerge` (2 nodes, deterministic) |
| Docs | `docs/ARCHITECTURE.md` §4 | catalog line updated |

## 3. Blueprint & Schema Changes

Optional keys only; default path byte-identical (FR-5, asserted by test).

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Shape | Firing mode on `trigger.pr_opened` | New `trigger.pr_labeled` machine | Same event source; 21 machine types stay 21 |
| Label gate | Trigger config → job-level guard | Require a Filter node | Single-node policy; same emitted `if` |

## 5. Least Privilege & Permissions

The line grants only what `sink.merge_pr` always granted (`contents` + `pull-requests: write`); no agent, no other verbs.

## 6. Loop Guards & Untrusted Input

Merging emits no event the line subscribes to (terminal, ADR-014) — structurally loop-free; the deliberate bot-guard omission is regression-tested. No untrusted text enters the workflow (label names are operator-created).

## 7. Test Strategy

Five invariants: labeled emission + guard, deterministic step + permissions + no agent, no-bot-guard assertion, warning logic both ways, default-mode byte-behavior. Template covered by catalog compile-clean test.

## 8. Rollout

Template in the gallery; pairs with the Dependency Warden (label `dep:safe-to-merge`) exactly as ADR-015 envisioned.

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Label misuse merges a bad PR | low | med | triage-permission gate on labels + `--auto` waits for required checks + branch protection |

## 10. Estimated Effort

One loop cycle (done).
