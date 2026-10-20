// Implements: docs/spec/04-distillation.md — the whole distillation walk ("the detection loop run
// in reverse: infer the model from observations"), SEED-04. This barrel is the coherent public
// surface of the four slices the parallel agents built plus the integration layer that wires them:
//
//   ./factbase.ts   §2/§5/§7/§8 — the deterministic fact-base record types, (de)serialization, the
//                                 walk cost-guard (WalkBudget) and the INV-001 output-path guard.
//   ./miner.ts      §2         — pass one, the exhaustive read-only git walk producing a FactBase.
//   ./epochs.ts     §1/§3      — epoch segmentation (pluggable change-point detection) + recency.
//   ./precision.ts  §5         — empirical precision seeding from span + corroboration + persistence.
//   ./synthesis.ts  §3–§6      — pass two, map-reduce synthesis over epochs THROUGH the ModelClient
//                                 port (INV-005), emitting `status: inferred` candidates only (§4).
//   ./ratify.ts     §5/§6      — the ratification PROPOSAL (top ~12, accept/edit/reject) + coincidence
//                                 tombstones; never writes `.program/` (INV-001).
//   ./backfill.ts   §7/§8      — replay the current epoch through seated judges into the ledger; the
//                                 watermark advance as a PROPOSED manifest diff.
//   ./wire.ts       §1–§3      — the integration layer: derive segmentation signals from the walk,
//                                 map the real FactBase onto synthesis's author-free views, and run
//                                 the full walk (segment → mine with boundaries).
//
// THE ONE-WAY DOOR the whole module is built around: a function returning `CandidateAssertion[]`
// can only ever emit `status: 'inferred'` (schemas/assertion.schema.json allOf/0; spec 04 §4), so
// distillation cannot self-ratify. The ratification PR and the watermark advance are DELIVERED AS
// PROPOSALS — the human is the constitutional author.
//
// After the SEED-04 reconciliation there is ONE `RegularityKey` type (./factbase.ts), and the two
// distinct regularity-key functions are named for what they key: `statementRegularityKey`
// (./synthesis.ts, a statement) and `candidateRegularityKey` (./ratify.ts, a whole candidate).

export * from './factbase.js';
export * from './miner.js';
export * from './epochs.js';
export * from './precision.js';
export * from './synthesis.js';
export * from './ratify.js';
export * from './backfill.js';
export * from './wire.js';
