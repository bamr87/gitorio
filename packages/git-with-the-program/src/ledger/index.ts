// Implements: docs/spec/02-ledger.md §1 (substrate: a dedicated ref, event-sourced), §3-§8.
// SEED-02 landed the event store, the accumulator fold, the firing detector and
// `gwtp ledger append|fold|replay|status` (src/cli/commands/ledger.ts) against this module.
//
// THE PORT IS DECLARED HERE; EVERYTHING ELSE IS RE-EXPORTED FROM WHERE IT LIVES:
//
//   ./git.ts       the git plumbing seam (`GitExec`) and the PURE tree algebra. No working
//                  tree, no index, no branch — `hash-object`, `mktree`, `commit-tree`,
//                  `update-ref` and nothing that could touch a checkout.
//   ./store.ts     `GitRefEventStore` on `refs/program/ledger`: append (idempotent by content
//                  address), read (hash-verified), fetch → set-union merge → fast-forward push.
//                  Plus `writeDerivedFiles`, which writes `accumulators/` and refuses `events/`.
//   ./fold.ts      the deterministic fold. `foldEvents` for one set of knobs, `foldEventsPerKey`
//                  for the real case where every assertion carries its own budget and half-life.
//   ./cache.ts     `accumulators/` materialization, and the conservative answer to "may this
//                  cached snapshot be believed?". Pure: no I/O.
//   ./sighted.ts   THE ONLY MODULE THAT RESOLVES A GIT AUTHOR, and only for events already
//                  contributing to a firing (ADR-0003).
//   ./firing.ts    firing → dispersion → `Proposal`, the firing event, and the post-fire
//                  lifecycle (affirmed precedent, precision raise, amendment, governance debt).
//
// Contract already fixed by src/core and NOT re-derived anywhere below:
//   - the record and its identity:   EventBody, LedgerEvent, eventBodyFromVerdict, sealEvent
//   - append-only (INV-002):         supersede(), resolveSupersessions(), verifyEventId()
//   - the fold's total order:        compareForFold()
//   - the leaky integrator:          decayFactor(), decay(), accumulatorStep(), surpriseOf()
//   - hysteresis (spec 02 §6):       shouldFire(), rearm(), REARM_FRACTION_DEFAULT
//   - the persisted cache:           AccumulatorState, AccumulatorSnapshot, knobsDigest()
//   - dispersion and proposals:      computeDispersion(), Proposal, classifyFiring()
//
// WHY THIS BARREL WITHHOLDS NOTHING, UNLIKE src/core/index.ts. The core barrel hides the four
// declassifiers because src/judge/** and src/evidence/** import src/core: withholding is what
// forces a declassification to be a deep import a prescreen can grep for. No blind directory
// imports src/ledger AT ALL — `tests/ledger/blindness-boundary.test.ts` asserts that over the
// real import graph, transitively, and `scripts/check-inv003.ts` asserts it per file — so a
// second withholding list here would guard a door nobody can reach, and would only rot. What
// keeps the audit finite is unchanged: `withSentencingWarrant` is value-imported by exactly two
// modules in this directory (./firing.ts and ./fold.ts) and this file is not one of them.
//
// TWO RENDERERS, ON PURPOSE. `renderProposal` here (./firing.ts) is forge-agnostic markdown, the
// one src/ledger can produce with no adapter present (INV-005). `renderProposal` in
// src/adapters/github/render.ts returns a `DeliveryDocument` — title, body, labels, the
// `.program/` patch and the delivery marker — and is what actually gets filed. Import the second
// when something is being delivered, the first when something is being printed.

import type { EventId, LedgerEvent } from '../core/index.js';
import type { NonEmptyReadonlyArray } from '../core/index.js';

/**
 * Content addressing makes a repeated append a no-op; reporting it as `deduped` rather than
 * an error is what makes idempotent double-append a passing property test (SEED-02).
 */
export interface AppendOutcome {
  readonly written: readonly EventId[];
  readonly deduped: readonly EventId[];
}

/**
 * Two methods, and neither is update or delete. INV-002 is not a rule the implementation is
 * asked to respect; it is the ABSENCE of a method through which it could be violated.
 */
export interface EventStore {
  append(events: NonEmptyReadonlyArray<LedgerEvent>): Promise<AppendOutcome>;
  list(): Promise<readonly LedgerEvent[]>;
}

export * from './git.js';
export * from './store.js';
export * from './fold.js';
export * from './cache.js';
export * from './sighted.js';
export * from './firing.js';
