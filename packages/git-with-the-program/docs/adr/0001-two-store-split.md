# ADR-0001: Split core memory into normative program and observational ledger

**Status:** Accepted · **Date:** 2026-07-23 · **Deciders:** Amr (project owner)

## Context
The framework needs both low-churn, human-ratified law and high-churn, machine-written evidence. A single store forces one write policy onto both.

## Decision
Two stores with different politics. `.program/` is in-tree, normative, human-ratified via reviewed PRs. The ledger is an out-of-tree ref (`refs/program/ledger`), observational, machine-append-only. Sensitivity knobs (precision/budget/half-life) are program; accumulator state is ledger.

## Options considered
- **Single in-tree store** — rejected: bots committing to governance files; review noise; write-policy conflict.
- **External DB for evidence** — rejected: breaks repo self-containment; clone no longer carries full state.
- **Two-store split (chosen)** — clean write paths; fork semantics fall out of git (program travels, ledger is opt-in fetch).

## Consequences
- Easier: auditability, fork hygiene, CI write access without touching branches.
- Harder: tooling must manage a non-default ref (fetch config, push retries).
- Revisit: ledger hosting for very large monorepos.
