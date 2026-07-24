// Implements: docs/spec/03-judge.md §1 (the judgment ladder), §5 (panels), §6 (bar exam),
// §7 (the regression judge). SEED-03 lands the deterministic judges, the LLM invariant judge,
// panel mode, the verdict cache and the bar-exam runner here.
//
// Contract already fixed by src/core and NOT to be re-derived in this module:
//   - the bench signature:      Judge = (evidence: SealedEvidence) => Verdict | Promise<Verdict>
//   - the output contract:      Verdict union, decodeVerdict(), isViolation()
//   - anchored severity:        severityWeight(), medianSeverityOrdinal(), severityRungSpread()
//   - judge identity:           JudgeRef, judgeHash(), JudgeSeat, judgeSeatHash()
//   - the cache key:            verdictCacheKey(assertion, hunkHash, judgeHash)
//
// INV-003: this module may `import type` from ../core/sentencing.js but must never VALUE-
// import it. Every judge input arrives as SealedEvidence, which only sealEvidence() mints.

export type {
  Judge,
  JudgeRef,
  JudgeSeat,
  SealedEvidence,
  Verdict,
  VerdictCacheKey,
} from '../core/index.js';
