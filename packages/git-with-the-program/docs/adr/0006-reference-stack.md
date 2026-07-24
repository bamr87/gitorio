# ADR-0006: Reference implementation stack

**Status:** Accepted · **Date:** 2026-07-23 · **Deciders:** Amr · **Decided in:** SEED-01

## Context
Schemas and specs are language-agnostic; the engine needs a reference implementation. Delivery target is a GitHub Action wrapping a CLI, consistent with prior art (AI Evolution Engine composite Action; GitFactory compiles to Actions running Claude Code agents).

## Options considered

### Option A: TypeScript engine
| Dimension | Assessment |
|---|---|
| Actions ecosystem fit | High (native toolkit) |
| Git access | shell out to git CLI (fine) |
| Team familiarity | High (GitFactory is TS/React) |
| Distillation math/graphs | Adequate |

### Option B: Python engine
| Dimension | Assessment |
|---|---|
| Actions ecosystem fit | Medium (container action) |
| Git access | shell out or dulwich |
| Team familiarity | High |
| Distillation math/graphs | Strong (networkx, ruptures for change-point detection) |

### Option C: Split — TS orchestration + Python miner
Best tool per pass; two toolchains to maintain.

## Decision
**Option A: a TypeScript engine on Node.** One toolchain is worth more to v0 than the best tool per pass, because the shortest path to a repo that can see itself is a single `npm ci && npm run ci` that a human and an agent can both run without thinking about it; a split stack (Option C) buys `networkx` and `ruptures` for a distillation miner that does not exist yet, at the cost of two dependency trees, two lockfiles and two CI installs on every PR from today onward. TypeScript also buys something Python cannot: INV-003's blindness rules become *compile errors* rather than review conventions — `ActorId` and `Surprise` are declared as opaque non-primitives, so accumulated surprise is not assignable into any numeric field of any evidence bundle and the judge's blindness is checked by `tsc` on every build. That structural enforcement is the single most load-bearing property in the design, and it is why the trade lands here rather than on Option B's stronger maths libraries. Option C stays reserved for the day pass-one mining outgrows TS (spec 04); nothing in this decision is language-visible to `schemas/`, so switching the miner later costs a new package, not a new contract.

**Pinned by this decision** (relitigate only by superseding ADR): ESM (`"type": "module"`), `"strict": true`, Node ≥ 22, `vitest` + `fast-check` for tests and property tests, `ajv` + `ajv-formats` + `yaml` as the only runtime dependencies, and `node:util` `parseArgs` for the `gwtp` CLI rather than a parser library. The dependency list is short on purpose: an engine that judges other repositories' drift has no business accumulating its own.

## Consequences
- Schemas in `schemas/` are the contract either way; all seeds validate against them.
- Distillation maths (spec 04) is written by hand in TS for v0. If change-point detection or graph analysis becomes the bottleneck, that is the signal to revisit Option C — as a new ADR superseding this one, not as a quiet second toolchain.
- The engine shells out to the `git` CLI for history (no `libgit2`, no `nodegit`), which keeps `src/core` free of native modules and keeps INV-005's forge-agnosticism cheap to hold.
