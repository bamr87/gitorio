// Implements: docs/spec/03-judge.md §2 (two blindness rules) and §3 (evidence assembly).
// SEED-03 lands the assembler here: given an assertion + a diff, produce the judge's evidence
// bundle — assertion view, charter provenance excerpt, scope-intersected hunks, expanding
// context ring on abstain.
//
// Contract already fixed by src/core and NOT to be re-derived in this module:
//   - what the judge may see:   AssertionView, assertionView(), EvidenceBundleInput
//   - the chokepoint:           sealEvidence() — the only minter of SealedEvidence
//   - scope intersection:       scopedHunks(), matchesScope(), matchesGlob()
//   - the escalation ring:      ContextRing, widenContextRing()
//   - citation verification:    citationsWithinBundle()
//
// INV-003: this module may `import type` from ../core/sentencing.js but must never VALUE-
// import it. There is deliberately no channel here through which authorship or accumulator
// state could arrive: ChangeSource has no author accessor and no accumulator accessor.

export type {
  AssertionView,
  ChangeSource,
  ContextRing,
  EvidenceBundleInput,
  SealedEvidence,
} from '../core/index.js';
