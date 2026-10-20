// Implements: docs/spec/06-upkeep.md — repository upkeep: observe the repository's forge-side
// presentation (description, topics, tags, releases, labels) and the references its docs make,
// derive the desired state from config + tree + history, and converge the two.
//
//   types.ts    the vocabulary; mirrors schemas/upkeep-{config,plan}.schema.json
//   config.ts   defaults and the rules draft-07 cannot state
//   semver.ts   tag precedence and the bump suggestion
//   facts.ts    the local half: git (read-only, identity-free) and the tree
//   host.ts     the forge-neutral port; GitHub lives in src/adapters/github/repo-host.ts
//   plan.ts     PURE: facts + config -> findings, actions, content requests
//   prompts.ts  what each content slot asks its author for
//   content.ts  one validator for two authors (model, agent), and the fallbacks
//   apply.ts    the only writer — forge-side only, never the tree
//   report.ts   the markdown a human or the in-tree agent acts on
//
// Nothing in this directory writes `.program/` (INV-001), the ledger ref (INV-002) or the working
// tree. In-tree drift is reported, with a remedy, for a reviewed PR to fix.

export * from './types.js';
export * from './config.js';
export * from './semver.js';
export * from './facts.js';
export * from './host.js';
export * from './plan.js';
export * from './prompts.js';
export * from './content.js';
export * from './apply.js';
export * from './report.js';
