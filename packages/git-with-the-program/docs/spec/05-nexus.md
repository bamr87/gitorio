# Spec 05 — The Nexus

Status: Designed · Machine schema: [`schemas/nexus.schema.json`](../../schemas/nexus.schema.json) · Decision: [ADR-0007](../adr/0007-nexus-code-knowledge-graph.md) · Prior art: [GitNexus](https://github.com/abhigyanpatwari/GitNexus) (concept-adapted, clean-room)

## 0. Orientation

The nexus is the engine's **perception layer**: a code knowledge graph derived from one tree state — directories, modules, definitions, and the import / call / inheritance edges between them, every node addressable as `file:line-span`. It answers the questions the specs already ask and nothing else answers: *what is the enclosing function body? who are the nearest callers?* (spec 03 §3), *is this one seam or many?* (spec 02 §5), *does anything in `core/` ever import a forge API?* (spec 04 §2's negative space, live against the present tree).

Three stores, three politics — the first two from spec 01 §1, the third defined here:

| | **Program** | **Ledger** | **Nexus** |
|---|---|---|---|
| Nature | Normative — the law | Observational — the evidence | Perceptual — the percepts |
| Location | `.program/` (in-tree) | `refs/program/ledger` | `.gwtp/nexus/` (gitignored cache) |
| Writers | Humans, ratified PRs | Machines, append-only | Machines, **overwrite at will** |
| Authority | Absolute | Authoritative record | **None — a cache with a contract** |
| Lost if deleted | The constitution | The evidence | Nothing; rebuild from the tree |

The mnemonic is law: **the program prescribes, the ledger remembers, the nexus perceives.** An assertion may never cite nexus state as normative authority, and no nexus content is a record of anything — it is a deterministic restatement of the tree it was built from.

## 1. Politics

1. **Derived from tree bytes only.** The builder's input is a set of `(path, content)` pairs —
one tree state, worktree or commit. It never reads `git log`, blame, commit metadata, `accumulators/`, or the ledger ref. There is no field anywhere in the graph that an author, a committer time, or a meter reading could occupy; `assertBlind` walks a serialized nexus clean. This extends ADR-0003 to perception: a judge's percepts must not be a side channel for what the judge may not see. (Making this ratified law — INV-003's scope gaining `src/nexus/**` — is a human's amendment; see `proposals/PROPOSED-nexus-amendment.md`. Until then `tests/nexus/blindness.test.ts` holds the same line.)
2. **Never authoritative, never normative.** The fold (spec 02 §4) takes no nexus input;
firing classification (spec 02 §5) takes no nexus input. The nexus informs *evidence assembly* (rings, §5), *presentation* (seam naming in proposals, §6), and *rung-0 queries* (§7) — all places where a wrong graph produces a visible wrong answer, never a corrupted accumulator.
3. **Never committed.** `.gwtp/nexus/` is gitignored. Derived bytes in the tree would drift from the tree that derives them within one commit; whoever needs a nexus rebuilds one.
4. **Deterministic, or it is a defect.** Same file set + same extractor version ⇒
byte-identical canonical artifact ⇒ same content hash. Property-tested, the same obligation the fold carries (spec 02 §1 property 2).
5. **Extraction has a seat.** An extractor's identity is `name + version`, the analogue of a
judge's `model + prompt-hash` (spec 01 §7): evidence assembled at a wider ring flows toward verdicts, so *what widened the ring* must be pinned provenance. Changing extraction behavior without bumping `NEXUS_EXTRACTOR_VERSION` is a defect; the golden-fixture test (pinned artifact hash) exists to make it a loud one. Whether the seated extractor also belongs in `.program/manifest.yaml` is a ratification question (see the amendment proposal).

## 2. The graph

Node kinds, each with a stable id:

| Kind | Id | Carries |
|---|---|---|
| `directory` | `dir:<path>` | `path` |
| `module` | `module:<path>` | `path`, `language` (or `null`), `parsed`, `lines` |
| `definition` | `def:<path>#<name>@<start-line>` | `path`, `name`, `form`, `span`, `exported` |
| `external` | `ext:<specifier>` | `specifier` — an import target outside the tree (`node:fs`, `yaml`), or an in-tree specifier that did not resolve |

`definition.form` ∈ `function | class | method | interface | type-alias | enum | const`.
`span` is `{start, end}`, 1-based, inclusive, in the module's post-image — so any node can be cited as `path:start-end`, the exact currency of INV-004. A `method` is a definition nested in a `class` span; nesting is expressed by `defines` edges, and "the enclosing definition of line N" (§5) means the **innermost** definition whose span contains N.

