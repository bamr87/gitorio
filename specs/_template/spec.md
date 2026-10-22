# Spec: {Feature Name}

- **ID**: NNN-feature-slug
- **Status**: draft | clarified | planned | in-progress | shipped
- **Owner**: @github-handle
- **Created**: YYYY-MM-DD
- **Roadmap link**: phase / section in [docs/ROADMAP.md](../../docs/ROADMAP.md), or the issue this advances
- **Golden-rules compliance**: confirmed against [AGENTS.md](../../AGENTS.md) § Golden rules

## 1. Problem & Motivation

What user/automation problem does this solve? Quote concrete pain from the ROADMAP, an ADR, telemetry, or a live incident.

## 2. Origin & Background

Which `BL-*` items from [BACKLOG.md](../../BACKLOG.md) this spec claims (move them to `## Claimed` annotated `claimed-by:specs/NNN-<slug>`), plus any prior ADRs or specs it builds on.

- Backlog items claimed: BL-…

## 3. Goals

- G1: …
- G2: …

## 4. Non-Goals

- NG1: …

## 5. User Stories

- As a {role}, I want {capability}, so that {outcome}.

## 6. Functional Requirements

Use stable IDs — `tasks.md` and tests reference these.

- **FR-1**: …
- **FR-2**: …

## 7. Non-Functional Requirements

- **NFR-SEC-1**: e.g. new sink grants only `Bash(gh issue comment:*)`-narrow tools + computed `permissions:` (golden rule #5).
- **NFR-LOOP-1**: e.g. no compiled workflow can retrigger itself unguarded (golden rule #6).
- **NFR-PERF-1**: e.g. polling stays ETag-conditional; no background polling.

## 8. Blueprint & Schema Impact

Machine types added/changed, config fields, `schema/blueprint.schema.json` changes (keep the registry/schema drift guard green), blueprint encoding compatibility.

## 9. Compiler & Workflow Impact

Emitters touched in `app/src/compiler/compile.ts`, permissions computation, loop-guard interactions, `examples/compiled/` refresh needed, upstream `claude-code-action` inputs to verify (golden rule #4).

## 10. UI Impact

Tabs/panels/stores touched (`app/src/panels/`, `app/src/state/`), design-token compliance, a11y notes.

## 11. Security Impact

Untrusted-content paths (golden rule #9), secret handling (golden rule #7), tool-grant ceiling changes, fork-PR behavior. State "none" only with a reason.

## 12. Acceptance Criteria

Each criterion must be objectively testable. Maps 1:N to tasks.

- **AC-1**: Given …, when …, then ….
- **AC-2**: …

## 13. Risks & Open Questions

- **R-1**: …
- **OQ-1**: … (resolve via `/clarify` before moving to plan)

## 14. Out of Scope / Follow-ups

- …
