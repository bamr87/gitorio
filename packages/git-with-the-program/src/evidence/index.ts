// Implements: docs/spec/03-judge.md §2 (two blindness rules) and §3 (evidence assembly).
// SEED-03 landed the assembler here: given an assertion + a diff, produce the judge's evidence
// bundle — assertion view, charter provenance excerpt, scope-intersected hunks, expanding
// context ring on abstain.
//
// Contract already fixed by src/core and NOT re-derived in this module:
//   - what the judge may see:   AssertionView, assertionView(), EvidenceBundleInput
//   - the chokepoint:           sealEvidence() — the only minter of SealedEvidence
//   - scope intersection:       scopedHunks(), matchesScope(), matchesGlob()
//   - the escalation ring:      ContextRing, widenContextRing()
//   - citation verification:    citationsWithinBundle()
//
// INV-003: this file sits under `src/evidence/**`, so it is a BLIND module. It may `import type`
// from ../core/sentencing.js but must never VALUE-import it. The core re-exports below are
// `export type` only (erased). The one VALUE re-export names ./assembler.js, whose entire
// value-closure is `../core/change.js` (scopedHunks, widenContextRing) — sentencing-clean; it
// never value-imports evidence.js (Q-60), taking `sealEvidence` as an injected `EvidenceSeal`
// port instead, so nothing here reaches the sentencing branch. `scripts/check-inv003.ts` and
// `tests/ledger/blindness-boundary.test.ts` both stay green.

export type {
  AssertionView,
  ChangeSource,
  ContextRing,
  EvidenceBundleInput,
  SealedEvidence,
} from '../core/index.js';

// The evidence assembler (spec 03 §3) and its injected seal port `EvidenceSeal` (the Q-60
// resolution). `assembleEvidence` builds the bundle and hands it to the caller-supplied
// `sealEvidence`; `escalateEvidence` widens the context ring by one step on an abstain.
export * from './assembler.js';
