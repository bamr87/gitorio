// Implements: docs/vision.md ("Not forge-locked") and INV-005 ("Engine core imports no
// forge-specific APIs; GitHub access lives in adapters/").
//
// ALL GitHub-specific code lives under this directory: PR/issue delivery for proposals
// (spec 02 §5), PR-thread and review-comment enrichment for distillation (spec 04 §2), and
// the ledger ref push-with-retry when it needs a forge token. A bare git repo must degrade
// gracefully to commits-only, so every capability here is optional from src/core's point of
// view: core defines the PORT, this directory supplies an ADAPTER.
//
// Ports this adapter is expected to implement (all declared in src/core):
//   - SightedCommitPort   authorship lookup at firing time only (ADR-0003)
//   - ChangeSource        hunks intersecting an assertion's scope, author-free (spec 03 §3)
//   - EventStore          append/list on refs/program/ledger (src/ledger)
//
// SEED-02 lands issue delivery; SEED-04 lands forge-metadata mining.
//
// WHAT SEED-02 LANDED, AND IN WHICH FILE:
//   ./render.ts     Proposal -> DeliveryDocument: the whole evidence bundle spec 02 §5 requires,
//                   as one self-contained markdown document carrying its own delivery marker.
//                   Takes a `SentencingWarrant` from its caller; declassifies the meter for
//                   PUBLICATION, which is the point of a proposal (ADR-0003).
//   ./amendment.ts  the `.program/` patch a reprogramming proposal ships. PURE `string ->
//                   string`: it has no filesystem access, so there is no code path here through
//                   which INV-001 could be breached. The machine proposes; a human applies.
//   ./issues.ts     the GitHub `DeliveryPort`: `gh api` when the CLI is present, `fetch` +
//                   GITHUB_TOKEN otherwise, and an honest `unconfigured` failure when neither is.
//                   Idempotent: it searches for the delivery marker before it creates.
//   ./bare.ts       the same port for a repository with no forge at all — a file under
//                   `.gwtp/proposals/`, never under `.program/`. "A bare repo degrades
//                   gracefully to commits-only" (docs/vision.md).
//
// TWO `renderProposal`s EXIST, deliberately. This one returns a `DeliveryDocument` and is what
// gets filed. `src/ledger/firing.ts` has a forge-agnostic markdown renderer for the case where no
// adapter is present at all — src/ledger cannot import this directory (INV-005), so it cannot
// share this one. Import from here when something is being DELIVERED.

export * from './amendment.js';
export * from './render.js';
export * from './issues.js';
export * from './bare.js';
