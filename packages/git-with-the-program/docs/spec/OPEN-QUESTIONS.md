# Open Questions

Ambiguities found while implementing SEED-01's contract layer (`src/core/**`).

**House rule.** Per CLAUDE.md and the seed constraints, a seed session may not change the semantics of `docs/spec/**` or `schemas/**`. Where a spec or schema is genuinely silent, the implementation takes the **least-committal interpretation** and records it here. Every entry below states the question, the interpretation actually shipped, and where in the code it is pinned — so a human ratifying an answer can find and change exactly one place.

Entries are referenced from code comments as `OPEN-QUESTIONS.md Q-nn`.

Three of these (Q-03, Q-05, Q-06) are places where the engine is deliberately **stricter than the JSON Schema**. Those are the only three; the parsers report them with a distinct error code (`strictness`) so a schema-conformance test can whitelist exactly them and no more.

---

## Blocking nothing today, but they fix bytes forever

### Q-01 — `mo` has no day count
`schemas/assertion.schema.json` admits `^[0-9]+(d|w|mo)$` but nothing defines a month, and
committer-time decay needs a constant.

**Shipped:** `mo` = **exactly 30 days**, `w` = 7 days. Integral, hand-computable, replay-stable, and it reproduces the spec's own fixture (8 months against a 90d half-life ≈ 15%, spec 04 §7). Calendar months would make decay non-uniform and the fold impure over absolute time. **Pinned at:** `src/core/time.ts` → `DAYS_PER_UNIT`, `DURATION_UNIT_MILLIS`.

### Q-02 — `0d` is schema-valid but mathematically undefined
The pattern admits `0d`, and `2^(-Δt/0)` is undefined.

**Shipped:** `parseDuration` **accepts** `0d` (diverging from the schema would be a semantic edit SEED-01 may not make), and `decayFactor` pins the degenerate case instead: it returns `1` at zero elapsed time and `0` for any positive elapsed time.
**Alternative for ratification:** tighten the schema pattern to `^[1-9][0-9]*(d|w|mo)$`.
**Pinned at:** `src/core/time.ts` → `parseDuration`; `src/core/accumulator.ts` → `decayFactor`.

### Q-07 — spec 02 §2's own example timestamp is not RFC 3339
The illustrative event carries `t: 2026-07-21T14:03Z`. Seconds are mandatory in RFC 3339, so that value fails `ajv-formats`' `date-time` — the spec's own record would fail its own schema.

**Shipped (least-committal, satisfies both):** the **read** path accepts the abbreviated form, so the spec's example parses. The **mint** path emits exactly one normalized form — UTC, second precision, `Z`, no fractional seconds — so anything GWTP writes validates under ajv. **Needs confirming:** that the schema wins and the example is shorthand. **Pinned at:** `src/core/time.ts` → `RFC3339_LENIENT_PATTERN`, `committerTimeFromEpochMillis`.

### Q-24 — the canonical body for the event hash is undefined
Spec 02 §1 says "hash of canonical body = filename = idempotency key" but never defines *canonical body*. This fixes every event id in the project's history, so it needs ratifying.

**Shipped:** RFC 8785-shaped JSON canonicalization (keys sorted by UTF-16 code unit, no insignificant whitespace, finite numbers only, `-0` normalized to `0`, shortest round-trip number form) over the record **minus its own `event` field**, hashing the **JSON** and not the stored YAML — YAML has no canonical form, so hashing stored bytes would make event identity depend on quoting and line wrapping. Two rules make absence unambiguous: `undefined`-valued keys are **dropped**, `null` is **retained**, and the minter emits a **fixed key set** so `supersedes` is always present (`null` when there is nothing to supersede) and `orphaned` only when `true`. **Pinned at:** `src/core/canonical.ts` → `canonicalize`; `src/core/event.ts` → `eventBodyFromVerdict`, `canonicalEventBody`.

### Q-10 — does the event filename carry the `sha256:` prefix?
Spec 02 §1 shows `events/<sha256-of-event>.yaml`.

**Shipped:** bare 64-hex, no prefix — colons in paths are hostile on Windows checkouts. **Pinned at:** `src/core/event.ts` → `eventFileName`.

### Q-16 — severity `1.0` serializes as `1`
TypeScript and JSON both normalize the literal `1.0`, so canonical JSON emits `1` where the spec examples write `1.0`. The schema enum accepts it (`1.0 === 1` numerically) and the choice is deterministic, but it affects hashed bytes and is worth stating. **Pinned at:** `src/core/severity.ts` → `SeverityWeight`.

---

## Places the engine is deliberately stricter than the schema

### Q-06 — `verdict.evidence` has no `minItems`
`schemas/verdict.schema.json` **requires** `evidence` on violations but sets no `minItems`, so `evidence: []` is schema-valid — yet ADR-0005, INV-004, both judge prompts and SEED-03's acceptance test ("uncited violation rejected") all say *no citation, no verdict*.

