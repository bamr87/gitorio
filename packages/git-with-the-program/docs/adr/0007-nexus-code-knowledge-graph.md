# ADR-0007: The nexus — a code knowledge graph as the perception layer

**Status:** Accepted · **Date:** 2026-08-28 · **Deciders:** Amr (via PR review) · **Decided in:** the GitNexus integration session

## Context

Three places in the ratified design name machinery that does not exist:

1. **The context ring is specified and unimplementable.** Spec 03 §3 grants an abstaining
   judge "an expanding context ring … (function bodies → file → nearest callers)", and
   `src/core/change.ts` carries the four-rung `ContextRing` type — but every `ChangeSource` in
   the tree returns the same hunks at every ring, because nothing in the engine knows where a
   function body ends or who a caller is. The widest ring requires a **call graph**; none exists.
2. **"One seam or many call sites" has no seams.** Spec 02 §5's dispersion distinguishes
   refactor from reprogram partly by path entropy, which approximates "seam" with "directory
   name". A structural seam — a cluster of modules that actually import each other — needs an
   **import graph** over the tree.
3. **Negative space is provable only from a whole-tree view.** Spec 04 §2: "the strongest laws
   live in negative space — no third-party import *ever* crossing into `core/`". The
   deterministic rung reads diff hunks (spec 03 §3), so it can catch a breach being
   *introduced* but can never certify the absence that makes the law strong. The distillation
   miner already builds import graphs, but only at epoch boundaries and only for pass-one facts
   (`src/distill/factbase.ts`); the live loop has no perception of the present tree at all.

