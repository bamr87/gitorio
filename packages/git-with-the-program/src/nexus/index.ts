// Implements: docs/spec/05-nexus.md (the perception layer's public surface), per ADR-0007.
//
// The whole package is safe to re-export wholesale, and that is a checked claim, not a hope:
// nothing under src/nexus value-imports the sentencing branch, src/ledger, or a declassifier
// — the graph carries no slot identity or the meter could occupy (`__NEXUS_BLINDNESS_PROOFS`,
// src/nexus/types.ts), and tests/nexus/blindness.test.ts holds the closure the way
// tests/ledger/blindness-boundary.test.ts holds the judges'. src/nexus is written to join
// INV-003's blind scope by ratified amendment (proposals/PROPOSED-nexus-amendment.md) with no
// code change on that day.

export * from './types.js';
export * from './lex.js';
export * from './extract.js';
export * from './build.js';
export * from './query.js';
export * from './rings.js';
export * from './serialize.js';
export * from './store.js';
