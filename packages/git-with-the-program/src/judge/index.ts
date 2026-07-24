// Implements: docs/spec/03-judge.md §1 (the judgment ladder), §5 (panels), §6 (bar exam),
// §7 (the regression judge). SEED-03 landed the deterministic judges, the LLM invariant judge,
// panel mode, the verdict cache and the bar-exam runner under this directory; this barrel is
// their coherent public surface.
//
// Contract already fixed by src/core and NOT re-derived in this module:
//   - the bench signature:      Judge = (evidence: SealedEvidence) => Verdict | Promise<Verdict>
//   - the output contract:      Verdict union, decodeVerdict(), isViolation()
//   - anchored severity:        severityWeight(), medianSeverityOrdinal(), severityRungSpread()
//   - judge identity:           JudgeRef, judgeHash(), JudgeSeat, judgeSeatHash()
//   - the cache key:            verdictCacheKey(assertion, hunkHash, judgeHash)
//
// INV-003: this file sits under `src/judge/**`, so it is a BLIND module. It may `import type`
// from ../core/sentencing.js but must never VALUE-import it, nor value-import anything under
// src/ledger/**. It obeys that here two ways: the core re-exports below are `export type` only
// (erased by verbatimModuleSyntax), and every VALUE re-export names a sibling judge module whose
// own value-closure is provably sentencing-clean (scripts/check-inv003.ts and
// tests/ledger/blindness-boundary.test.ts both stay green). None of these modules value-imports
// the `../core/index.js` barrel — which would drag in the accumulator — nor evidence.js (Q-60):
// each deep-imports only the sentencing-clean core modules it needs.

export type {
  Judge,
  JudgeRef,
  JudgeSeat,
  SealedEvidence,
  Verdict,
  VerdictCacheKey,
} from '../core/index.js';

// The deterministic rung: the bench of narrow magistrates (path-boundary, import-boundary,
// schema-conformance) plus `DETERMINISTIC_JUDGES` / `SeatedDeterministicJudge` (spec 03 §1).
export * from './deterministic/index.js';

// Panel mode: N samples over one sealed bundle, median severity, variance discount or human
// escalation (spec 03 §5).
export * from './panel.js';

// The verdict cache keyed `assertion-id + hunk-hash + judge-hash` (spec 03 §1).
export * from './cache.js';

// The regression judge: retrieval over killed case law, a confirming ruling, and a proposed
// `coincidence` tombstone for a lookalike (spec 03 §7).
export * from './regression.js';

// The bar exam and golden-sample drift check; seating a passing judge as a PROPOSED manifest diff
// (spec 03 §6). Never writes `.program/` (INV-001).
export * from './bar_exam.js';

// The LLM invariant judge over the provider-agnostic ModelClient PORT, plus its identity helpers
// `modelInvariantJudgeRef` / `promptFileHash` (spec 03 §1/§6). The judge never names a provider
// SDK (INV-005); only src/adapters/anthropic implements the port. The prompt-plumbing internals in
// ./model/prompt.js stay module-local — `modelInvariantJudgeRef` and `promptFileHash` are surfaced
// here through invariant_judge.js, which re-exports them, so this barrel names each exactly once.
export * from './model/invariant_judge.js';
