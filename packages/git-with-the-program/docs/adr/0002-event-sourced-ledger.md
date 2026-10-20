# ADR-0002: Event-sourced, content-addressed ledger with derived accumulators

**Status:** Accepted · **Date:** 2026-07-23 · **Deciders:** Amr

## Context
Concurrent CI runs write observations simultaneously; LLM judges are non-deterministic; sensitivity knobs will be retuned after deployment.

## Decision
One file per observation under `events/`, filename = content hash of the canonical body. Accumulators are a deterministic fold over the event set, cached under `accumulators/`, never authoritative. Re-judging supersedes (`supersedes:` chain); nothing is edited or deleted. Git notes rejected: keyed per-commit, but surprise is keyed per-assertion — wrong index.

## Consequences
- Easier: conflict-free merges (set union), idempotent writes, retroactive knob retuning, counterfactual replay, tamper-evident history.
- Harder: event volume management → epoch compaction snapshots; fold performance needs caching.
- Rule downstream: verdicts are recorded facts; the fold folds verdicts, not judgments.
