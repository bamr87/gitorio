# Spec: Cross-Repo Signal Trigger (repository_dispatch)

- **ID**: 007-repository-dispatch
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-18
- **Roadmap link**: BL-20260816-22 (Fleet C tail)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

Inter-repo belts had a sender pattern (`sink.cross_repo_issue`) but no receiving socket — no factory could react to a purpose-built cross-repo signal.

## 2. Origin & Background

- Backlog items claimed: BL-20260816-22 (the combined-canvas remainder is re-filed sharpened; see §14).
- Builds on: ADR-016 (cross-repo sink), ADR-013 (survey-mode ceiling), ADR-005 (numbers-not-bodies).

## 3. Goals

- G1: A blueprint can receive `repository_dispatch` events scoped to one event type, with entity plumbing for both agent and deterministic lines.

## 4. Non-Goals

- NG1: The sending sink (`sink.repository_dispatch`) — filed as follow-up.
- NG2: Combined-canvas belt visualization — re-filed sharpened.

## 5. User Stories

- As a fleet operator, I want repo A's factory to signal repo B's factory with an entity pointer, so cross-repo automation composes without polling.

## 6. Functional Requirements

- **FR-1**: New machine `trigger.repository_dispatch` (registry + schema + palette) with `eventType` config → `repository_dispatch: {types:[…]}`; empty type emits no filter and warns.
- **FR-2**: `client_payload.number` joins the NUMBER env and concurrency fallback chains (deterministic sinks work from a payload pointer).
- **FR-3**: Agent lines on this trigger run in survey mode (discovery grants); payload free text never enters the prompt — context carries `DISPATCH_TYPE` + `PAYLOAD_NUMBER` only.
- **FR-4**: Golden rule #8 DoD complete: registry entry, config field, emitter, invariant tests, ARCHITECTURE §4 line, renders on canvas (registry-driven palette).

## 7. Non-Functional Requirements

- **NFR-SEC-1**: No bot guard needed (writes cannot re-emit a dispatch — structurally loop-free); no payload text in workflow YAML or prompts.

## 8. Blueprint & Schema Impact

22nd machine type; schema `type` enum + config branch added (registry↔schema drift guard green).

## 9. Compiler & Workflow Impact

New trigger case; NUMBER/concurrency chains extended; survey-mode membership via the existing entity-less condition.

## 10. UI Impact

Palette/Inspector render from the registry automatically (`📡 Cross-repo signal`).

## 11. Security Impact

Senders must hold repo-write tokens (GitHub's own dispatch ACL); even so, payload bodies are excluded from prompts per ADR-005. Empty-type scoping warns.

## 12. Acceptance Criteria

- **AC-1**: Typed trigger emits `repository_dispatch` with `- <eventType>`; empty type warns and omits the filter.
- **AC-2**: A dispatch agent line's grant includes the survey discovery verbs; context lines carry `DISPATCH_TYPE`/`PAYLOAD_NUMBER` and no `toJSON(client_payload)`.
- **AC-3**: A deterministic dispatch→label line compiles with `client_payload.number` in its NUMBER chain.

## 13. Risks & Open Questions

- **R-1**: A sender omitting `number` leaves deterministic sinks with an empty NUMBER — same failure mode as the existing workflow_run chain with no PR; acceptable and visible in run logs.

## 14. Out of Scope / Follow-ups

- `sink.repository_dispatch` — the sending end (scoped PAT POST to `/dispatches`).
- Combined-canvas inter-repo belts (sharpened re-file: render dispatch sender→receiver edges across observed repos in the Fleet map).
