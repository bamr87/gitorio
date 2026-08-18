# Spec: Per-Line Names for Multi-Line Blueprints

- **ID**: 006-per-line-names
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-18
- **Roadmap link**: BL-20260816-16 (a "known rough edge" since ADR-018)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

Multi-line blueprints emit `factory--<meta.name>-<index>.yml` — meaningless in the Actions UI, unstable under line insertion, and the reason the Docs Gardener needed a standalone blueprint.

## 2. Origin & Background

- Backlog items claimed: BL-20260816-16.
- Builds on: ADR-010 (shared partition helper), ADR-018 (standalone-blueprint workaround this obsoletes).

## 3. Goals

- G1: A multi-line blueprint's workflows are named by what each line is.

## 4. Non-Goals

- NG1: Auto-renaming existing deployments (opt-in only; silent renames orphan files and detach run history).
- NG2: Migrating gitorio's factories 1–3 to auto naming in this cycle (deliberate follow-up).

## 5. User Stories

- As an operator, I want `factory--docs-gardener.yml` instead of `factory--gitorio-factory-4.yml`, so the Actions list reads like a factory floor plan.

## 6. Functional Requirements

- **FR-1**: `meta.lineNaming: 'auto'` names each line by its agent's promptRef basename; deterministic lines fall back to `<first-trigger>-<first-sink>` type names.
- **FR-2**: Colliding derived names get deterministic numeric suffixes by component order.
- **FR-3**: Single-line blueprints always keep `meta.name`; default (`indexed`) behavior is byte-identical for existing blueprints.
- **FR-4**: `compile()` and `assemblyLines()` share the naming computation (telemetry can never diverge from filenames).

## 7. Non-Functional Requirements

- **NFR-DET-1**: Naming is a pure function of the blueprint (no I/O, stable across runs).

## 8. Blueprint & Schema Impact

`meta.lineNaming` enum added to types + schema meta branch.

## 9. Compiler & Workflow Impact

`lineNames()` helper feeding both `compile()` and `assemblyLines()`; no emission changes beyond filenames/headers.

## 10. UI Impact

None this cycle (meta is JSON-edited; an Inspector meta toggle rides the existing BL-20260818-03 follow-up).

## 11. Security Impact

None — naming only.

## 12. Acceptance Criteria

- **AC-1**: The two-line fixture compiles to `factory--docs-gardener.yml` + `factory--pr-opened-merge-pr.yml` under auto naming.
- **AC-2**: Default mode still emits `factory--gitorio-factory-1.yml`/`-2.yml`.
- **AC-3**: `assemblyLines()` returns the same filenames as `compile()` for the same blueprint.
- **AC-4**: Duplicate promptRef basenames yield `gardener.yml` + `gardener-2.yml`.

## 13. Risks & Open Questions

- **R-1**: Renaming a line later orphans the old workflow file — mitigated: opt-in, documented; deploy-planner cleanup is a filed follow-up.

## 14. Out of Scope / Follow-ups

- Migrate gitorio's main blueprint (factories 1–3 + fold in the Docs Gardener) to `lineNaming: 'auto'` — an operational redeploy, its own cycle.
- Deploy planner: detect and offer to remove orphaned previously-named `factory--*.yml`.