**Prior art: [GitNexus](https://github.com/abhigyanpatwari/GitNexus)** (Abhigyan Patwari) — a
client-side, zero-server code-intelligence engine that indexes a codebase into a knowledge
graph and serves it to AI agents. Its shape is exactly the missing organ: a phased pipeline
(structure → tree-sitter parse → import/call/inheritance resolution → community clustering →
process tracing → hybrid search), a graph of files/folders/functions/classes/methods joined by
`IMPORTS` / `CALLS` / `EXTENDS` / `IMPLEMENTS` / `MEMBER_OF` edges with per-edge confidence,
and a **local, gitignored index** (`.gitnexus/`) so the intelligence never leaves the clone.
The integration request for this repository was explicit: implement GitNexus into the repo
*and the concept*.

## Options considered

### Option A: Adopt GitNexus itself (dependency or sidecar)

| Dimension | Assessment |
|---|---|
| Capability | Highest (14 languages, clustering, flow tracing, search) |
| License | **Blocking.** PolyForm Noncommercial 1.0.0 — cannot be vendored into or depended on by this MIT-licensed engine |
| ADR-0006 fit | Blocking. Tree-sitter native/WASM grammars, an embedded graph DB, transformers.js — against a pinned dependency list of `ajv` + `ajv-formats` + `yaml` |
| Determinism | Not contractual. GWTP's evidence discipline (content-hashed rationales, replayable folds) needs bit-stable derivation with a versioned extractor identity |

### Option B: A clean-room nexus subsystem, concept-adapted, dependency-free

| Dimension | Assessment |
|---|---|
| Capability | Narrow on purpose: structure + definitions + imports + calls for TS/JS first; other languages degrade to structure-only |
| License | Clean. Ideas and taxonomy adapted with attribution; **no GitNexus code read or copied** |
| ADR-0006 fit | Exact: hand-written lexical extraction in `src/nexus/**`, zero new dependencies — the same trade ADR-0006 already made for glob matching and canonical JSON |
| Determinism | By construction: same tree bytes + same extractor version ⇒ byte-identical graph ⇒ same content hash, property-tested like the fold |

### Option C: Status quo — line-window rings, directory-name seams

Cheapest, and it leaves spec 03 §3's `callers` ring permanently fictional. A spec that names a
capability the engine cannot deliver is drift in the framework's own program.

## Decision

**Option B.** The engine grows a third store with a fourth politics — the **nexus**, named in
homage to its conceptual source: a code knowledge graph derived from the tree, cached under
`.gwtp/nexus/`, rebuildable at will, and authoritative for nothing.

> The program prescribes. The ledger remembers. The nexus perceives.

What is adopted from GitNexus, concept for concept:

- **The phased pipeline.** Structure → definition parse → import/call resolution, as ordered
  passes over one immutable file snapshot (spec 05 §3). GitNexus's clustering phase survives as
  **seams** — but derived at query time from the import graph, never stored, so the partition
  rule can change without re-addressing the artifact.
- **The taxonomy.** `module` / `definition` nodes; `imports` / `calls` / `extends` /
  `implements` edges; per-edge resolution honesty (GitNexus scores confidence; the nexus emits
  only provable edges and *counts* what it could not prove — precision over recall, the same
  posture as `scripts/check-inv001.ts`).
- **The local index.** `.gwtp/nexus/` is gitignored, exactly as `.gitnexus/` is: perception is
  per-clone and travels with nobody. This slots into the fork semantics of spec 02 §8 — the
  program propagates, the surveillance doesn't, and now: the percepts don't either.
- **Graph-first context.** GitNexus's thesis — *precompute structure at index time so tools
  return complete context in one call* — becomes the ring assembler: an abstain escalation is
  answered from the graph (enclosing definition, file, nearest callers), not by re-reading git.

What is deliberately **not** adopted for v0: embeddings and hybrid search, execution-flow
("process") tracing, CFG/PDG modes, the MCP server, and natural-language graph chat. The last
would put a live model call inside evidence assembly; a model enters GWTP only as a seated
judge (spec 03 §6), and the judge CLI is offline by default. Any of these may return as a
future ADR once a seated-judge-shaped need exists.

**The predictive-processing reading, which is load-bearing** (docs/vision.md): the program is
the generative model and verdicts are prediction error; the nexus is **perceptual
organization** — the layer that turns raw observation (bytes, diffs) into structured percepts
(definitions, dependencies, callers) *before* error is computed against the model. Two
consequences fall out and are law in spec 05: the nexus carries **no authorship and no meter
state anywhere in it** (percepts contaminated by identity or by accumulated error break the
conditional-independence assumption of ADR-0003 — a perception layer must not know whose hands
or how hot the wire); and the nexus is **never an input to the fold** (state estimation informs
judgment and sentencing presentation, never the arithmetic of accumulated surprise).

**Pinned by this decision** (relitigate only by superseding ADR): the nexus is derived and
disposable (a cache with a contract, never a store of record; deleting it loses nothing);
extraction is deterministic and its identity is versioned like a judge's
(`extractor.name + extractor.version`; a behavior change without a version bump is a defect the
golden-fixture test exists to catch); the graph is identity-free by construction; the artifact
validates against `schemas/nexus.schema.json`; and `src/nexus/**` takes zero runtime
dependencies.

## Consequences

- `docs/spec/05-nexus.md` binds the subsystem; `schemas/nexus.schema.json` is the interchange
  contract; `gwtp nexus` is the CLI surface; `gwtp judge --ring` makes spec 03 §3's escalation
  real.
- Language coverage grows extractor by extractor. If lexical extraction hits its ceiling,
  tree-sitter re-enters as a superseding ADR that owns its dependency cost — the same clause
  ADR-0006 reserved for the distillation miner.
- `src/distill`'s epoch-boundary import graphs and the nexus are two readers of one concept;
  converging them (the nexus built *at a boundary commit* becoming pass-one's import snapshot)
  is recorded in `docs/spec/OPEN-QUESTIONS.md` rather than forced now.
- Making the nexus blind **by ratified law** (adding `src/nexus/**` to INV-003's scope) is a
  `.program/` amendment only a human may enact — proposed in
  [`proposals/PROPOSED-nexus-amendment.md`](../../proposals/PROPOSED-nexus-amendment.md); until
  then the same boundary is held by tests.
