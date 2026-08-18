# Spec: Verification Grant — repo-declared checks for agent lines

- **ID**: 003-verification-grant
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-18
- **Roadmap link**: BL-20260817-04 (gitorio) / BL-20260817-07 (law-ai) — the gap both repos filed after ADR-024
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

ADR-024's honest-grant posture meant a factory agent that edits `BACKLOG.md`/`specs/` could not run the validators gating those files — every check deferred to PR CI, so a broken edit round-trips through a failed PR instead of being fixed in-run.

## 2. Origin & Background

- Backlog items claimed: BL-20260817-04 (and resolves law-ai's mirror BL-20260817-07).
- Builds on: ADR-023 (prompt/grant coherence), ADR-024 (grant honesty), ADR-013 (ceiling model).

## 3. Goals

- G1: A blueprint can declare exact check commands an agent may run; nothing wider is granted.

## 4. Non-Goals

- NG1: A general Bash grant or configurable tool ceiling (golden rule #5 forbids it).
- NG2: A pipeline-stage verifier machine (checks run inside the agent's work loop).

## 5. User Stories

- As a line author, I want my evolve pilot to run `spec_validator`/`backlog_lint` before opening its PR, so reviewers see verified edits, not CI roulette.

## 6. Functional Requirements

- **FR-1**: `agent.claude` gains a `checks` config field (textarea, one command per line) in registry + schema (drift guard stays green).
- **FR-2**: The compiler grants exactly `Bash(<command>:*)` per declared line and emits a VERIFY prompt note listing the checks.
- **FR-3**: A check containing `"`, a backtick, or `$( )` is a compile **error**; blank lines are dropped.
- **FR-4**: law-ai's evolve-pilot + backlog-triage regenerate with the two stdlib validators declared (concierge unchanged); prompts updated to match.

## 7. Non-Functional Requirements

- **NFR-SEC-1**: The grant stays config-derived — prompt content (including injected issue text) can never mint a check grant (golden rules #5/#9).

## 8. Blueprint & Schema Impact

One new optional string field on `agent.claude`; schema branch updated in the same change (the registry↔schema drift guard enforces the pairing).

## 9. Compiler & Workflow Impact

Prompt assembly gains the VERIFY note between plan-note and obligations; the tools set gains one narrow Bash pattern per check. Regenerated: law-ai's two PR-writing lines.

## 10. UI Impact

The field renders automatically in the Inspector from the registry; a readable-phrase rendering in the capability drill-down is a follow-up.

## 11. Security Impact

Grant widening is opt-in per blueprint, reviewed like all blueprint changes, syntactically fenced against quoting/substitution, and never merge/workflow verbs.

## 12. Acceptance Criteria

- **AC-1**: Declared checks appear as their own `Bash(<cmd>:*)` grants and in the VERIFY note; empty config emits neither.
- **AC-2**: A quoted/substituting check fails compilation with an error diagnostic.
- **AC-3**: Regenerated law-ai pilot/triage workflows contain both validator grants; the concierge contains none.

## 13. Risks & Open Questions

- **R-1**: A declared check could itself be a dangerous command — mitigated: blueprints are reviewed artifacts, the pattern grants only that literal command, and substitution syntax is a compile error.

## 14. Out of Scope / Follow-ups

- Readable rendering of check grants in `describeWorkflow` capability drill-down (mirrored to BACKLOG).
