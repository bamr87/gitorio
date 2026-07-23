# ADR-0006: Reference implementation stack

**Status:** Proposed · **Date:** 2026-07-23 · **Deciders:** Amr

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

## Leaning
Option A for v0 (one toolchain, fastest to a sighted repo), reserving Option C if pass-one mining outgrows TS. Decide at SEED-01.

## Consequences
- Schemas in `schemas/` are the contract either way; all seeds validate against them.
