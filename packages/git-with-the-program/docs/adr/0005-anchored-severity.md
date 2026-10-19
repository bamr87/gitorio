# ADR-0005: Severity is an anchored ordinal; citations are mandatory

**Status:** Accepted · **Date:** 2026-07-23 · **Deciders:** Amr

## Context
LLMs cannot calibrate continuous 0-1 severity floats, and unverifiable verdicts invite hallucinated violations.

## Decision
Four anchored severity rungs — grazes | bends | breach | entrenches — mapped to fixed numerics 0.25/0.5/0.75/1.0. Violation verdicts must cite evidence spans (file:lines); no citation, no verdict. `abstain` is a first-class ruling that never accumulates and always escalates. Aligned verdicts are terse.

## Consequences
- Easier: cross-judge consistency, verifiable rulings, structural defense against hallucination, cheap compliance certification.
- Harder: anchor definitions must be maintained per assertion class; coarse granularity is accepted deliberately.
