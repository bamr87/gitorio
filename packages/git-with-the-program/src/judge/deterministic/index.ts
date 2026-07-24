// Implements: docs/spec/03-judge.md §1 (the judgment ladder — the DETERMINISTIC rung, "compiled
// deterministic checks … every push, zero variance, zero cost"). The family barrel for the
// bench of narrow deterministic magistrates: one judge per assertion class expressible as a rule.
//
// Each member is `SealedEvidence -> Verdict` (src/core/evidence.ts), so the bench is uniform and
// any member is drop-in substitutable for the model rung SEED-03 seats. This file re-exports the
// three deterministic judges and collects their `(ref, judge)` pairs so a router can seat them
// without knowing their internals.
//
// BLIND MODULE (INV-003): re-exports only the three sibling judge files (each a blind module with
// a provably clean closure) and TYPE-ONLY `Judge`/`JudgeRef`. Nothing here value-imports the
// sentencing branch — `scripts/check-inv003.ts` stays green.

import type { JudgeRef } from '../../core/event.js';
import type { Judge } from '../../core/evidence.js';

import { IMPORT_BOUNDARY_JUDGE, importBoundaryJudge } from './imports.js';
import { PATH_BOUNDARY_JUDGE, pathBoundaryJudge } from './path_boundary.js';
import { SCHEMA_CONFORMANCE_JUDGE, schemaConformanceJudge } from './schema_conformance.js';

// INV-005-style: engine core imports no forge-specific APIs (the import-boundary judge).
export * from './imports.js';
// INV-001-style: nothing writes into a protected subtree (the path-boundary judge).
export * from './path_boundary.js';
// INV-006-style: program artifacts validate against schemas/ (the schema-conformance judge).
export * from './schema_conformance.js';

/**
 * A deterministic judge paired with the seat it stamps. The judge FUNCTION returns only a
 * `Verdict`; the `ref` is applied later, at event-mint time, by the caller — matching each
 * judge's own IMPORT_BOUNDARY_JUDGE / judgeImportBoundary split.
 */
export interface SeatedDeterministicJudge {
  readonly ref: JudgeRef;
  readonly judge: Judge;
}

/**
 * The whole deterministic bench, in a stable order, so a router can iterate the rung without
 * naming each judge. One assertion per invocation (spec 03 §1): a router picks the judge whose
 * jurisdiction matches the assertion's `class` and lets the others `abstain` if handed the wrong
 * one (spec 03 §4).
 */
export const DETERMINISTIC_JUDGES: readonly SeatedDeterministicJudge[] = [
  { ref: IMPORT_BOUNDARY_JUDGE, judge: importBoundaryJudge },
  { ref: PATH_BOUNDARY_JUDGE, judge: pathBoundaryJudge },
  { ref: SCHEMA_CONFORMANCE_JUDGE, judge: schemaConformanceJudge },
];
