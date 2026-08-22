# Spec: Cross-Repo Signal Sender (sink.repository_dispatch)

- **ID**: 008-dispatch-sender
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-18
- **Roadmap link**: BL-20260818-07 (pairs with ADR-029's trigger; completes the inter-repo belt)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

ADR-029 gave belts a receiving socket with no first-class sender — cross-repo signaling still required hand-rolled `gh api` calls outside the machine model.

## 2. Origin & Background

- Backlog items claimed: BL-20260818-07.
- Builds on: ADR-029 (trigger), ADR-016 (`sink.cross_repo_issue` PAT pattern), ADR-005 (numbers-not-bodies).

## 3. Goals

- G1: A blueprint can send a typed, entity-pointing dispatch to another repo, agent-obligated or deterministic.

## 4. Non-Goals

- NG1: Arbitrary payload fields (the belt protocol is `number` only, per ADR-005).
- NG2: Combined-canvas belt rendering (BL-20260818-08 stays open).

## 5. User Stories

- As a fleet operator, I want repo A's triage line to escalate an issue into repo B's factory with one machine, so belts are drawn, not scripted.

## 6. Functional Requirements

- **FR-1**: New machine `sink.repository_dispatch` (registry + schema; 23rd type) with `targetRepo`, `eventType`, `tokenSecret` config.
- **FR-2**: Agent-obligated mode: obligation names the exact `gh api repos/<target>/dispatches` call; the grant is exactly that endpoint (`Bash(gh api repos/<target>/dispatches:*)`); the token secret is exposed to the agent step env.
- **FR-3**: Deterministic mode: a PAT-authenticated `gh api` step sending `event_type` + `client_payload.number` from the shared NUMBER chain.
- **FR-4**: Missing/malformed target repo is a compile error; a self-dispatch loop (same repo + an event type the line listens for) is **refused**; other same-repo dispatches warn.

## 7. Non-Functional Requirements

- **NFR-SEC-1**: No generic `gh api` grant ever; no payload free text; PAT only via `${{ secrets.<name> }}`.

## 8. Blueprint & Schema Impact

23rd machine type; schema enum + config branch (drift guard green).

## 9. Compiler & Workflow Impact

Obligation case, config-aware grant at the obligated-sink loop, env secret exposure generalized to both cross-repo sinks, deterministic emission branch, self-loop validation.

## 10. UI Impact

Palette/Inspector render from the registry (`📤 Cross-repo signal (send)`).

## 11. Security Impact

The grant ceiling is one endpoint on one named repo; the PAT's own scopes bound the blast radius; loop refusal is compile-time (golden rule #6).

## 12. Acceptance Criteria

- **AC-1**: Agent mode emits the endpoint-exact grant and the `FLEET_TOKEN` env exposure; no `Bash(gh api:*)`.
- **AC-2**: Deterministic mode emits the `gh api "repos/$TARGET/dispatches"` step with PAT env and no agent step.
- **AC-3**: Missing target errors; same-repo+same-type errors as a self-dispatch loop; same-repo+different-type warns with zero errors.

## 13. Risks & Open Questions

- **R-1**: A PAT with broad scopes over-empowers the endpoint grant — mitigated: the blurb tells operators to scope the token to the target repo; the endpoint pattern already prevents other API calls.

## 14. Out of Scope / Follow-ups

- Dogfood the first real belt (e.g. law-ai escalates selected issues into a gitorio factory) once the fleet PAT exists — an operational decision.
