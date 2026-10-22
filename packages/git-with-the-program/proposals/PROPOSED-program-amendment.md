# Proposed amendment to `.program/`

**Raised by:** SEED-01 (agent session — contract layer, CI, INV-001 check) **Status:** proposed — requires a human-ratified PR **Target:** `.program/scope.yaml` (Amendment 1), `.program/invariants.yaml` (Amendment 2, optional)

---

## The conflict, in three sentences

`seeds/SEED-01-scaffold.md` deliverable 4 says: *"Update `.program/scope.yaml` to claim `src/**`."* INV-001 says: *"Nothing writes to `.program/` except human-ratified PRs; machine actors are excluded from the path"* — `enforcement: deterministic`, `precision: 1.0`, `budget: 1.0`, which is to say **one machine write fires immediately**. An agent session performing deliverable 4 literally would breach the first invariant of the framework in the act of building the framework, so the amendment is delivered here as a ready-to-apply diff instead, and a human applies it under their own name.

This is the framework working, not the framework failing. `scripts/check-inv001.ts` — written in the same session — would have flagged that write on the very PR that made it. See `docs/spec/OPEN-QUESTIONS.md` Q-30, and consider correcting the seed text so the next agent does not simply do it.

---

## Amendment 1 — claim `src/**`, `scripts/**` and `tests/**` in `scope.yaml`

**Required.** This is SEED-01 deliverable 4.

### Why

`scope.yaml` is the **obsolescence baseline**: code that is in the tree but unclaimed by `scope.yaml` across N distillation epochs is a `stale-claim` candidate (docs/spec/01-core-memory.md §6, docs/spec/02-ledger.md §7). SEED-01 creates `src/**`, `scripts/**` and `tests/**`. Leaving them unclaimed makes the engine's own source code an obsolescence candidate against its own scheduled sweep — the framework filing a stale-claim proposal against itself for the crime of existing.

`since: e0` because there is no distillation history to date: this program was authored, not distilled (`.program/manifest.yaml` carries `watermark.last_walked: null`, `last_epoch: e0`).

**Provenance line** (spec 01 §4 rule 1 — no assertion without provenance; put this in the PR body, and in the `provenance` field of any assertion this claim later supports):

```
provenance: [seeds/SEED-01-scaffold.md#deliverables-4, docs/spec/01-core-memory.md#6-trajectory-and-scope,
             docs/spec/02-ledger.md#7-triggers, adr-0006, commit 17d13dd, pr#<this PR>]
```

Read as: the seed asked for the claim; spec 01 §6 and spec 02 §7 say what an unclaimed path costs; ADR-0006 (Option A, TypeScript) is what put source under `src/` in the first place; commit `17d13dd` is where the seed itself landed.

### Diff — copy-pasteable, verified against the current file

Verified by `patch -p1 --dry-run` against `.program/scope.yaml` at commit `17d13dd` (14 lines, trailing newline present): applies cleanly, no fuzz, no offset.

```diff
--- a/.program/scope.yaml
+++ b/.program/scope.yaml
@@ -11,4 +11,9 @@ claims:
     since: e0
   - path: "prompts/**"
     since: e0
-# src/** claims land with SEED-01.
+  - path: "src/**"
+    since: e0
+  - path: "scripts/**"
+    since: e0
+  - path: "tests/**"
+    since: e0
```

Apply with either of:

```bash
git apply path/to/the-above.diff        # from the repo root
patch -p1 < path/to/the-above.diff
```

The trailing comment is removed by the diff because it stops being true the moment the claim lands.

### Result

```yaml
claims:
  - path: "docs/**"
    since: e0
  - path: "schemas/**"
    since: e0
  - path: ".program/**"
    since: e0
  - path: "seeds/**"
    since: e0
  - path: "prompts/**"
    since: e0
  - path: "src/**"
    since: e0
  - path: "scripts/**"
    since: e0
  - path: "tests/**"
    since: e0
```

`src/**` is claimed as one subtree rather than six (`src/core/**`, `src/adapters/**`, …). The narrower spelling is defensible — those subtrees have genuinely different governance, and a reviewer could then accept or reject them independently — but the seed asks for `src/**`, and a scope claim answers *"does the program still support this path?"*, which is a question about the whole engine. The boundaries between the subtrees are already law: INV-005 scopes `src/core/**`, INV-003 scopes `src/judge/**` and `src/evidence/**`. Scope should not restate them.

### Two tests must change in the same PR — deliberately

`tests/core/program.test.ts` pins the CURRENT, unclaimed state, so the claim cannot land silently:

| Test | Today | After |
|---|---|---|
| `scope.yaml: five claims, and src/** is NOT yet claimed` | expects 5 paths | expects 8: add `scripts/**`, `src/**`, `tests/**` to the sorted list |
| `src/** is currently unclaimed — a stale-claim candidate until the amendment lands` | expects `unclaimedPaths(...)` to be `['src/core/index.ts']` | expects `[]`; rename the test |

### Left unclaimed on purpose — a question for the reviewer

