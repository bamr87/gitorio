# Plan: Cross-Repo Signal Sender

> Companion to `spec.md`.

## 1. Architecture Overview

A sink mirroring `sink.cross_repo_issue` at every site (registry, obligation, env exposure, deterministic step, validation), plus two things that sink never needed: a config-aware grant and a self-loop refusal.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Registry | `app/src/machines/registry.ts` | `sink.repository_dispatch` entry (`📤`) |
| Schema | `schema/blueprint.schema.json` | type enum + config branch |
| Compiler | `app/src/compiler/compile.ts` | SINKS set, obligation case, endpoint-exact grant, generalized cross-repo env, deterministic step, self-loop validation |
| Docs | `docs/ARCHITECTURE.md` §4 | catalog line |

## 3. Blueprint & Schema Changes

23rd type; drift guard enforces the pairing.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Grant | Endpoint-exact, added where config is in scope | `Bash(gh api:*)` via `toolsFor` | Generic `gh api` is an any-endpoint token cannon (rule #5) |
| Loop policy | Compile-time refusal on same-repo+same-type | Warning only | Golden rule #6 — the compiler must refuse emittable infinite loops |
| Machine shape | Separate sink | Mode flag on `sink.cross_repo_issue` | Different obligation/grant/loop semantics; flags hiding those breed ADR-015-class incidents |

## 5. Least Privilege & Permissions

One endpoint on one named repo; no `permissions:` widening (PAT via secret env, GITHUB_TOKEN untouched).

## 6. Loop Guards & Untrusted Input

Self-dispatch refusal (error) + same-repo warning; cross-repo sends cannot retrigger this line; payload carries a number, never text.

## 7. Test Strategy

Five invariants: agent grant/env exactness, deterministic step shape, missing-target error, self-loop refusal, same-repo-different-type warning.

## 8. Rollout

Machine ships in the palette; first real belt is an operational follow-up needing a fleet PAT.

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Over-scoped PAT | med | med | blurb guidance; endpoint-exact grant limits API surface regardless |

## 10. Estimated Effort

One loop cycle (done).