Edge kinds:

| Kind | From → To | Carries |
|---|---|---|
| `contains` | `directory` → `directory \| module` | — |
| `defines` | `module` → `definition`, `class` → `method` | — |
| `imports` | `module` → `module \| external` | `specifier` (verbatim), `form` ∈ `value \| type-only \| dynamic \| re-export`, `at` (line) |
| `calls` | `definition` → `definition \| external` | `resolution` ∈ `same-file \| imported`, `at` (line of the call site) |
| `extends` | `definition` → `definition \| external` | `at` |
| `implements` | `definition` → `definition \| external` | `at` |

The `imports.form` vocabulary is deliberately the `ImportForm` ladder of `src/judge/deterministic/imports.ts`, so the graph and the import-boundary judge describe the same fact in the same words. Edges are emitted only when **provable** from the text; what could not be proved is *counted* in `stats`, never guessed. GitNexus carries per-edge confidence scores; the nexus takes the harder line that suits a governance engine — a graph that is sometimes silent, never wrong.

## 3. Construction — the passes

Ordered passes over one immutable snapshot, adapted from GitNexus's pipeline:

- **P1 — structure.** Every file becomes a `module` node; every ancestor directory a
`directory` node; `contains` edges bind them. No file is skipped: an unsupported language is a `module` with `language: null, parsed: false` and full ring-`file` service (§5) — the graph degrades, it never blocks.
- **P2 — definitions.** Per-language extraction of definitions with spans and exportedness.
v0 ships one extractor, TypeScript/JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`), **lexical by design**: comments and string/template bodies are blanked first (newlines preserved, so line numbers survive), then declarations and brace-matched spans are read from what remains. ADR-0006's posture — hand-written, dependency-free — with the stated recall gaps of §3.1.
- **P3 — imports.** Static, bare, dynamic and re-export forms, resolved NodeNext-style:
relative specifiers against the snapshot (exact, `.ts/.tsx/.js/...` siblings, `/index.*`; emitted `.js` resolving to its `.ts` sibling); everything else — and every relative specifier that resolves to nothing — becomes an `external` node, the second case counted as `imports.unresolved`.
- **P4 — calls.** Call sites (`name(...)`, `new Name(...)`, `ns.name(...)` for a namespace
import) inside each innermost definition span, resolved same-file first, then through import bindings to the target module's exported definition. A binding that resolves to an external module yields a `calls` edge to the `external` node. Bare names that match no definition and no binding are locals and parameters — not counted, not guessed.
- **Seams are not a pass.** They are derived at query time (§6) so the partition rule can evolve without re-addressing the artifact.

Determinism requirements: input paths are sorted before every pass; nodes sort by id; edges sort by `(kind, from, to, at)`; ids are pure functions of path, name and start line. The artifact's `nexus` field is the content hash (`src/core/canonical.ts` canonicalization) of the body **minus that field** — the same self-addressing discipline as ledger events (spec 02 §1, Q-24), so two builders on the same tree produce one address.

### 3.1 Stated recall gaps (v0 extractor)

Precision over recall, stated rather than papered over: computed member names, declaration merging, `var/let` bindings, method calls through receiver objects (`obj.method()` where `obj` is not a namespace import), string-built dynamic import specifiers, and re-exported names as call-resolution targets are all invisible to the lexical pass. Each is a smaller graph, never a false edge. If these gaps come to bound the judge's escalation quality, that is the tree-sitter signal reserved in ADR-0007's consequences.

## 4. Storage and interchange

`gwtp nexus build` writes the canonical artifact to `.gwtp/nexus/graph.json` (path configurable; directory gitignored). The artifact validates against `schemas/nexus.schema.json` and contains: `nexus` (self hash), `extractor` (`{name, version, languages}`), `stats`, `nodes`, `edges` — and deliberately nothing else. No timestamp, no host path, no builder identity: anything not derived from the tree would be bytes the contract never asked for (the Q-48 rule, applied here).

A cached artifact is trusted exactly as far as an accumulator cache is (spec 02 §1.2): staleness is answered by rebuilding — `gwtp nexus status` rebuilds in memory and compares hashes rather than trusting a marker. Consumers inside one process pass the in-memory graph and never write.

## 5. Context rings — operationalizing spec 03 §3

Spec 03 §3 grants an abstaining judge "an expanding context ring (function bodies → file → nearest callers)"; `src/core/change.ts` fixes the rungs `hunk → enclosing-symbol → file → callers`. The nexus supplies the implementation as a `ChangeSource` (the port the evidence assembler already consumes), leaving the assembler and the seal untouched:

- **`hunk`** — the parsed diff hunks, unchanged. (Today's behavior at every ring; the rings below are what the nexus adds.)
- **`enclosing-symbol`** — plus, per hunk, one context hunk covering the span of the innermost
definition enclosing the hunk's post-image lines. No enclosing definition (top-level code, unparsed module) adds nothing at this ring.
- **`file`** — plus one context hunk covering each touched module in full. Works for every module, parsed or not.
- **`callers`** — plus one context hunk per **nearest caller**: for each enclosing definition
of a base hunk, every definition with a resolved `calls` edge into it, at that definition's span, in that definition's module.

Rings are **cumulative** (each contains its predecessor), matching the spec's arrow. Rules that keep the widening honest:

1. **Context is context.** Synthesized hunks carry only ` `-prefixed (context) lines, with
`oldStart = newStart = span.start` and equal line counts. `postImageLines` therefore reports them `added: false`, so a deterministic judge can never mint an offence from granted context — only from what the diff introduced. A citation *into* a context hunk is legal: the judge was shown it (`citationsWithinBundle`, INV-004).
2. **The ring does not escape the assertion's scope.** Everything the source offers is
scope-intersected (by the source, and again by the assembler's own `scopedHunks`). A caller living outside `assertion.scope` is not shown: a judge granted out-of-scope code would be ruling on conduct outside its jurisdiction. Least-committal reading; recorded as Q-66.
3. **Context is read from the snapshot the source was built over**, which must be the tree the
diff lands on (post-image). Judging an old diff against a newer worktree skews the ring; the CLI states this, and recorded Q-67 covers tree-accurate assembly for the harness.
4. **Determinism carries provenance.** A sealed bundle's `hunkHash` — half the verdict cache
key (spec 03 §1) — now depends on ring content, hence on the extractor. That is why the extractor is seated (§1.5): a re-judgment after an extractor change is a *superseding* event under spec 02 §3, exactly like a re-judgment after a prompt change.

## 6. Seams — structure for the sentencing side

A **seam** is a connected component of the undirected graph over in-tree modules joined by `imports` edges; its id is its lexicographically-least module path. `gwtp nexus seams` lists the partition.

Seams exist for the *presentation* half of firing: spec 02 §5's outputs argue "one seam or many call sites", and a refactoring recommendation that names the seam — the actual import-connected cluster, not a directory glob — is an argument a reviewer can check. Two hard lines, both consequences of §1.2: seams never enter the fold, and seam statistics never replace the ratified dispersion inputs (author entropy, path entropy, time spread) — they may *accompany* a proposal as evidence quality, the way the compliance ratio already does. Wiring seam naming into `src/adapters/github/render.ts` is deliberately left to the firing side and recorded as Q-68; the query surface lands first.

## 7. Rung-0 and negative space

The deterministic rung today reads diffs, so it can catch a forge import being *added* to `src/core/**` but cannot certify that none exists. The nexus closes exactly that gap with a whole-tree query: *the set of `imports` edges from modules under `src/core/**` into forge specifiers or `src/adapters/**` is empty* — INV-005's negative-space proof (spec 04 §2), checkable on every tree, citable node by node. `tests/nexus/negative-space.test.ts` runs it on this repository: the framework's own perception proving the framework's own law, per TRJ-003.

This spec deliberately does **not** add a `check: nexus-query` field to the assertion atom — that is a `schemas/assertion.schema.json` change with governance weight (which queries are law-grade?), recorded as Q-69 for ratification rather than smuggled in as implementation.

## 8. Distillation — one concept, currently two readers

Spec 04 §2's pass one already builds import graphs at epoch boundaries (`src/distill/miner.ts`, `ImportGraphSnapshot`): history smoothed backward. The nexus is the same concept run at a single tree: the present, perceived. They should converge — the nexus built at a boundary commit *is* the richer import snapshot, plus definitions and calls that pass-two synthesis could cite — but SEED-04's shipped miner is not refactored under this spec. Recorded as Q-70.

## 9. What the nexus is not

- **Not authority.** No verdict, no accumulator, no proposal is ever *justified by* "the nexus says"; the nexus locates and widens, judges rule, the ledger remembers.
- **Not search.** GitNexus's embeddings, BM25, process tracing and graph chat are out of v0
scope (ADR-0007); a natural-language interface would put a model inside evidence assembly, where only seated judges belong.
- **Not a linter and not a metric.** The graph exists for the loop — rings, seams, negative
space. A statistic no ring, proposal or query consumes has no claim to a field (the docs/vision.md non-goals, applied to perception).