The amendment does not claim the repo's operational surface: `.github/**`, `posts/**`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `CONTRIBUTING.md`, `README.md`, `ROADMAP.md`, `GLOSSARY.md`, `proposals/**`. Under a literal reading of spec 01 §6 those become stale-claim candidates once the obsolescence sweep runs.

Two readings, and this proposal takes neither:

1. **Scope claims cover source the program governs**, and build manifests / prose are out of frame. Then nothing more is needed, but the sweep must learn an exclusion.
2. **Scope claims cover the whole tree.** Then add, inside the same hunk, `- path: ".github/**"`,
`- path: "posts/**"`, and `- path: "*"` for the root files. That last one is correct but reads like a typo: under the glob subset in `src/core/paths.ts`, `*` never crosses `/`, so a bare `*` matches `package.json` and `README.md` and nothing deeper (verified; see `docs/spec/OPEN-QUESTIONS.md` Q-12). If a reviewer wants that claim, it deserves a comment in `scope.yaml` saying why it is not `**`.

Worth settling before the sweep ships in SEED-02, not after.

---

## Amendment 2 — ratify the six invariants

**Recommended, and already the stated first human PR** (README.md step 1).

### Why

Every assertion in `.program/invariants.yaml` is `status: inferred`. Per spec 01 §4.2, `inferred` is **never enforced** — so today the engine governs nothing, including itself. `enforcedAssertions()` returns an empty list, and `tests/core/program.test.ts` asserts exactly that ("nothing is enforced yet, because nothing is ratified yet").

This is listed second because it is a judgement call about the *content* of the law, not a mechanical consequence of SEED-01.

### Diff

```diff
--- a/.program/invariants.yaml
+++ b/.program/invariants.yaml
@@
   half_life: 365d
-  status: inferred
+  status: ratified
   provenance: [adr-0001, design-thread-2026-07]
```

…repeated for each of INV-001 … INV-006 that the reviewer accepts. Rejecting one means leaving it `inferred` (or retiring it) and recording the reasoning in the PR body.

Note this cannot be applied by a script even in principle: `CandidateAssertion` pins `status` to the literal `'inferred'`, so a blanket status rewrite over the assertion list does not type-check. Promotion has to be deliberate and per-assertion — schema `allOf/0` and spec 04 §4 doing their job.

---

## Amendment 3 — dispersion thresholds are law, not code

**Deferred.** Blocks v1, not v0.

### Why

Spec 02 §5 decides the framework's single most consequential question — *is the code wrong or is the law wrong?* — and gives **no numbers**. It states the rule qualitatively ("low author/path entropy, tight window" vs "high entropy, sustained over months") and stops.

`src/core/proposal.ts` therefore ships `classifyFiring(stats, policy)` with the policy as an explicit **parameter** and no default baked in; `PROVISIONAL_DISPERSION_POLICY` exists so SEED-02 has something runnable, under a name that says it is provisional.

These thresholds decide when the framework proposes amending its own constitution. That is governance, not implementation detail, and it should be ratified rather than merged. But `schemas/assertion.schema.json` has no field for them, and adding one is a schema change SEED-01 may not make — so this amendment is **deferred** pending a decision on where such knobs live.

### Options for the reviewer

1. **Global, in `manifest.yaml`** — simplest; one policy for the whole repo. Needs no assertion-schema change.
2. **Per-assertion, in `invariants.yaml`** — most expressive (a `convention`-class assertion
probably wants a different bar than a `boundary`-class one). Requires adding an optional `dispersion` object to `schemas/assertion.schema.json`.
3. **Engine constant** — reject this amendment; accept that the numbers are implementation.

### Provisional values currently in code, for reference

```yaml
author_entropy_min:    0.6      # normalized Shannon entropy over contributing authors
min_distinct_authors:  3        # "many hands" needs a floor; entropy alone is 1.0 for 2 authors
path_entropy_min:      0.5      # normalized Shannon entropy over contributing paths
time_spread_min:       60d      # "sustained over months" — the spec says months, this says two
```

The rule is a **conjunction**: `reprogram` requires all four; anything short is `refactor`. That asymmetry is deliberate — proposing an amendment to the constitution should be harder than proposing a refactor.

Unresolved alongside it: the hysteresis re-arm fraction ("~50% of budget", spec 02 §6), shipped as `REARM_FRACTION_DEFAULT = 0.5` and carried on `FoldKnobs` as a parameter. Same question: constant, global knob, or per-assertion? See `docs/spec/OPEN-QUESTIONS.md` Q-14 and Q-22.

---

## What the SEED-01 sessions did NOT touch

For the record, and to make the INV-001 check on this PR trivial:

- No file under `.program/` was created, edited or deleted.
- No file under `docs/spec/**` (other than the newly created `OPEN-QUESTIONS.md`, which the
seed explicitly directs a session to create), `schemas/**`, `prompts/**` or `seeds/**` had its semantics changed.
- `CLAUDE.md`, `README.md`, `ROADMAP.md` and `GLOSSARY.md` are untouched.
- No writing git command was run.
