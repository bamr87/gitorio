# Plan: Cross-Repo Signal Trigger

> Companion to `spec.md`.

## 1. Architecture Overview

A new trigger case in the existing switch, joining the entity-less class (cron/manual) for grants, with the payload's `number` woven into the two existing entity fallback chains.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Registry | `app/src/machines/registry.ts` | `trigger.repository_dispatch` entry (`📡`, `eventType` field) |
| Schema | `schema/blueprint.schema.json` | type enum + config branch |
| Compiler | `app/src/compiler/compile.ts` | TRIGGERS set, dispatch case, NUMBER/concurrency chains, context lines |
| Docs | `docs/ARCHITECTURE.md` §4 | catalog line |

## 3. Blueprint & Schema Changes

22nd type; drift guard enforces the pairing.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Belt model | Two machines, two blueprints, convention-connected | One cross-repo machine | Blueprints compile per-repo; matches the proven `gh --repo` sender pattern |
| Payload | `number` pointer only | Inline `toJSON(client_payload)` in prompt | ADR-005 — bodies out of prompts, even from privileged senders |

## 5. Least Privilege & Permissions

No new grants beyond the existing survey ceiling; deterministic sinks keep their own scopes.

## 6. Loop Guards & Untrusted Input

Structurally loop-free (no emitted event maps to `repository_dispatch`); no payload text in YAML/prompts; empty-type scoping warns.

## 7. Test Strategy

Five invariants: typed emission, empty-type warning, survey grants, numbers-not-bodies context, deterministic NUMBER chain.

## 8. Rollout

Machine ships in the palette; first real belt (law-ai → gitorio or reverse) is a natural follow-up once the sender sink exists.

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Senderless number → empty NUMBER | med | low | visible in run logs; same class as workflow_run-without-PR |

## 10. Estimated Effort

One loop cycle (done).
