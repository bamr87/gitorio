# SEED-03 — Judge harness

Prerequisite: SEED-02 merged. Read `docs/spec/03-judge.md`, ADR-0003, ADR-0005, `prompts/`.

## Objective
Implement the judgment ladder: deterministic judges, the evidence assembler, the LLM invariant judge, panels, and the bar exam.

## Deliverables
1. **Deterministic judges** for assertion classes expressible as rules: path-boundary (INV-001-style), dependency/import (INV-005-style), schema-conformance (INV-006-style). Each emits verdicts conforming to `schemas/verdict.schema.json`.
2. **Evidence assembler**: given an assertion + a diff, produce the judge's evidence bundle — assertion, charter provenance excerpt, scope-intersected hunks, expanding context ring on abstain. **Structurally incapable of reading authorship or `accumulators/`** (INV-003): enforce by type/module boundary and test it.
3. **LLM invariant judge**: wraps `prompts/invariant-judge.md`, records `judge: {kind: model, id, prompt: sha256}`, parses the anchored-ordinal contract, rejects uncited violations (re-prompt once, then abstain).
4. **Panel mode**: N=3 samples, median severity, variance discount on effective surprise or human-escalation flag.
5. **Verdict cache** keyed `assertion-id + hunk-hash + judge-hash`.
6. **Bar exam runner**: replay `precedents.yaml` settled cases against a candidate judge (model or prompt change); block seating on mismatch. Golden-sample drift check as a scheduled job.

## Constraints
- One assertion per invocation. Aligned verdicts terse. Abstain never converts to a violation without new evidence.
- Judge identity/prompt hashes must round-trip through `.program/manifest.yaml`; seating changes require the ratification flow.

## Acceptance
- Blindness test: attempting to feed author or accumulator data to the assembler fails to compile / raises.
- Contract tests: uncited violation rejected; regression verdict without PRE-id rejected; severity outside the four anchors rejected.
- Bar exam: a deliberately degraded prompt fails seating; the shipped prompt passes on a fixture case-law set.
