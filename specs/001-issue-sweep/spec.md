# Spec: Issue Sweep — clear the defect/tech-debt/infra backlog

- **ID**: 001-issue-sweep
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-17
- **Roadmap link**: docs/ROADMAP.md § Backlog (frozen history; items live in BACKLOG.md)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

The repo carries a cluster of known defects and hygiene gaps: a live-incident compiler bug (an agent ordered to read its operating prompt with no `Read` grant — Factory 3 starved at max-turns on every run, draft PR #37), two machine types with zero invariant tests, an unenforced blueprint config schema, stale `examples/compiled` with no regen path, four small UI defects, no lint toolchain, Pages deploys that ignore CI, and a class of date-fixture time bombs (one already turned CI red for two weeks). "Fix all issues" — this spec claims and clears every locally-actionable defect-class item.

## 2. Origin & Background

- Backlog items claimed: BL-20260817-02, BL-20260817-01, BL-20260816-07, BL-20260816-08, BL-20260816-09, BL-20260816-10, BL-20260816-11, BL-20260816-14
- Builds on: ADR-023 (promptRef grant invariant, adopted from draft PR #37), ADR-022 (this AO-SDLC process), ADR-018 (generator-script pattern). Draft PR #32 (fleetops clock pin) is superseded by the equivalent fix already in this tree.

## 3. Goals

- G1: Every claimed defect fixed with a regression test where testable.
- G2: All gates green afterward: `npm test`, `npm run build`, `npm run lint` (new), both AO-SDLC validators, markdown-oneline.

## 4. Non-Goals

- NG1: Feature-class backlog items (belt mode, OODA dispatcher, marketplace, per-line names…) stay open.
- NG2: Items needing the user or a live scratch repo: LICENSE choice (BL-20260816-13), permission allowlist (BL-20260816-12), §8 red-team pass (BL-20260816-20).
- NG3: Merging or closing the open GitHub PRs (#32/#37/#38) — outward actions left to the user.

## 5. User Stories

- As a factory operator, I want deployed agent lines to actually complete their obligations, so that scheduled runs stop burning budget on permission denials.
- As a contributor, I want schema/lint/CI gates to catch config and style drift, so that review effort goes to substance.

## 6. Functional Requirements

- **FR-1**: The compiler grants `Read`/`Glob`/`Grep` to every non-feedback agent with a `promptRef`, and `Bash(gh pr checks:*)` under survey mode (ADR-023).
- **FR-2**: `filter.condition` and `sink.commit_files` each have compiler invariant tests.
- **FR-3**: `schema/blueprint.schema.json` constrains each machine type's config to its registry-declared fields/types, with a registry↔schema drift-guard test.
- **FR-4**: A committed `regen-examples` script recompiles `examples/compiled/*` deterministically (idempotent on second run) and covers a no-agent deterministic line and a PR-triggered line.
- **FR-5**: UI defects fixed: blob-URL revocation after download, `say()` timer cleared, Inspector numeric fields blankable, React error boundary wrapping the shell.
- **FR-6**: ESLint flat config + Prettier exist; `npm run lint` passes and runs in CI.
- **FR-7**: `deploy-pages.yml` deploys only after a successful CI run on main (manual dispatch still works).
- **FR-8**: No test feeds absolute-date fixtures into a real-clock windowed derivation (clock pinned where it does).

## 7. Non-Functional Requirements

- **NFR-SEC-1**: No agent write surface widens; the FR-1 additions are read-only (golden rule #5).
- **NFR-TEST-1**: Fixes assert critical fragments, not golden strings (golden rule #3).

## 8. Blueprint & Schema Impact

FR-3 tightens node `config` validation per type; committed `.factory/*.blueprint.json` must still validate; the registry `type` enum drift guard stays green.

## 9. Compiler & Workflow Impact

FR-1 changes emitted `--allowedTools` for every non-feedback agent line (read-only additions), so `examples/compiled/*` regenerate (FR-4) and deployed factories should be recompiled on next deploy. CI gains a lint step; Pages deploy chains off CI via `workflow_run`.

## 10. UI Impact

App shell wrapped in an error boundary; download/flash/Inspector fixes are behavior-preserving except where the old behavior was the bug.

## 11. Security Impact

FR-1 is grant widening in the read-only direction only, consistent with ADR-013's ceiling model; no secrets, no loop-guard changes, no untrusted-content path changes.

## 12. Acceptance Criteria

- **AC-1**: `cd app && npm test && npm run build && npm run lint` all pass; `python3 tools/spec_validator.py` + `python3 tools/backlog_lint.py` + `python3 tools/unwrap-prose.py --check` exit 0.
- **AC-2**: A Factory-3-shaped blueprint (comment/label/merge sinks, promptRef agent) compiles with `Read`, `Glob`, `Grep` in its grant.
- **AC-3**: The schema test fails if a registry field is added/renamed without a schema update (drift guard), and the committed blueprints validate.
- **AC-4**: Running `regen-examples` twice produces zero changes on the second run.
- **AC-5**: `deploy-pages.yml` has no independent `push` trigger; its deploy job is conditioned on CI success while `workflow_dispatch` still deploys.

## 13. Risks & Open Questions

- **R-1**: First-time ESLint adoption can demand mass edits — mitigated by tuning rules to the current code rather than mass-editing (rule-off beats churn).
- **R-2**: Regenerated examples intentionally differ from the previously committed ones (FR-1 changed grants) — the diff is the fix, not drift.

## 14. Out of Scope / Follow-ups

- Recompile/redeploy the live deployed factories (gitorio's own `factory--*.yml`) to pick up the FR-1 grants — tracked as a follow-up in tasks.md.
