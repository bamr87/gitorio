# Proposed amendment to `.program/` — the nexus joins the blind zone

**Raised by:** the GitNexus integration session (agent — ADR-0007, spec 05, `src/nexus/**`) **Status:** proposed — requires a human-ratified PR (INV-001) **Target:** `.program/invariants.yaml` (Amendment 1), `.program/manifest.yaml` (Amendment 2, deferred)

---

## Why this is a proposal rather than a commit

INV-001: nothing writes to `.program/` except human-ratified PRs, at `precision: 1.0`, `budget: 1.0` — one machine write fires immediately. The session that built the perception layer therefore delivers its constitutional consequences here, as ready-to-apply diffs, and stops. Same shape as Q-30 / `PROPOSED-program-amendment.md`: the framework working.

---

## Amendment 1 — INV-003's scope gains `src/nexus/**`

**Recommended.** This ratifies a standing fact rather than changing behavior.

### Why

INV-003 makes the verdict branch blind: no author identity, no accumulator state, enforced structurally over `src/judge/**` and `src/evidence/**`. The nexus is the judges' new *perception* — it decides what an escalated judge is shown (spec 05 §5) — so the conditional-independence argument of ADR-0003 covers it with full force: percepts contaminated by identity or the meter corrupt verdicts one step earlier than a contaminated bundle would.

The code already holds the boundary: `src/nexus/**` value-imports neither the sentencing modules nor `src/ledger/**`, its types carry compile-time blindness proofs (`__NEXUS_BLINDNESS_PROOFS`, src/nexus/types.ts), a serialized graph passes `assertBlind`, and `tests/nexus/blindness.test.ts` walks the closure the way `tests/ledger/blindness-boundary.test.ts` walks the judges'. What is missing is only the law saying so — which also puts the deterministic prescreen (`scripts/check-inv003.ts`) on duty over the directory.

### Diff

```diff
--- a/.program/invariants.yaml
+++ b/.program/invariants.yaml
@@
 - id: INV-003
   statement: No code path passes author identity or accumulator state to any judge
   class: boundary
-  scope: ["src/judge/**", "src/evidence/**"]
+  scope: ["src/judge/**", "src/evidence/**", "src/nexus/**"]
```

**Provenance line** (spec 01 §4 rule 1):

```
provenance: [adr-0003, adr-0007, docs/spec/05-nexus.md#1-politics, tests/nexus/blindness.test.ts, pr#<this PR>]
```

### The lockstep this ratification requires — read before merging

`tests/ledger/blindness-boundary.test.ts` ("derives the blind directories from the ratified INV-003") asserts that `BLIND_DIRS` in `scripts/check-inv003.ts` EQUALS the scope the constitution gives INV-003 — in both directions. So:

- Amending the scope **without** adding `'src/nexus/'` to `BLIND_DIRS` breaks that test.
- Adding the constant **without** the amendment breaks it the other way.

CONTRIBUTING.md says an amendment PR edits only `.program/` — but `BLIND_DIRS` is the law's enforcement mirror, not an engine feature, and the relation test exists precisely so the two cannot drift. The honest options, for the ratifier to choose:

1. **Carry the one-line `BLIND_DIRS` change in the ratification PR** and say so in the body (this proposal is the reviewable argument for the exception), or
2. amend CONTRIBUTING.md first to name enforcement mirrors as part of an amendment.

Option 1 is recommended; it is one line, and the test is the reviewer's proof it is the *right* line. Widening `BLIND_DIRS` widens what the prescreen fails CI for — flagged here as the governance change it is (same rule CONTRIBUTING applies to `MACHINE_ACTOR_PATTERNS`).

### Verification after applying

```bash
npm run check:inv003        # still exit 0: src/nexus was already clean
npm run test                # blindness-boundary derives the new scope and matches BLIND_DIRS
```

---

## Amendment 2 — seat the extractor in `manifest.yaml`

**Deferred: decide the shape first.** Do not apply as-is.

### Why it is argued

Spec 05 §1.5: extraction identity is the analogue of a judge's `model + prompt-hash`, because ring evidence flows toward verdicts. Judges are seated in `.program/manifest.yaml` (spec 01 §7); by the same logic the seated extractor arguably belongs there:

```yaml
extractors:
  - id: gwtp-nexus
    version: 0.1.0        # must equal NEXUS_EXTRACTOR_VERSION; a mismatch fails validation
```

### Why it is deferred

`gwtp validate` treats an unknown manifest key as an ERROR (Q-34's ruling: a typo that silently does nothing is the worst outcome available). Adding `extractors:` today fails INV-006 on the spot. The right order is: rule on the shape (does the manifest seat extractors, or does the golden-fixture test — `tests/nexus/build.test.ts`, which pins fixture-hash to version — remain the whole seat?), then land the engine's decoder change, then ratify the key. Until then the seat is enforced in code: version bump + golden hash move together or CI fails.

---

## What the integration session did NOT touch

For the record, and to make the INV-001 check on its PR trivial:

- No file under `.program/` was created, edited or deleted.
- No existing file under `docs/spec/**` or `schemas/**` changed semantics: spec 05 and
`schemas/nexus.schema.json` are NEW contracts; `OPEN-QUESTIONS.md` gained entries (Q-65 … Q-70), which is that file's purpose.
- `prompts/**` and `seeds/**` are untouched — no judge was re-seated.