**Shipped:** the type is `NonEmptyReadonlyArray<Citation>` and the decoder rejects an empty array with code `uncited-violation`. **Proposed resolution:** add `"minItems": 1` to `schemas/verdict.schema.json#/properties/evidence` in a normal PR (out of SEED-01's remit). **Pinned at:** `src/core/verdict.ts` → `ViolationVerdictCommon`.

### Q-03 — nothing forbids a violation payload on `aligned` / `abstain`
The schema never forbids `severity`, `evidence` or `rationale` on non-violating verdicts, but spec 03 §4 says aligned verdicts stay terse and prompts/invariant-judge.md says "verdict + confidence only".

**Shipped:** `AlignedVerdict` and `AbstainVerdict` carry `?: never` poison pills, and `decodeVerdict` **rejects** the extra fields with code `strictness` rather than silently dropping them — so SEED-03's re-prompt path can act on it. `abstain` keeps `rationale` optional: an abstention that says what it lacked feeds the escalation decision. **Question for ratification:** should the schema gain an `if/then` forbidding them, or should the parser be lenient and drop? **Pinned at:** `src/core/verdict.ts` → `AlignedVerdict`, `AbstainVerdict`, `decodeVerdict`.

### Q-05 — `event.rationale` has no `pattern`
It is typed as a plain string with the description "Blob ref (sha256:…)", while `event.event` and `judge.prompt` both carry `^sha256:[a-f0-9]{64}$`.

**Shipped:** the type is `RationaleRef` and the parser enforces the prefix — the description is followed, since the alternative is a hot-path field holding unbounded prose. **Proposed resolution:** add the pattern so the three sha256 fields are consistent. **Pinned at:** `src/core/ids.ts` → `RationaleRef`, `parseRationaleRef`.

---

## Unschema'd shapes that INV-006 nevertheless claims to cover

### Q-08 — five artifacts have no schema
INV-006 says *all* program and ledger artifacts validate against `schemas/` in CI, but only four schemas exist. `manifest.yaml`, `scope.yaml`, `trajectory.yaml`, `accumulators/*.yaml`, `epochs/*.snapshot.yaml` and the `Proposal` record have none — so `gwtp validate` can only truly validate `invariants.yaml` and `precedents.yaml`.

**Shipped (interim):** `src/core` exposes hand-written decoders for the unschema'd artifacts (`decodeManifest`, `decodeScopeFile`, `decodeTrajectoryFile`, `AccumulatorSnapshot`), and `SCHEMA_ID` lists **exactly the four real contracts and no more** — inventing `$id`s here would quietly manufacture a contract SEED-01 has no authority to write. `gwtp validate` should report the rest as *unvalidated* rather than pretending. **Pinned at:** `src/core/index.ts` → `SCHEMA_ID`; `src/core/program.ts`; `src/core/accumulator.ts` → `AccumulatorSnapshot`.

### Q-13 — `dispersion_snapshot` is an unconstrained object
The schema declares it `{"type": "object"}` with a description naming four fields. It lives **inside the hashed body**, so its shape must be pinned for idempotency.

**Shipped:** exactly four scalars — `author_entropy` and `path_entropy` as **normalized** entropies, `time_spread` as span in **milliseconds**, `compliance_ratio` nullable. Entropies are in **bits** (log2), the natural companion to a base-2 decay. **Pinned at:** `src/core/event.ts` → `DispersionSnapshot`.

### Q-12 — no glob syntax is specified anywhere
`scope`, `scope.yaml` and `implies_obsolete` all take path globs; nothing says which dialect.

**Shipped:** a deliberately small subset — `**` = zero or more whole segments (`a/**` matches `a/b` and `a/b/c`, **not** `a`), `*` = within one segment, `?` = one non-slash character. No braces, negation, character classes or extglob. `parsePathGlob` **rejects** anything outside the subset at load time, so an unsupported pattern fails loudly rather than silently never matching. No dependency (INV-005 keeps `src/core` dependency-free). **Pinned at:** `src/core/paths.ts` → `globToRegExp`, `parsePathGlob`.

### Q-11 — the fold is order-sensitive, the ledger is a set
ADR-0002 makes the ledger a content-addressed set merged by union, but a leaky integrator is order-sensitive, so "same event set → same state" is only true if the set is **totally ordered** first.

**Shipped:** `compareForFold` sorts by committer time ascending, then by event id lexicographically. The id tiebreak makes same-instant events deterministic. Related and shipped with it: `decayFactor` returns `1` for non-positive elapsed time, so an out-of-order or clock-skewed committer timestamp can never *amplify* accumulated surprise. **Needs confirming:** the tiebreak and the clamp. **Pinned at:** `src/core/event.ts` → `compareForFold`; `src/core/accumulator.ts` → `decayFactor`.

### Q-23 — supersession forks
Spec 02 §3 says the fold takes "the tip of each supersession chain" but is silent on **two events superseding the same event**, which concurrent CI runs make reachable.

**Shipped (least-committal):** every event that no other event supersedes is a tip; forks are **reported** in `SupersessionResolution.forks` rather than resolved by an invented tie-break. Consequence: a fork double-counts surprise until a human collapses it. **Alternative:** keep only the lexicographically-lowest successor. **Pinned at:** `src/core/event.ts` → `resolveSupersessions`.

---

## Numbers the spec states qualitatively

### Q-14 — hysteresis re-arms "below ~50% of budget"
The tilde is the spec's (spec 02 §6). Whether 0.5 is a constant, a per-assertion knob (which would need a field `assertion.schema.json` does not have), or a global tunable is unresolved.

**Shipped:** `REARM_FRACTION_DEFAULT = 0.5`, exported as a **named constant** and carried on `FoldKnobs` as a parameter rather than inlined — precisely because it is soft in the spec. **Pinned at:** `src/core/accumulator.ts`.

### Q-22 — dispersion gives no thresholds at all
Spec 02 §5 distinguishes refactor from reprogram by "low author/path entropy, tight window" versus "high entropy, sustained over months", with **no numbers**. Nothing in the repo says when entropy is high or a window sustained.

**Shipped:** `classifyFiring` takes an explicit `DispersionPolicy` **parameter**; `src/core` ships `PROVISIONAL_DISPERSION_POLICY` under a name that says it is provisional, so SEED-02 has a runnable default instead of silently inventing one at a call site. The rule is a **conjunction**, faithful to the spec's table: `reprogram` requires high author entropy AND enough distinct hands AND high path entropy AND a sustained window. **Governance question:** these are knobs about *how the law changes*, so they arguably belong in `.program/` rather than in code. See `proposals/PROPOSED-program-amendment.md`. **Blocks:** v1, not v0. **Pinned at:** `src/core/proposal.ts`.

### Q-19 — "violation-to-compliance ratio" vs the field name `compliance_ratio`
Spec 02 §4 says *violation-to-compliance ratio*; the schema field is `compliance_ratio`. The literal ratio is unbounded and undefined at zero compliances.

**Shipped:** `compliances / (compliances + violations)`, in `[0,1]`, `null` when both are zero. **Pinned at:** `src/core/dispersion.ts` → `DispersionStats.complianceRatio`.

### Q-18 — dispersion weighting
Spec 02 §5 says dispersion runs over "the contributing (undecayed-weighted) events", which reads two ways.

**Shipped:** `residual` (each event weighted by its decayed share at firing time) is the default; `uniform` is available; **the choice is recorded on the stats**, so any published figure is self-describing. **Pinned at:** `src/core/dispersion.ts` → `DispersionWeighting`.

---

## Blindness (INV-003) — where the types stop

### Q-09 — free text is opaque to the type system
`Hunk.text` and `charterExcerpt` are strings, and no type system can see inside them. A patch containing a `Signed-off-by:` / `Co-Authored-By:` trailer, a diff to CODEOWNERS or AUTHORS, or a charter paragraph naming a person puts author identity in front of a judge **without violating any type**. This is a real residual hole in ADR-0003 as specified.

**Shipped:** stated as a documented limitation rather than assumed away. `assertBlind` is explicitly a *second* line, not the line. **Proposed handling, needs a spec ruling:** the evidence assembler (SEED-03) strips commit message trailers and identity-bearing metadata from hunk text before sealing, and mandatory scrubbing is written into spec 03 §3. **Pinned at:** `src/core/blindness.ts` → `assertBlind`; `src/core/change.ts` → `Hunk`.

### Q-20 — is prior-verdict blindness a third rule?
Spec 03 §2 names exactly two blindness rules (author, accumulator), but `prompts/invariant-judge.md` tells the magistrate it is given "no history of prior rulings". A judge that sees prior verdicts on this assertion autocorrelates for the same reason a judge that sees the meter does.

**Shipped:** `LedgerEvent` is treated as sentencing-only, so prior rulings cannot enter an evidence bundle. `Precedent` is pointedly **not** forbidden — settled case law is normative and the regression judge is required to read it (spec 03 §7). **Case law yes; running case history no.** **This is a small extension beyond the letter of §2 and needs confirming.** If a superseding re-judgment is meant to see what it supersedes, spec 03 §2 must say so, because the type layer currently forbids it. **Pinned at:** `src/core/blindness.ts` → `SentencingOnlyValue`.

### Q-21 — does the judge see the knobs?
Spec 03 §3 enumerates what the judge sees: "the assertion — statement, class, scope". It conspicuously omits `precision`, `budget`, `half_life` and `status`. But `prompts/invariant-judge.md` interpolates `{{assertion_yaml}}`, which reads as the whole record.

**Shipped:** the narrow reading. `AssertionView` is `{id, statement, class, scope}` and has no slot for a knob at all; `assertionView()` is a one-directional door with no inverse. A judge holding precision and budget is one arithmetic step from inferring how hot the meter is, and a bundle with no numeric knobs gives a stray accumulator value nowhere natural to land. **Question:** is the omission deliberate blindness or brevity in the spec's prose? If the former, the prompt should render the projection rather than the whole record. **Pinned at:** `src/core/evidence.ts` → `AssertionView`.

---

## Keys, identity and shapes that do not line up

### Q-04 — `event.assertion` is an unconstrained string
`assertion.id` is patterned `^(INV|CAND)-[0-9]{3,}$`, but `event.assertion` and
`verdict.assertion` are bare strings. Read as **deliberate**: spec 02 §7 has obsolescence sweeps accumulating "into slower accumulators keyed by scope claim", not by assertion id.

**Shipped:** `AccumulatorKey = AssertionId | ScopeClaimKey` — wide enough to carry a scope
claim, narrow enough to be meaningful. v0 emits only the `AssertionId` arm. **If instead the looseness is an oversight**, the schemas should carry the id pattern and the union should collapse. **Related, unresolved:** how scope claims acquire ids at all. `scope.yaml` claims have a `path` and a `since`, and no id. **Pinned at:** `src/core/ids.ts` → `AccumulatorKey`, `parseAccumulatorKey`.

### Q-15 — judge identity is spelled two ways
`manifest.yaml` seats `{id: invariant-judge, model: <model-id>, prompt: sha256:…}`, while spec 02 §2's event carries `judge: {kind: model, id: <model-id>, prompt: sha256:…}`. So `id` means the **seat** in one place and the **model** in the other.

**Shipped:** both shapes are modelled as written (`JudgeSeat` and `JudgeRef`) and the mismatch is left visible rather than silently reconciled. **Question:** which goes in the event — and can a fold reliably attribute an event to a seat without both? **Pinned at:** `src/core/event.ts` → `JudgeRef`; `src/core/program.ts` → `JudgeSeat`.

### Q-17 — path attribution for dispersion is not derivable from the ledger
Path entropy needs the paths a violating change touched, but the event record carries `subject.path` **only** for stale-claim sweeps, and verdict citations are not persisted (`rationale` is a blob ref).

**Shipped:** paths and actors are resolved **outside** the fold via `EvidenceLocus`, supplied by a git-side resolver. This keeps the fold pure and keeps author identity out of the ledger types entirely. `computeDispersion` fails loud (`unresolved-locus`) rather than quietly biasing the attribution toward "refactor". **Question:** should the event schema instead carry a `paths` list, so dispersion is computable from the ledger alone without re-walking git? **Pinned at:** `src/core/dispersion.ts` → `EvidenceLocus`, `computeDispersion`.

### Q-25 — the verdict cache key and the event id are not the same key
Spec 03 §1 says the cache key `assertion-id + hunk-hash + judge-hash` "lines up exactly with the event store's idempotency" — but the event id is the hash of the whole canonical body, which also includes subject, verdict, severity, `t` and `supersedes`. The two are not the same key.

**Shipped:** both, separately. `verdictCacheKey()` composes the three-part key; `eventIdOf()` hashes the full body. **Question:** is the cache key meant to be a separate index alongside the event id, or is the canonical body meant to be narrower than the record? **Pinned at:** `src/core/change.ts` → `verdictCacheKey`; `src/core/event.ts` → `eventIdOf`.

---

## Recorded but not yet shipped against

### Q-26 — precision has a ceiling problem
`assertion.schema.json` bounds `precision` to `(0, 1]`, but spec 02 §6 says a proposal rejected under fire makes precision **rise** — with no headroom above 1.0. Separately, `event.precision_at` is an **unbounded** number in the schema while `precision` is bounded.

**Shipped:** faithful to both schemas as written — `Precision` is branded `(0,1]`, and `ViolationEventBody.precision_at` is a bare `number` so the read path does not reject a third-party event the schema would have accepted. Strict outbound, faithful inbound. **Question:** is the 1.0 cap intended (so "rises" means "rises toward 1.0"), or should the maximum be lifted?

### Q-27 — panel variance has nowhere to live
Spec 03 §5 says inter-judge variance may "discount the event's effective surprise", but `event.severity` is enum-constrained to the four anchors, so a discounted value cannot be expressed there. Applying the discount to `precision_at` would silently overload a field documented as "assertion precision frozen at observation time" and would corrupt replay when knobs are retuned.

**Shipped:** `medianSeverityOrdinal` and `severityRungSpread` exist so SEED-03 can compute the median and the disagreement; the **discount itself is not representable** and is not invented here. **Question:** is the discount a fifth event field, a separate event, or a decision not to record it at all?

### Q-28 — should `abstain` events be written to the ledger?
They never accumulate, but they do escalate, and the escalated ruling supersedes something.

**Shipped:** the schema permits them and the fold ignores them, which is the position taken. It means a supersession chain's root may be an event that never contributed surprise (good for audit). **Related and sharper:** because the fold consumes only tips, an `abstain` emitted at a higher rung that supersedes a lower-rung `drift` **silently removes that drift's accumulated surprise**. Is that intended (honest uncertainty erases the prior call), or should an abstain be forbidden from superseding a violation?

### Q-29 — architectural fork: hand-written decoders vs ajv in the core
`src/core` decoders are hand-written and dependency-free; ajv stays authoritative for INV-006 inside `gwtp validate`. Two reasons: draft-07 `if/then` does not project into TypeScript types, so ajv could never hand back a `RegressionVerdict` that *has* a `PrecedentId` — only an `unknown` needing a cast; and the ledger fold must read events without dragging a validator into the engine.

**The gap between the two validators should be closed by a test rather than by trust:** a fast-check conformance property over generated near-miss records asserting `ajv.validate(schema, x) === decodeX(x).ok` for all four schemas, whitelisting exactly the three `strictness` divergences (Q-03, Q-05, Q-06). **That test belongs to whoever writes `gwtp validate`.** **Flagged because it is expensive to reverse later.**

### Q-30 — SEED-01 deliverable 4 conflicts with INV-001
The seed says "Update `.program/scope.yaml` to claim `src/**`". That is a machine write to `.program/`, which INV-001 forbids at precision 1.0 and budget 1.0 — a single breach fires immediately.

**Shipped:** the claim is delivered as `proposals/PROPOSED-program-amendment.md`, a ready-to-apply diff for a human ratification PR. Nothing in this session wrote to `.program/`. **Worth correcting in the seed text** so the next agent does not simply do it. Fitting, given the framework: the first thing SEED-01 wants to do is exactly the thing the constitution says a machine may not do.

---

## Enforcing INV-001 (the CI check)

### Q-31 — "machine actor" is nowhere defined
INV-001 excludes "machine actors" from the `.program/` path, and nothing in `docs/spec/**`, `docs/adr/**` or `.program/` says what one is. A deterministic check (INV-001 is `enforcement: deterministic`) needs an operational definition, and the definition is the whole teeth of the invariant: too narrow and a bot walks through, too broad and it libels a contributor named Abbott.

**Shipped:** an explicit, reviewable allow-nothing list — `MACHINE_ACTOR_PATTERNS` in `scripts/check-inv001.ts` — matching a commit's **author**, **committer**, or any **`Co-Authored-By:` trailer** against five anchored patterns: `*[bot]@users.noreply.github.com`, `*@bots.noreply.github.com`, `actions@github.com`, `noreply@anthropic.com`, and a display name ending in `[bot]`. No substring heuristics; every entry carries a `why`. Three interpretations inside that, each of which could have gone the other way:
1. **A `Co-Authored-By:` trailer counts as a write.** A human pushing an agent's `.program/`
patch under their own name, with the agent in a trailer, FAILS. Read from ADR-0001's "bots committing to governance files": the trailer is the machine actor's own admission.
2. **`Signed-off-by:` does not count.** Sign-off is attestation, not authorship.
3. **The committer counts, not just the author.** CI that rebases or squashes a human's
`.program/` commit becomes the committer, and that is a machine write path. **Question for ratification:** should the pattern list live in `.program/` — it is a rule about who may change the law, which is itself constitutional — rather than in a script? And if so, under which schema? (Same shape of question as Q-22.) **Pinned at:** `scripts/check-inv001.ts` → `MACHINE_ACTOR_PATTERNS`, `machineActorMatches`.

### Q-32 — identity is not ratification
INV-001 has two clauses: "nothing writes to `.program/` except **human-ratified PRs**" and "**machine actors are excluded** from the path". A commit-range check can only decide the second. It cannot see whether a PR was reviewed, approved, or merged by someone other than its author — a human writing straight to `.program/` on the default branch passes the check and still breaches the first clause.

**Shipped:** the check enforces the clause it can decide, and says so. The unenforced half is left to branch protection (require a PR, require an approving review, forbid self-approval), which is repository configuration and not something a seed session can set. **Question:** should the check consume forge metadata — via `src/adapters/github/**`, never `src/core/**` (INV-005) — to assert "this range arrived through an approved PR"? That makes INV-001's enforcement forge-dependent, which cuts against "a bare git repo degrades gracefully to commits-only" (docs/vision.md). Recording the tension rather than resolving it. **Pinned at:** `scripts/check-inv001.ts` (module header, exit-code contract); documented in `CONTRIBUTING.md`.

### Q-33 — what a merge commit "touches"
Under git's default, a merge commit reports **no** changed paths, so a bot merge that resolved a conflict by rewriting `.program/charter.md` would be invisible to a range walk.

**Shipped:** the walk passes `-c`, so a merge reports its **combined** diff — the files that differ from *every* parent, i.e. exactly the content the merge itself introduced. Ordinary merges therefore contribute nothing (correct: their content is already in the range as individual commits), while evil merges are caught. `--no-renames` rides along for the same reason: with rename detection on, moving `.program/charter.md` out of the program store would be reported only under its innocent destination path. **Needs confirming:** that "writes to `.program/`" means "introduces content at that path", which is what the combined diff measures. **Pinned at:** `scripts/check-inv001.ts` → `LOG_FLAGS`.

---

## Enforcing INV-006 (`gwtp validate`)

### Q-34 — INV-006 does not say what "validates" means for the unschema'd files
INV-006 claims *all* program and ledger artifacts validate against `schemas/` in CI, but three of the six files in spec 01 §2 have no schema (Q-08). `gwtp validate` therefore had to decide, without a spec, what counts as a valid `manifest.yaml`, `scope.yaml` or `trajectory.yaml` — and in particular whether an **absent** file or an **unknown key** is a failure.

**Shipped, three calls, all reversible in one place:**
1. **All six files of spec 01 §2 must be present.** A missing one fails with "absent — spec 01
§2 lists this file in the `.program/` layout". The spec enumerates the layout; a program store missing its trajectory is not a valid program store.
2. **`charter.md` is `SKIP`, never `PASS`.** It is prose that humans ratify and judges read for
spirit; reporting it as validated would be a lie in the one place the tool is trusted. It is not counted as a failure either.
3. **An unknown key is an error, not a warning.** `.program/` is human-authored law read by
machines; a typo that silently does nothing is the worst outcome available. The same policy the schema'd decoders already apply (`strictness`) is extended to the unschema'd files, and `scope.yaml` additionally **requires** the `claims` key — `decodeScopeFile` treats it as absent-means-empty, so a misspelling would silently forfeit the obsolescence baseline. **Question for ratification:** should these three become schemas (closing Q-08), so the rule is data rather than code? **Pinned at:** `src/core/validate.ts` → `structuralManifestErrors`, `structuralScopeErrors`, `structuralTrajectoryErrors`; `src/cli/commands/validate.ts` → `PROGRAM_FILES`.

### Q-35 — must a schema-valid artifact that the engine cannot read fail CI?
Q-29 fixed two validators with a deliberate gap between them. It did not say which one INV-006 gates on. A verdict with `evidence: []` (Q-06) or an event whose `rationale` is prose rather than a blob ref (Q-05) satisfies `schemas/` and would land green on the letter of INV-006, then fail at fold time.

**Shipped:** `gwtp validate` **fails** on either, and tags every finding with its origin — `[schema]` for ajv, `[rule]` for the cross-entry and structural law, `[engine]` for the decoder — so a reader can always tell which contract was broken and argue with the right one. Reporting only `[schema]` would let unreadable artifacts through; reporting only `[engine]` would quietly redefine INV-006 as "whatever src/core happens to accept". **Question:** is that the intended reading of INV-006, or should engine-strictness findings be warnings that do not gate the build until the three schema amendments (Q-03, Q-05, Q-06) land? **Pinned at:** `src/cli/commands/validate.ts` → `assembleProblems`, `ProblemOrigin`.

### Q-36 — spec 02 §2's own example event fails `gwtp validate`
The concrete consequence of Q-07, now that a validator exists. The illustrative record carries `t: 2026-07-21T14:03Z`; `schemas/event.schema.json` declares `format: date-time`; ajv-formats requires seconds. So the spec's own example does not satisfy the spec's own schema, and INV-006 would fail on it.

**Shipped:** the validator does **not** soften this — ajv is authoritative, and the failure is reported at `/t` as `must match format "date-time"`. The engine decoder still reads the abbreviated form (Q-07), so the divergence is visible rather than papered over, and `tests/fixtures/invalid-event.yaml` pins it as a deliberate, documented failure. **Resolution needed, one of:** correct the example in spec 02 §2 to `14:03:00Z`, or drop `format: date-time` from the schema. The first is almost certainly right. **Pinned at:** `tests/fixtures/invalid-event.yaml`; `tests/cli/validate.test.ts` (Q-07 case).

### Q-37 — `gwtp validate` checks shape, not integrity
Spec 02 §1 makes an event's filename and idempotency key the hash of its canonical body, and `verifyEventId` exists in `src/core/event.ts` to check exactly that. `gwtp validate` does not call it: a fixture or a hand-written event whose `event:` field does not hash its own body passes today.

**Shipped (least-committal):** validation answers "does this conform to the contract", not "is this ledger untampered". Tamper evidence is a different job with a different failure mode and belongs to `gwtp ledger` (SEED-02), which owns the ref and can check the whole set. **Question:** should `gwtp validate` gain a `--verify-hashes` pass for event files so a malformed backfill is caught before it is pushed? **Pinned at:** absent by design; `src/core/event.ts` → `verifyEventId` is the function it would call.

### Q-38 — self-hosting tests must not pin the constitution's current epoch
Not a spec ambiguity; recorded because it happened, mid-session, and it is the framework demonstrating itself. PR #1 (`bamr87:ratified`, merge `72e66b5`) flipped all six assertions in `.program/invariants.yaml` from `inferred` to `ratified` — the sanctioned write path, exactly as README step 1 instructs. Two tests in `tests/core/program.test.ts` went red on the pull: *"every shipped assertion is still `inferred`"* and *"nothing is enforced yet"*.

Neither test was wrong about the code. Both had encoded a **moment in the program's life** as if it were a contract, so ratifying the constitution — the framework working — broke the build. `gwtp validate` was unaffected: `ratified` is a schema-legal status, and the validator checks conformance, not content.

**Shipped:** both tests now assert the epoch-independent relationship instead — that `isEnforced` and `status: ratified` select the same set (spec 01 §4.2), that no CAND-* is ever in it (spec 04 §4), and that scope routing follows the enforcement gate whatever that gate currently contains. **General rule this suggests, worth writing into the seeds:** a test that reads `.program/` may assert the *shape* of the constitution and the *laws relating* its fields, never the current value of a `status`, a `precision`, or a claim list. Those change by amendment, which is the point of the system. **Second-order note:** now that the program is ratified, INV-001 through INV-006 are **enforced**, not advisory — including INV-003 against `src/judge/**` and `src/evidence/**`, which are still empty skeletons, and INV-006 against `.program/**` and `schemas/**`, which `gwtp validate` now answers for.

### Q-39 — INV-003's `enforcement: hybrid` names no prescreen, so this one defines its own scope
`.program/invariants.yaml` marks INV-003 `enforcement: hybrid`, and `src/core/index.ts` and `src/core/sentencing.ts` had described a "deterministic prescreen" since SEED-01 without one existing. Nothing in the specs says where the deterministic half stops and the model half starts.

**Shipped (least-committal):** `scripts/check-inv003.ts` claims only what is decidable from source text with no false positives — a **value import**, under `src/judge/**` or `src/evidence/**`, of `src/core/{sentencing,accumulator,dispersion}.ts` or of any name on `SENTENCING_VALUES`; plus, repo-wide, naming the `gwtp.sentencing*` global symbol-registry keys outside the module that declares them. `import type` is explicitly allowed: with `verbatimModuleSyntax` it is erased, and naming a type you cannot read is the design. Everything else INV-003 covers — author identity flattened into free text (Q-09), an `as unknown as` cast, a value that arrived from a subprocess — is out of scope for the prescreen and belongs to the LLM half plus `assertBlind`'s runtime walk. **Question for a human:** should the prescreen widen to flag `as unknown as` in the blind directories, or is that the model's job? Widening it there trades precision for recall on a check that gates CI, which is the wrong direction for a deterministic gate. **Pinned at:** `scripts/check-inv003.ts` → `BLIND_DIRS`, `SENTENCING_MODULES`, `SENTENCING_VALUES`, `SENTENCING_SYMBOL_KEYS`; tests in `tests/check-inv003.test.ts`.

### Q-40 — the declassifier boundary was reachable through the `src/core` barrel
Not a spec ambiguity either; recorded because an adversarial audit refuted INV-003 with it and the fix changed a public signature.

`Blind<T>` proves that no `ActorId` and no `Surprise` can enter an evidence bundle. It cannot prove anything about a plain `number` that a declassifier already unwrapped, because by then the value is just a number. `toAccumulatorSnapshot`, `rawSurprise` and `toDispersionSnapshot` each minted their own warrant internally and were re-exported wholesale by `src/core/index.ts`, so `toAccumulatorSnapshot(state).value` handed a judge the meter reading as a `number`, through the barrel, with no deep import for a reviewer or a grep to see.

**Shipped:** three locks rather than one. (1) The four declassifiers — those three plus `computeDispersion` — now take a `SentencingWarrant` from their CALLER, so every declassification is a call with an extra argument. (2) `src/core/index.ts` re-exports `accumulator.ts` and `dispersion.ts` by name and withholds all four, so obtaining one needs a deep import. (3) `scripts/check-inv003.ts` fails CI on that deep import under the blind directories. The accumulation path is unaffected: `surpriseOf`, `shouldFire` and `rearm` never untaint anything, so SEED-02 can build the whole leaky integrator without ever holding a warrant. **Pinned at:** `src/core/index.ts` (the withholding); `src/core/accumulator.ts` and `src/core/dispersion.ts` (the warrant parameters); `tests/core/barrel-surface.test.ts` (the runtime export surface); `tests/core/blindness-compile.test.ts` (the compile-time proof).

---

## The fold and the derived cache (SEED-02)

### Q-41 — `accumulators/<assertion-id>.yaml` has no spelling for a scope-claim key
Spec 02 §1's tree layout writes `accumulators/<assertion-id>.yaml`, which is unambiguous for `INV-007`. But an accumulator key is not always an assertion id: obsolescence sweeps accumulate "into slower accumulators keyed by scope claim" (spec 02 §7, Q-04), and a claim key is any non-empty whitespace-free string. `src/**` contains a `/` and two `*` — one would nest the cache into a directory, the other is not a portable filename character at all.

**Shipped (least-committal):** percent-encode every character outside `[A-Za-z0-9._-]`, plus a leading `.` so no key can name a dotfile or reach outside the directory. `INV-007.yaml` is unchanged, the encoding is total, and `decodeAccumulatorFileName` inverts it exactly, so the cache tree remains enumerable back into keys. **Question for ratification:** should the layout instead be `accumulators/<sha256-of-key>.yaml` (opaque, uniform, unreadable), or should scope claims acquire short ids of their own — which is the unresolved half of Q-04 (`scope.yaml` claims have a `path` and a `since`, and no id)? **Pinned at:** `src/ledger/cache.ts` → `accumulatorFileName`, `decodeAccumulatorFileName`.

### Q-42 — where in the walk does the re-arm test run?
Spec 02 §6 says "re-arm only after the accumulator decays below ~50% of budget". Per event the fold does three things — decay, add, test — and the sentence does not say whether the re-arm comparison reads the value *after decay* or *after the increment*. The difference is not cosmetic: a repository whose meter hovers between the re-arm fraction and the budget re-arms under the first reading and goes permanently silent under the second, because every arriving violation lifts the value back over the threshold before it is measured.

**Shipped:** re-arm is evaluated on the DECAYED value, before the event's increment is added. Decay is the only thing that lowers the meter ("decay is the only forgiveness", spec 02 §4), so "decays below" is read as a property of the decayed value; this is also the ordinary Schmitt trigger, where crossing the lower threshold at any instant re-arms. The stronger reading would convert hysteresis from "nothing flaps" into "a busy assertion fires at most once, ever". **Question:** is a permanently-silenced accumulator ever the intent — e.g. as a form of governance debt (spec 02 §6) — or is that a bug wearing hysteresis's clothes? **Pinned at:** `src/ledger/fold.ts` → `foldKeyEvents` step 2.

### Q-43 — do `aligned` / `abstain` events advance the accumulator's reference instant?
Spec 02 §4 is explicit that neither accumulates and that compliances are counted but subtract nothing. It says nothing about `asOf` — the instant the stored value is decayed *to*. Advancing it on a compliance is arithmetically harmless (the exponential is memoryless, so the value at any common later instant is identical either way), but it is observable: the persisted `as_of`/`value` pair of a cache written straight after a compliance would differ.

**Shipped:** an `aligned` event increments `compliance_count` and touches nothing else — not `value`, not `as_of`, not `last_event_at`. An `abstain` event increments `abstention_count` and touches nothing else. So "appending a compliance never changes the accumulator" is true as stated, byte-for-byte, and is property-tested as such. **Consequence worth stating:** an accumulator's `as_of` is the committer time of its last VIOLATING event, never "now". Reporting a current value is `projectStateTo(state, at, knobs)` with an explicit instant, because a clock read inside the fold would end its purity. **Pinned at:** `src/ledger/fold.ts` → `foldKeyEvents`; `tests/ledger/fold.test.ts`.

### Q-44 — nothing says when a derived accumulator may be believed
ADR-0002 and spec 02 §1.2 say accumulator state is "recomputable at will, cacheable, never authoritative", and `AccumulatorSnapshot` carries `event_count` "for cheap staleness detection". Neither says what staleness detection actually compares, nor what a tool should do when it cannot tell.

**Shipped, conservative by construction:** a cached snapshot is trusted only when ALL of the following agree with a cheap pass over the event set (supersessions resolved, verdicts read, no arithmetic): the key, the `knobsDigest`, the number of violating tips, the committer time of the last violating tip, and an `as_of` not behind that time — plus a finite non-negative value. Anything else, INCLUDING "the facts could not be computed", answers `trusted: false` with reason `indeterminate`. A cache that says "probably fine" is worse than no cache, since the event set is authoritative and re-folding is always available. **Question:** should `event_count` count violating tips (what the fold contributes, and what `AccumulatorSnapshot.event_count` records today) or all events keyed to the accumulator including compliances? The second is cheaper to compute from a directory listing but no longer matches `contributing.length`. **Pinned at:** `src/ledger/cache.ts` → `CacheFacts`, `mayTrustCachedSnapshot`.

### Q-48 — the STORED bytes of an event file are undefined
Q-24 fixed what gets **hashed** (canonical JSON over the body minus `event`). It did not fix what gets **written**, and spec 02 §1 only says the tree holds `events/<sha256>.yaml`. The two are separable — you can hash JSON and store anything — but they cannot be independent: the filename is the hash of the body, so if two writers could render one event to different YAML, one name would address two blobs and the set-union merge would stop being total. The stored form therefore has to be pinned even though nothing hashes it.

**Shipped (least-committal):** the file is the canonical body rendered as block YAML — `event:` first (matching spec 02 §2's own record, and it is the one key the canonical body cannot contain), then every body key in the same ascending-UTF-16-code-unit order `canonicalize` hashes in; strings as JSON string literals (a valid YAML 1.2 double-quoted scalar with identical escapes, so it round-trips without quoting heuristics); numbers in `canonicalize`'s shortest round-trip form with `-0` normalized; `undefined` keys dropped and `null` retained, exactly as the hash does. No comments, no header, no timestamp: anything not derived from the event would be bytes the contract never asked for. **Consequence worth stating:** because `orphaned: false` and an absent `orphaned` are the same fact to `canonicalEventBody`, an event constructed with `orphaned: false` reads back without the key. The id is unaffected; the in-memory object is not byte-identical to itself across a round trip. **Question for ratification:** should the stored form be pinned by a fixture in `tests/` (an event whose exact bytes are asserted), so a future emitter change is a visible diff rather than a silently re-addressed ledger? **Pinned at:** `src/ledger/store.ts` → `serializeEvent`, `emitValue`.

### Q-49 — set-union merge is specified for `events/` and for nothing else
Spec 02 §1.1 says concurrent runs "merge as set union — content-addressed events cannot conflict", which is true of `events/` and true of nothing else in the tree. `accumulators/` is keyed by assertion, not by content, so two diverged refs routinely hold the same key with different numbers; `epochs/` has the same shape. The spec never says what a merge owes them.

**Shipped (least-committal):** `events/` is a strict union and a same-name-different-blob pair is **refused** as tamper evidence, never resolved. Every other tree level is merged name-wise with **ours** kept on collision and the collision reported — legitimate because accumulators are "recomputable at will, cacheable, never authoritative" (ADR-0002, spec 02 §1.2), so the losing snapshot is regenerated by the next fold. The alternative, averaging or recombining two accumulator snapshots, would fabricate a state no fold ever produced. **Question for ratification:** should a merge instead **drop** `accumulators/` outright, so a merged ledger is unambiguously stale rather than half-fresh, and the fold is forced to recompute? That is stricter and arguably more honest; it costs a fold on every convergence. **Pinned at:** `src/ledger/git.ts` → `unionTreeEntries`; `src/ledger/store.ts` → `#unionCommit`.

### Q-50 — "push with fetch → fast-forward → retry" states no bound and no failure mode
Spec 02 §1.1 prescribes the retry but not when to stop, and a governance tool that retries forever is a hung CI job, while one that gives up quietly is a repository that looks like it has no drift.

**Shipped:** both loops are bounded and both fail LOUDLY — `LedgerConcurrencyError`, distinct from a transport error, naming the ref and the attempt count. Defaults are `DEFAULT_MAX_APPEND_ATTEMPTS = 16` for the local compare-and-swap and `DEFAULT_MAX_PUSH_ATTEMPTS = 5` for the remote, both overridable per store. Nothing is lost when the bound is hit: the blobs are already written and content-addressed, the local ref holds everything merged so far, and a later push reconciles. **Question for ratification:** these are operational knobs about how hard the machine tries to record surprise, which puts them in the same class as Q-22's dispersion thresholds — do they belong in `.program/` rather than in code? **Pinned at:** `src/ledger/store.ts` → `DEFAULT_MAX_APPEND_ATTEMPTS`, `DEFAULT_MAX_PUSH_ATTEMPTS`, `LedgerConcurrencyError`.

### Q-51 — "the replay command that reproduces the firing" has no spelling
SEED-02 requires every proposal to ship the command that reproduces its firing, and spec 02 §1 property 3 requires the capability ("retune a `half_life` or `precision` retroactively and recompute"). Neither names a single flag. SEED-02 deliverable 4 fixes only the four verbs:
`gwtp ledger append|fold|replay|status`.

**Shipped:** `gwtp ledger replay --assertion <key> --half-life <src> --budget <n> --rearm <n>`, plus `--precision <n>` **only** when the fold ran with a `precisionOverride` — an absent flag then means "each event's frozen `precision_at` was used" (spec 02 §2) rather than "defaulted". The knob values are the ones actually folded with, and `halfLife.source` is printed verbatim (`90d`, never `7776000000`), so the command is copy-pasteable rather than merely indicative. Built in ONE function so the spelling has a single site to change when the CLI settles. **Question for ratification:** is the accumulator key's flag `--assertion` when spec 02 §7 keys obsolescence sweeps by scope claim (Q-04, Q-41)? `--key` would be honest and uglier. **Pinned at:** `src/adapters/github/render.ts` → `replayCommand`.

### Q-52 — a reprogramming amendment's contents beyond `contested` are unspecified
Spec 02 §5 says a reprogramming proposal is "a PR against `.program/`" and that the assertion goes `contested`; spec 01 §4.2 makes the status change automatic when the PR opens. Nothing says what ELSE the patch contains. A patch that only flips `status` argues nothing — it mutes enforcement and proposes no replacement law — but a machine inventing a counter-statement is a machine legislating, which is the exact posture INV-001 exists to forbid.

**Shipped, the least-committal split:** two edits are made unconditionally because a spec already mandates them — `status: → contested` (spec 01 §4.2) and a `provenance` entry citing the firing event (spec 01 §4 rule 1, "no assertion without provenance", applied to the amendment itself). The counter-statement and the retuned knobs (`precision`, `budget`, `half_life`) are **optional inputs supplied by the caller**, never inferred from the evidence. So the default output is a patch that says "this law is under argument, here is the firing that started it" and nothing more. The whole module is `string -> string` with no filesystem in it, so there is no code path through which `.program/` could be written — INV-002's trick applied to INV-001. **Question for ratification:** should a firing be allowed to propose knob values derived from its own dispersion (e.g. "six hands over five months implies `half_life` is too short"), or is every numeric counter-proposal a human's to author? **Pinned at:** `src/adapters/github/amendment.ts` → `buildAmendment`, `ProposedKnobs`.

### Q-53 — where a forge-less proposal lands, and whether it may be dropped
docs/vision.md non-goals promises "a bare repo degrades gracefully to commits-only". No spec says where a proposal goes when there is no forge, nor what a delivery path owes a proposal it cannot deliver. Silence here is dangerous in one specific direction: a governance tool that quietly fails to file its proposals is indistinguishable from a repository with no drift.

**Shipped:** proposals land as one markdown file per firing under `.gwtp/proposals/` (configurable), containing `doc.body` **verbatim** — byte-identical to what an issue body would carry, delivery marker included, so a repository that later grows a forge can hand the same document to the GitHub port. The directory is `.gwtp/`, never `.program/`: proposals are observations ABOUT the law, not the law (spec 01 §1's two stores), and writing them into the program store would breach INV-001 (`budget: 1.0`) on the first run. Idempotency needs no index: the delivery key contains the assertion and the 64-hex firing event, so the filename is derived from the key and `exists()` plus a marker read-back answers "already filed?" — the read-back is required because sanitising a key into a filename is lossy (`parseAccumulatorKey` admits any whitespace-free string, Q-04), and a collision must refuse rather than report `existing`. Nothing is ever dropped silently — an unresolvable GitHub transport returns an `unconfigured` failure naming this path, rather than a no-op port. **Question for ratification:** should `.gwtp/proposals/` be committed (evidence travels with the clone, at the cost of churn) or gitignored (clean tree, evidence local to whoever folded)? **Pinned at:** `src/adapters/github/bare.ts` → `DEFAULT_BARE_DELIVERY_DIR`, `bareDelivery`.

---

## The firing detector and dispersion (SEED-02 deliverable 3)

Raised while implementing `src/ledger/sighted.ts` and `src/ledger/firing.ts`. Every one of them is a place where spec 02 §5-§6 states a rule in prose and the engine had to pick a number, a field or a function to make it run.

### Q-45 — dispersion demands one actor per event; two kinds of event have none
`EvidenceLocus` (spec 02 §5, Q-17) carries exactly one actor, because author entropy counts "how many independent hands". Two legal subjects cannot supply one:
1. **`subject.pr` with no `subject.commit`.** A pull request has many authors and the schema's
`anyOf` permits a PR-only subject. Choosing which of them the event belongs to would be inventing a rule no spec states, and resolving a PR to its commits at all needs a forge port that INV-005 keeps out of `src/ledger`.
2. **`subject.path` with no commit** — a `stale-claim` from the obsolescence sweep, which "accumulates from *silence*" (spec 02 §7). Nobody's hand made it, by construction.

**Shipped (least-committal):** both are reported **unresolved**, and `requireLoci` turns an unresolved locus into a loud `unresolved-locus` failure rather than a firing computed over the subset that happened to resolve. The direction of the bias is the reason: dropped evidence always looks *less* dispersed than the evidence that produced it, and less dispersed is `refactor`, which is the outcome that leaves the law untouched. A classifier whose failure mode is "never propose amending the constitution" is not a neutral default. An explicit opt-in, `silencePolicy: 'attribute-to-silence'`, lets obsolescence accumulators fire at all, at the cost of one synthetic hand stamped `gwtp:silence` — deliberately not a plausible email, so a reader of a proposal can see at a glance that no human was attributed. **Questions for ratification:** (a) should the event schema carry a `paths` list so dispersion is computable from the ledger alone (the sharper form of Q-17), (b) should a PR-only subject be resolved through a forge adapter, and (c) does an obsolescence firing want a synthetic actor, a one-actor exemption in the classifier, or a dispersion rule of its own? **Pinned at:** `src/ledger/sighted.ts` → `resolveEvidenceLoci`, `UnresolvedReason`, `SILENCE_ACTOR_HANDLE`, `requireLoci`.

### Q-46 — a firing is an event, but no `verdict` value means "the meter crossed its budget"
`schemas/event.schema.json` says `dispersion_snapshot` is "present only on firing events", so a firing IS a ledger event and spec 02 §6 confirms it ("outcomes are events too"). But `verdict` is
an enum of five **judge rulings** — `aligned | drift | regression | stale-claim | abstain` — and a
threshold crossing is none of them. The field is `required`, so the record cannot omit it.

**Shipped:** `abstain`. Of the five it is the only one that cannot perturb what the fold computes: the three violations accumulate surprise, `aligned` inflates the compliance ratio that the *next* proposal ships as evidence quality, and `abstain` does neither (spec 02 §4: "abstain never accumulates"). Recording an outcome must not change the observations it summarises, so the inert value wins; `tests/ledger/firing.test.ts` folds a firing event back into its own stream and asserts the meter is unchanged. `isFiringEvent` discriminates on `dispersion_snapshot`, which nothing else carries, rather than on the overloaded verdict. **Consequence worth stating:** `abstention_count` now counts two different things — a judge that declined to rule, and the engine recording its own spike. **Alternative for ratification:** add a sixth enum value (`fired`) to `schemas/event.schema.json#/properties/verdict`, which would make the overload go away entirely. **Pinned at:** `src/ledger/firing.ts` → `FIRING_EVENT_VERDICT`, `isFiringEvent`.

### Q-47 — precision "rises" with no function given
Spec 02 §6: "Proposal rejected → new precedent (`ruling: affirmed`), and the assertion's `precision` *rises* — a law ratified under fire is a stronger prior." No function is stated, and `schemas/assertion.schema.json` bounds precision to `(0, 1]` (Q-26), so the obvious candidates all walk off the top: `p + 0.1` and `p × 1.2` both need clamping, and once clamped, repeated affirmations stop being distinguishable — the knob saturates and the law's strength stops recording its own history.

**Shipped — halve the distance to the ceiling:** `p' = p + (1 - p) / 2`, rounded to six decimals so `.program/` stays human-readable. It is the Bayesian reading of the sentence (each affirmation under fire halves the probability that the assertion is wrong), it is strictly increasing, it never exceeds 1 and never reaches it, and it is hand-checkable: 0.7 → 0.85 → 0.925 → 0.9625. At exactly 1.0 it **refuses** rather than clamping into a silent no-op, and the affirmed precedent is still produced — the law was still upheld. **Question for ratification:** is halving the remaining doubt the intended reading, and should the schema maximum be lifted so an often-affirmed law has somewhere to go (Q-26)? **Pinned at:** `src/ledger/firing.ts` → `PRECISION_RAISE_RULE`, `raisePrecision`.

### Q-54 — "accumulator zeroes" does not say what, exactly, zeroes
Spec 02 §6: "Proposal accepted → amendment PR lands in `.program/`, assertion → `amended`, accumulator zeroes." An `AccumulatorState` holds a meter (`value`, the residual weight of every contributing event, the arm state) **and** a census (violation, compliance and abstention counts, `as_of`, `last_event_at`). "Zeroes" could mean either.

**Shipped:** the METER zeroes and the CENSUS does not. `value` goes to zero, `contributing` is emptied, and the unit **re-arms explicitly** — waiting for hysteresis would leave the assertion permanently silent, because there is nothing left to decay below 50% of. The counters survive: they are the historical record the next proposal ships as evidence quality, and erasing them would restate the compliance ratio as if the repository had no past. `knobs` is preserved so the cache still describes the fold that produced it. Exposed as a pure `AccumulatorState -> AccumulatorState` rather than performed in place: the amendment itself is a `.program/` write a machine may not make (INV-001), but the derived cache is the engine's own (ADR-0002: "recomputable at will, cacheable, never authoritative"). **Question:** is a zeroed accumulator meant to re-arm at once, or is a post-amendment quiet period part of the intent? **Pinned at:** `src/ledger/firing.ts` → `zeroAccumulator`.

### Q-55 — governance debt has a name, a definition in the GLOSSARY, and no unit
Spec 02 §6: "Proposal ignored until stale → recorded; staleness accumulates on its own meter: **governance debt**." The GLOSSARY says "accumulated staleness of ignored proposals". Neither gives a unit, a decay rule, a weighting or a threshold — and the surrounding text is all about a meter that has all four, so the temptation to build a second accumulator is strong and wrong.

**Shipped, deliberately dumb:** `proposalDays = Σ (asOf − firedAt)` in days over open proposals. One unit — **proposal-days** — so ten proposals ignored for a day and one ignored for ten days both read 10. Three properties it explicitly does NOT share with the surprise accumulator: it **does not decay** (surprise is forgiven by time; an unanswered proposal is not — six months of silence is the debt, not its repayment); it is **not weighted** by severity, budget or kind (weighting a `reprogram` above a `refactor` would be a judgement about what a constitutional question is worth, which is exactly the kind of number spec 02 declines to state — `byKind` reports the split and lets a human weigh it); and it has **no budget and fires nothing** (spec 02 §6 says staleness "accumulates on its own meter" and stops there; giving it a threshold would be inventing a second firing rule). A proposal dated after the observation instant contributes 0 rather than a negative debt, the same clamp `decayFactor` applies for the same reason (Q-11). **Questions for ratification:** what makes a proposal "stale" rather than merely open, who decides a proposal has been *answered*, and does governance debt ever become an input to anything — or is it only ever a number a human looks at? **Pinned at:** `src/ledger/firing.ts` → `GovernanceDebt`, `governanceDebt`, `renderGovernanceDebt`.

### Q-56 — an accumulator key that is not an assertion has no budget and no half-life
Spec 02 §4 folds `A ← A·2^(−Δt/half_life) + precision_at·severity` and fires at `A ≥ budget`. Both knobs are fields of an **assertion** (`schemas/assertion.schema.json`). But spec 02 §7 accumulates obsolescence "into slower accumulators **keyed by scope claim**", and a `scope.yaml` claim carries `path` and `since` and nothing else — no budget, no half-life, no precision. The same gap opens for any event naming an assertion that has since left `.program/`. Nothing says what such an accumulator's threshold is, and "slower" is the only hint the spec gives.

**Shipped:** the fold takes knobs **per key** (`foldEventsPerKey`) through a resolver that may answer `null`, and a key with no knobs is **reported, never folded**. It is not silently skipped and not folded against a borrowed number: `gwtp ledger fold` prints it under "not folded", and the count appears in `--json` as `unfolded`. Inventing a budget here would be inventing the threshold at which this framework proposes amending its own constitution, from an engineering default nobody ratified — and a *wrong* default is worse than no answer in both directions (too low files proposals nobody asked for; too high makes obsolescence silently unfireable, which is exactly the failure mode spec 02 §7 exists to prevent). **The explicit opt-in:** `gwtp ledger replay --half-life <d> --budget <n>` supplies knobs for **every** key including the keyless ones, so a counterfactual can ask "what would fire if scope claims decayed at 90 days against a budget of 1?" without anything being written or ratified. **Questions for ratification:** do scope claims get their own knobs in `scope.yaml`, does `manifest.yaml` grow a default pair, or is "slower" meant to name a fixed multiple of the assertion's own half-life? **Pinned at:** `src/ledger/fold.ts` → `FoldKnobsFor`, `foldEventsPerKey`; `src/cli/commands/ledger.ts` → `knobsResolver`.

### Q-57 — a firing is recorded; the proposal's DIRECTION is not
Spec 02 §5 routes a firing two ways — refactoring recommendation or reprogramming proposal — and spec 02 §6 says an ignored proposal accrues governance debt. But the event a firing writes carries a `dispersion_snapshot` (four numbers: author entropy, path entropy, time spread, compliance ratio) and **no proposal kind**, and `classifyFiring` cannot be re-run against that snapshot because it needs the *distinct author count*, which the snapshot does not keep. So a reader reconstructing the backlog from `refs/program/ledger` alone knows a proposal was filed and cannot tell whether it argued with the code or with the law.

**Shipped:** `IgnoredProposal.kind` admits `'unrecorded'` alongside the two `ProposalKind`s, and `GovernanceDebt.byKind` gains that third bucket. `gwtp ledger status` uses it: the total proposal-days and the oldest age are exact, and the split says `unrecorded` rather than guessing. The alternative — defaulting to `refactor` — would silently understate the constitutional half of the debt, which is the half that matters; the other alternative, re-deriving authorship to re-classify, is precisely what ADR-0003 permits only *at firing time*, and printing a status table is not firing time. **Alternative for ratification:** record the kind in the firing event. That means either a fifth field on `dispersion_snapshot` or a new top-level event key, both of which are schema changes with a content-hash consequence (Q-13, Q-24), so it is not a change an implementation session may make. **Pinned at:** `src/ledger/firing.ts` → `ProposalDirection`, `IgnoredProposal`, `GovernanceDebt`; `src/cli/commands/ledger.ts` → `runStatus`.

## Found while building the ROADMAP v0 exit test

### Q-58 — which import FORM sits on which severity rung
INV-005 is `enforcement: deterministic`, so an import-boundary check has to produce an anchored ordinal for every breach it finds. ADR-0005 fixes the four anchors and their numeric mapping
(`grazes | bends | breach | entrenches` → 0.25/0.5/0.75/1.0) and spec 03 §4 requires one on every
violation — but **nothing anywhere says how a forge import maps onto them**. A type-only import, a `await import()`, a static value import and a re-export are four materially different acts, and the choice is not cosmetic: severity multiplies precision in the fold, so this ladder decides how many breaches it takes to fire.

**Shipped:** `type-only` → **grazes** (erased by `verbatimModuleSyntax`; no runtime dependency, only the vocabulary has crossed); `dynamic` → **bends** (a real runtime dependency, but conditional, and a legitimate shape for a degradation path that guards it); static `value` import → **breach** (the module is now unconditionally required to load engine core); `export … from` → **entrenches** (core's public surface now *hands out* the forge API, so every consumer of the barrel inherits the dependency and removing it becomes a breaking change to core's contract). A verdict takes the **worst** rung among the offences in one diff, since a file's severity is the worst thing it does. The ladder is a single exported constant precisely so it is arguable — and so a reprogramming proposal has something concrete to argue with rather than a number buried in a branch. **Stated recall gap:** the check reads import specifiers only. Core that shells out to `gh` through `node:child_process`, or hard-codes `https://api.github.com` and reaches it with `fetch`, imports nothing and is invisible to it. That is the deterministic rung being deterministic. **Questions for ratification:** is this the intended ordering (in particular, is a re-export really worse than a plain value import?), and should INV-005 move to `enforcement: hybrid` so an LLM magistrate can rule on the cases a specifier list cannot see? **Pinned at:** `src/judge/deterministic/imports.ts` → `IMPORT_FORM_SEVERITY`, `FORGE_MODULE_PATTERNS`, `findForgeImports`.

### Q-59 — what a deterministic judge returns when nothing is in scope
Spec 03 §3 hands a judge "the diff hunks intersecting the assertion's scope". It does not say what the judge returns when that intersection is **empty** — a commit that touched only `docs/`, judged against an assertion scoped to `src/core/**`. The three candidates are not equivalent in the ledger: `aligned` is *counted* and ships in the next proposal as the compliance ratio, i.e. as evidence quality (spec 02 §4); `abstain` "never accumulates, it escalates" (spec 03 §4); emitting nothing at all leaves no record that the assertion was considered.

**Shipped (least-committal): `abstain`, with a rationale saying so.** An `aligned` would be a compliance earned by having looked at nothing, and compliance ratios are published as an argument about how good the evidence is — inflating them with commits the assertion never governed would quietly weaken every future proposal against that assertion. The same answer is given when the assertion's `class` is one this procedure cannot rule on: out of jurisdiction is insufficiency, not innocence. `abstain` is inert in the fold, so the cost of being wrong here is one row in a census rather than a distorted meter. **Consequence worth stating:** this is the third thing `abstention_count` now counts, alongside Q-46's firing events and a judge that genuinely could not decide. **Questions for ratification:** should an empty scope intersection produce no event at all (and if so, how is "the assertion was evaluated and found irrelevant" audited?), and should `abstain` carry a machine-readable reason so the escalation path can tell "insufficient evidence" from "not my jurisdiction"? **Pinned at:** `src/judge/deterministic/imports.ts` → `judgeImportBoundary`, `JUDGED_CLASS`.

### Q-60 — "blind" by VALUE, or blind by REACHABILITY?
INV-003 states "no code path passes author identity or accumulator state to any judge", and ADR-0003 makes the evidence assembler "structurally" incapable of it. Two readings have been enforced side by side since SEED-01 and they are not the same rule:

- **by value** — a blind module may not hold or unwrap a sentencing value. This is what `Blind<T>`, the `SentencingWarrant` parameters and `scripts/check-inv003.ts` enforce.
- **by reachability** — a blind module's runtime import closure may not *contain*
`src/core/{sentencing,accumulator,dispersion}.ts` at all. This is what `tests/ledger/blindness-boundary.test.ts` enforces ("holds TRANSITIVELY").

The second is strictly stronger, and it has a consequence nobody has ratified: `src/core/index.ts` value-re-exports `accumulatorStep`/`decayFactor` and `shannonEntropy`, so **a blind file cannot value-import the core barrel at all**; and `src/core/evidence.ts` reaches `core/sentencing.ts` through `core/blindness.ts`, which value-imports `SENTENCING_TAG` for `assertBlind`'s runtime walk — so **a blind file cannot value-import `sealEvidence` either**. Today that is invisible, because `src/judge/index.ts` and `src/evidence/index.ts` are type-only re-export skeletons. It stops being invisible at SEED-03, when the assembler in `src/evidence/**` has to *call* `sealEvidence`, which is the one function whose entire job is enforcing INV-003.

**Shipped (for now, and only for this file):** `src/judge/deterministic/imports.ts` deep-imports the individual blind core modules instead of the barrel, and imports `SealedEvidence` and `Judge` as **erased types**. Its closure is provably clean under both readings, so nothing has to be decided today. Nothing in `src/core/**` was changed to make this work. **Questions for ratification:** (a) is reaching a *detector* symbol the same offence as reading an identity — the substance of INV-003 is the value, and `SENTENCING_TAG` exists to catch leaks, not to cause them; (b) if reachability is the intended rule, `sealEvidence` needs its runtime backstop moved behind a module that does not transitively name the tag, or the assembler needs an exemption; (c) if the value rule is the intended one, the transitive assertion should be narrowed to the *declassifiers* rather than to whole modules. **Pinned at:** `src/judge/deterministic/imports.ts` (module header); `tests/ledger/blindness-boundary.test.ts` → "holds TRANSITIVELY"; `scripts/check-inv003.ts` → `SENTENCING_MODULES`, `SENTENCING_VALUES`.

### Q-61 — distillation's `precision_seed` names three inputs and no function
Spec 04 §5: "Evidence strength seeds `precision`… Inputs to the seed: violation-free span, number of independent corroborations, cross-epoch persistence." The three inputs are named; the FUNCTION that combines them into a `(0, 1]` prior is not. (This is the seeding twin of Q-47, which fixes how precision *rises* under affirmation; this fixes where a distilled prior *starts*.) The obvious candidates misbehave: a plain weighted sum walks off the top and needs clamping; an unbounded product lets a single strong signal manufacture near-certainty from a machine inference the spec itself calls "noisy by construction" (§4).

**Shipped — saturating weighted evidence, confined to `[0.5, 0.95]`:**
```
spanScore    = clamp01(violationFreeSpanDays / 365)          # a violation-free year saturates
corrScore    = clamp01(corroborations / 5)                   # five independent corroborations saturate
persistScore = epochsObserved > 0 ? clamp01(epochsPersisted / epochsObserved) : 0
weighted     = 0.4·spanScore + 0.3·corrScore + 0.3·persistScore     # ∈ [0, 1]
precision_seed = round6(0.5 + (0.95 − 0.5)·weighted)                # ∈ [0.5, 0.95] ⊂ (0, 1]
```
Strictly non-decreasing in each input, saturating (unbounded evidence can never reach certainty — a human raises it at ratification, §5), always inside the schema's `(0, 1]` bound so a seed is never rejected for range, and hand-checkable (six decimals, matching Q-47). It reproduces the spec's own fixture: CAND-014's multi-year span, ~3 corroborations and persistence across 4 of 6 epochs give `weighted ≈ 0.78 → seed ≈ 0.851 ≈` the hand-written `precision_seed: 0.85`. **Questions for ratification:** are 0.4/0.3/0.3 the right relative weights (should an exhaustive negative-space span dominate corroboration count more?), and are the 365-day / 5-corroboration saturation points and the 0.5 floor / 0.95 ceiling the intended calibration? **Pinned at:** `src/distill/precision.ts` → `seedPrecision`, `SEED_FLOOR`, `SEED_CEILING`, `WEIGHT_SPAN`, `WEIGHT_CORROBORATION`, `WEIGHT_PERSISTENCE`, `SPAN_SATURATION_DAYS`, `CORROBORATION_SATURATION`.

## Found while building the SEED-04 fact miner (pass one)

Raised while implementing `src/distill/miner.ts` / `src/distill/factbase.ts`. Each fixes bytes in the on-disk fact base (spec 04 §2 requires it "replayable"), so each is pinned rather than left to a call site to decide.

### Q-62 — spec 04 §2 says "dependency manifest diffs" and names no grammar
The pass-one fact base must produce a "dependency manifest diff over time", but the spec names no ecosystem and no parser. `package.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, `Gemfile` and `pom.xml` are six different grammars, and a `DependencyDelta`'s `name`/`kind`/`from`/`to` shape is only recoverable for one of them without a per-ecosystem parser this session has no mandate to invent (and which would be a dependency INV-005 keeps out of the miner anyway — all six parsers are third-party).

**Shipped (least-committal): only `npm` is parsed STRUCTURALLY** — `package.json`'s four dependency maps become typed deltas with `kind ∈ {runtime, dev, peer, optional}` and real `added`/`removed`/`version-changed` classification. Every other ecosystem is routed through a `generic` line-set differ: a trimmed, comment-stripped line that appears on one side and not the other becomes a delta with `kind: unknown` and `change ∈ {added, removed}` (a version bump reads as one `removed` + one `added`, since a line differ cannot pair them). The `ManifestMatcher` still records the true `ecosystem`, so a later per-grammar parser is a drop-in that changes bytes visibly. A manifest with no net line change emits NO event, so a whitespace-only touch does not manufacture a spurious change-point for the segmenter. **Question for ratification:** should the non-npm ecosystems get real parsers (TOML/mod/gemspec/xml), and if so does that pull those parsers into the engine — or should manifest mining stay a line-set diff for everything but npm and let pass two read the raw blob when it needs structure? **Pinned at:** `src/distill/miner.ts` → `manifestDeltas`, `npmDeltas`, `genericDeltas`; `src/distill/factbase.ts` → `Ecosystem`, `DEFAULT_FACT_BASE_CONFIG.manifestFiles`.

### Q-63 — the co-change graph has no bound on per-commit fan-out
Spec 04 §2 asks for a "file co-change graph" and says nothing about a mega-commit. A single commit that touches N files contributes N·(N−1)/2 undirected edges; a 5 000-file vendoring commit or an auto-formatting sweep would alone emit ~12.5M edges and dominate the whole graph with co-changes that carry no design signal — and it does so QUADRATICALLY, which is also where the exhaustive walk's time goes.

**Shipped:** a commit above `COCHANGE_MAX_FILES` (200) still counts each file's INDIVIDUAL change total (so `aChanges`/`bChanges` and therefore `confidence` stay correct for pairs formed elsewhere) but contributes NO pairs of its own. A reviewable single constant, in the same spirit as `imports.ts` `FORGE_MODULE_PATTERNS` and `check-inv001` `MACHINE_ACTOR_PATTERNS`: widening what the miner treats as "too big to be a design signal" is an edit to one number a reviewer can see. **Question for ratification:** is 200 the right cutoff, should it be a `FactBaseConfig` knob rather than a constant, and should an over-cap commit be recorded somewhere (a "bulk-change" fact) rather than silently contributing no edges — its very size is arguably a change-point signal (spec 04 §1)? **Pinned at:** `src/distill/miner.ts` → `COCHANGE_MAX_FILES`, `buildCoChange`.

### Q-64 — does a `type-only` import break a negative-space boundary proof?
Spec 04 §2's marquee is "no third-party import *ever* crossing into `core/`", proven exhaustively as an absence. But `import type { X } from 'pkg'` is ERASED by `verbatimModuleSyntax` (the same fact Q-58 leans on to rank a type-only forge import as the softest `grazes` rung): at runtime nothing crossed, yet the *vocabulary* did. Whether a type-only external import refutes the boundary decides whether a proof reads `held: true` or `held: false` — a byte in the fact base and, downstream, a precision seed (spec 04 §5).

**Shipped (least-committal): a `type-only` external import does NOT refute the boundary.** The negative-space prover counts only `value`/`dynamic`/`re-export` external (or forge) imports as breaches, consistent with Q-58's reading that a type-only import carries no runtime dependency. So the strongest-provable statute is "no *runtime* third-party dependency ever crossed", which is the one a deterministic pass can defend without arguing about erased syntax. The `ImportGraphSnapshot` still RECORDS every type-only edge (with `kind: 'type-only'`, `external: true`), so a stricter reading is recoverable from the fact base without a re-walk. **Question for ratification:** is the boundary about runtime dependency (type-only grazes, does not break) or about vocabulary coupling (type-only breaks)? If the latter, the prover's `imp.kind !== 'type-only'` guard is the one line to drop, and Q-58's severity ladder should be revisited in the same breath. **Pinned at:** `src/distill/miner.ts` → `proveNegativeSpaceForProbe` (the `type-only` guard).

---

## The nexus (spec 05, ADR-0007)

Raised while integrating the code knowledge graph. Spec 05 was written in the same change, so these are places where THAT spec chose the least-committal reading of the specs it plugs into — recorded here so a human can ratify or reverse each one at a single pinned site.

### Q-65 — is the nexus artifact inside INV-006's jurisdiction?
INV-006 says "all program and ledger artifacts validate against `schemas/` in CI". The nexus artifact is NEITHER: it is a derived, gitignored cache (spec 05 §1), yet it now has a real schema (`schemas/nexus.schema.json`) — the fifth — while `SCHEMA_ID` in `src/core/index.ts` still lists exactly four, on Q-08's argument that inventing `$id`s manufactures contracts.

**Shipped (least-committal):** the schema exists and is enforced where the artifact lives — `tests/nexus/serialize.test.ts` holds ajv and the engine decoder against each other (the Q-29 split), and `gwtp nexus status` hash-verifies the cache — but `gwtp validate` and `SCHEMA_ID` are untouched: INV-006's letter covers program and ledger artifacts, and a cache is neither. **Question for ratification:** should INV-006's statement widen to "all machine artifacts", pulling the nexus under `gwtp validate` and `SCHEMA_ID`? That is an amendment to the law plus an engine change, in that order. **Pinned at:** `src/nexus/serialize.ts` → `NEXUS_SCHEMA_ID`; `src/core/index.ts` → `SCHEMA_ID` (deliberately still four).

### Q-66 — does the context ring escape the assertion's scope?
Spec 03 §3 grants "the diff hunks intersecting the assertion's scope, with an expanding context ring". For rings `enclosing-symbol` and `file` the granted context shares the hunk's path, which already intersected scope. Ring `callers` is the interesting one: a nearest caller can live OUTSIDE the assertion's scope (e.g. a caller in `src/ledger/` of a function in `src/core/` under INV-005's `src/core/**`), and the spec does not say whether the grant overrides the scope filter.

**Shipped (least-committal): it does not.** The ring source scope-filters what it offers and the assembler re-applies `scopedHunks` (belt and braces), so an out-of-scope caller is never shown — a judge granted out-of-scope code would be ruling on conduct outside its jurisdiction. Consequence: for a narrowly-scoped assertion, `callers` may add nothing beyond `file`. **Question for ratification:** should `callers` context be exempt from the scope filter (shown, but never citable as an offence)? That needs a spec 03 §3 ruling, since it widens what a judge sees past the assertion's own jurisdiction. **Pinned at:** `src/nexus/rings.ts` → `nexusChangeSource` (the `scopedHunks` call); `tests/nexus/rings.test.ts` ("rule 2").

### Q-67 — which tree does ring context come from?
Granted context is read from the snapshot the graph was built over (spec 05 §5 rule 3), and `gwtp judge --ring` / `gwtp nexus ring` perceive the CURRENT WORKTREE. A diff judged against a worktree that has since moved gets context from the wrong tree — deterministically wrong, but wrong. Nothing in spec 03 says how the harness must pin the post-image tree for escalation, and the SEED-03 harness (`escalateEvidence`) takes whatever `ChangeSource` it was handed.

**Shipped:** the CLI states the assumption in its help text and judges the worktree as given; the pure pipeline (`buildNexus` over an explicit snapshot) already supports tree-accurate assembly — the caller chooses the snapshot. **Question:** when SEED-03's escalation loop runs against a historical commit (or SEED-04's backfill replays one), must the nexus be built from that commit's tree via `git show`? Almost certainly yes; the plumbing to feed the builder a commit tree instead of a worktree is the missing piece, and it belongs beside the other git reads (`src/ledger/git.ts`-adjacent, never under a blind directory). **Pinned at:** `src/cli/commands/judge.ts` (the `--ring` help text); `src/nexus/build.ts` → `FileSnapshot` (the seam where a commit tree would enter).

### Q-68 — seam naming in proposals: where does the join happen?
Spec 05 §6 defines seams and forbids them from the fold; spec 02 §5's outputs argue "one seam or many call sites" and a refactoring recommendation would be sharper if it NAMED the import-connected seam instead of a directory glob. That join (firing evidence paths → `seamOf`) belongs on the sentencing side — `src/ledger/firing.ts` resolves the paths and `src/adapters/github/render.ts` renders the proposal — and neither may be touched casually: the fold's purity property and the proposal's byte-stable body both live there.

**Shipped:** the query surface only (`seams`, `seamOf`, `gwtp nexus seams`); no firing-side wiring. A human consulting `gwtp nexus seams` next to a proposal gets the answer today. **Question for ratification:** may a proposal's evidence block carry a `seams:` section (seam id + member count per contributing path), the way it already carries the compliance ratio as evidence quality? If yes, it enters through `render.ts` at firing time — sighted territory — and MUST NOT feed `classifyFiring` (Q-22's thresholds stay the ratified inputs). **Pinned at:** `src/nexus/query.ts` → `seams`, `seamOf`; deliberately absent from `src/ledger/**` and `src/adapters/**`.

### Q-69 — should assertions gain a `check: nexus-query` field (rung-0 queries as law)?
Spec 05 §7 shows INV-005's negative space as a whole-tree query, and `tests/nexus/negative-space.test.ts` runs it — but as a TEST of this repository, not as a rung-0 check any repository's assertion can declare. Making it declarable means a new field on `schemas/assertion.schema.json` (which queries are law-grade? what grammar? what severity does a whole-tree absence-violation carry, when ADR-0005's anchors were written for diffs?), which is a schema-semantics change with governance weight.

**Shipped:** nothing on the assertion atom; the capability exists as library + CLI + test. **Question for ratification:** the field, its grammar (the `importsMatching` shape? full queries?), and its trigger tier (spec 02 §7 — every push, or the scheduled sweep alongside obsolescence, which whole-tree checks resemble more than diff checks do). **Pinned at:** `src/nexus/query.ts` → `importsMatching` (the primitive a future field would compile to); `schemas/assertion.schema.json` (deliberately unchanged).

### Q-70 — two readers of one concept: the miner's import graphs and the nexus
Spec 04 §2's pass one builds `ImportGraphSnapshot`s at epoch boundaries (`src/distill/miner.ts` → `buildImportGraphForBoundary`); the nexus builds the same concept — richer (definitions, calls, heritage) — at any single tree. Two import readers with different shapes will drift the way the module headers of `imports.ts` and `check-inv003.ts` warn a third reader would.

**Shipped:** both stand; neither was refactored (SEED-04's miner is merged, working code, and spec 05 §8 explicitly declines to rewrite it under a new spec). The extractors are already vocabulary-aligned (`type-only` / `value` / `dynamic` / `re-export`, Q-64's kinds). **Question:** should pass one's boundary snapshot become `buildNexus(treeAt(boundary))` — one reader, with the fact base keeping only its aggregation? That is a SEED-04-territory refactor and wants its own change, judged by the framework it feeds. **Pinned at:** `src/distill/miner.ts` → `ImportGraphSnapshot`; `src/nexus/build.ts` → `buildNexus`; docs/spec/05-nexus.md §8.

---

## Repository upkeep (spec 06, ADR-0008)

Raised while building `gwtp upkeep`. Spec 06 was written in the same change; these are the places it chose the least-committal reading of existing law.

### Q-71 — are upkeep's config and plan inside INV-006's jurisdiction?
INV-006 covers "program and ledger artifacts". `.github/upkeep.yaml` and the upkeep plan are neither, yet both now have real schemas (`schemas/upkeep-config.schema.json`, `schemas/upkeep-plan.schema.json`). The same question Q-65 asked of the nexus.

**Shipped (least-committal):** the schemas are enforced where the artifacts live: `gwtp upkeep` validates the config before use and every plan before writing or reading it, and `tests/upkeep/cli.test.ts` holds the committed config and generated plans against ajv. `gwtp validate` and `SCHEMA_ID` are untouched. **Question for ratification:** answer Q-65 and Q-71 together. If INV-006 widens to "all machine artifacts", both join `gwtp validate`. **Pinned at:** `src/cli/commands/upkeep.ts` → `loadUpkeepSchemas`; `src/core/index.ts` → `SCHEMA_ID`.

### Q-72 — should `src/upkeep/**` join INV-005's scope?
INV-005 binds only `src/core/**`. `src/upkeep` keeps the posture voluntarily: it declares a `RepoHostPort` and imports no forge code; `src/adapters/github/repo-host.ts` implements it. It does import `src/ledger/git.ts` (git CLI, not a forge) and `src/core/paths.ts`.

**Shipped:** voluntary compliance, no deterministic check. **Question for ratification:** widen INV-005's scope to `["src/core/**", "src/upkeep/**"]` so the deterministic import check enforces it? That is an amendment to `.program/invariants.yaml`.

### Q-73 — is the `tend` agent a "machine actor" under INV-001?
INV-001 excludes machine actors from `.program/`. The `tend` job's agent commits on an `upkeep/*` branch and opens a draft PR. It is told never to touch `.program/`, and `ci.yml`'s INV-001 job would fail it if it did. But its PRs about *other* files are machine-authored changes that a human merges.

**Shipped:** `tend` is opt-in (dispatch input, or `vars.UPKEEP_TEND`), drafts only, one at a time, never touches `.program/`. **Question:** is "machine-authored, human-merged" acceptable for docs/version drift, and should `tend` PRs carry a label the ledger can recognise as upkeep rather than development?

### Q-74 — where should a backfilled tag point?
A version present in `package.json` but never tagged could be tagged at HEAD (what the tree is now) or at the commit where that version was introduced (what the version shipped).

**Shipped:** introduction commit (the oldest commit of the contiguous run, back from HEAD, in which the source file held this value). Later commits are reported as unreleased with a suggested bump. A shallow clone breaks the walk; the workflow checks out with `fetch-depth: 0`. **Pinned at:** `src/upkeep/facts.ts` → `versionIntroducedAt`.
