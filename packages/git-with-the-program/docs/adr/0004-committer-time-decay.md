# ADR-0004: Accumulator decay runs on committer time

**Status:** Accepted · **Date:** 2026-07-23 · **Deciders:** Amr

## Context
Decay needs a time basis. Observation time breaks backfill (history judged today would arrive at full strength). Author time is distorted by rebases.

## Decision
Decay on committer time. Events referencing rebased-away SHAs are retained and marked orphaned — a rewritten commit is itself information.

## Consequences
- Easier: distillation backfill is safe by construction — old events arrive pre-decayed; accumulators start warm, not blind, and never fire on stale news.
- Harder: none material; committer time is the physically meaningful clock for the process being modeled.
