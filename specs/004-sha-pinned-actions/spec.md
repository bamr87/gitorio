# Spec: SHA-Pinned Actions Mode

- **ID**: 004-sha-pinned-actions
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-18
- **Roadmap link**: BL-20260816-03 (migrated from ROADMAP § Backlog); pairs with the fleet audit's `pin-sha` rule (ADR-021)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

Fleet Ops' audit rewards SHA-pinned `uses:` refs, but the compiler could only emit floating tags — GitFactory recommended a posture it couldn't produce.

## 2. Origin & Background

- Backlog items claimed: BL-20260816-03.
- Builds on: ADR-021 (`pin-sha` audit rule), golden rules #3 (pure compiler) and #4 (verify upstream).

## 3. Goals

- G1: A blueprint can opt into fully SHA-pinned workflow output with tags preserved as comments.

## 4. Non-Goals

- NG1: Pinning by default (floating-tag repos keep their convention; opt-in only).
- NG2: Deploy-time SHA resolution via the API (breaks compiler purity/determinism).
- NG3: Regenerating gitorio's or law-ai's deployed lines with pinning (both repos use tags by convention today).

## 5. User Stories

- As a security-conscious operator, I want compiled workflows pinned to audited commits, so a hijacked tag can't change what my factory executes.

## 6. Functional Requirements

- **FR-1**: `meta.pinActions: true` (schema + types) or the `pinActions` compile option pins every emitted `uses:` ref via the curated `PINNED_ACTIONS` table.
- **FR-2**: Pinned refs carry the original tag as a trailing YAML comment (`@<sha> # v4`), added post-stringify so the emitter cannot quote it into the ref.
- **FR-3**: Default output stays byte-identical to pre-feature output.
- **FR-4**: Drift guards — every `pinRef(...)` call site's ref exists in the table, and no bare `uses:` literal bypasses the wrapper.

## 7. Non-Functional Requirements

- **NFR-PURE-1**: No I/O in the compiler — pins are a static table verified out-of-band against upstream tag refs (verified 2026-08-18).

## 8. Blueprint & Schema Impact

`meta.pinActions?: boolean` added to `BlueprintMeta` and the schema's meta branch; node configs untouched.

## 9. Compiler & Workflow Impact

Three emission sites route through `pinRef`; YAML assembly gains the `annotatePins` pass when pinning is on.

## 10. UI Impact

None this cycle — an Inspector meta-form toggle is a follow-up.

## 11. Security Impact

Strictly hardening: opt-in immutability of executed action code; no grant, guard, or secret changes.

## 12. Acceptance Criteria

- **AC-1**: A pinned blueprint's YAML contains `anthropics/claude-code-action@459ad358ae43fea66bfefd0a1f8d840b4b9791fb # v1` and the checkout/fetch-metadata equivalents; no floating tag remains.
- **AC-2**: An unpinned blueprint's YAML contains the tag refs and no SHA.
- **AC-3**: The pin-table drift guard fails if an emitted ref lacks a table entry or a `uses:` literal bypasses `pinRef`.

## 13. Risks & Open Questions

- **R-1**: Pins go stale as upstream majors move — mitigated: the table documents the re-verification command, and refreshing it is a follow-up wired toward `/compile-check`.

## 14. Out of Scope / Follow-ups

- `/compile-check` step verifying `PINNED_ACTIONS` against live upstream tag refs (mirrored to BACKLOG).
- Inspector meta-form toggle for `pinActions` (mirrored to BACKLOG).
