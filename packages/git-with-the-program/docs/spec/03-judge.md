# Spec 03 — The Judge

Status: Designed · Machine schema: [`schemas/verdict.schema.json`](../../schemas/verdict.schema.json) · Prompts: [`prompts/`](../../prompts/)

## 1. A bench of narrow magistrates

Not one omniscient reviewer. **One assertion, one diff, one invocation.** This keeps verdicts crisp, independently cacheable, and routable up a cost ladder:

```
compiled deterministic checks        (every push, zero variance, zero cost)
  → hybrid prescreen                 (deterministic gate on the LLM call)
    → single LLM judge               (the ambiguous middle)
      → panel of N                   (high-precision assertions)
        → human                      (court of last resort)
```

Each rung's ruling **supersedes** the previous as a ledger event. Cache key: `assertion-id + hunk-hash + judge-hash` — which lines up exactly with the event store's idempotency and dedupes across force-pushes.

## 2. Two blindness rules (load-bearing)

1. **The judge never sees the author.** Verdicts attach to conduct; the demography of *whose hands, which seams* is the ledger's job at firing time (spec 02 §5). Verdict and sentencing are separate branches.
2. **The judge never sees the accumulator.** The ledger is an evidence-accumulation model, and accumulation assumes conditionally independent samples. A judge that can see the meter at 2.7 of 3.0 will find the breach — confirmation leaks in, verdicts autocorrelate, and accumulated surprise stops being evidence.

Enforced structurally: the evidence assembler simply cannot read authorship fields or `accumulators/`.

## 3. Evidence assembly (what the judge does see)

- The **assertion** — statement, class, scope.
- Its **charter provenance** — the *why*, so the judge can rule on spirit, not just letter.
- The **diff hunks intersecting the assertion's scope**, with an expanding context ring granted on `abstain` escalation (function bodies → file → nearest callers).

## 4. The output contract

```yaml
assertion: INV-007
verdict: drift        # aligned | drift | regression | stale-claim | abstain
severity: breach      # grazes | bends | breach | entrenches → 0.25 / 0.5 / 0.75 / 1.0
confidence: 0.8
evidence: [core/http.rs:41-58]    # mandatory for violations — no citation, no verdict
precedent: null       # PRE-id required when verdict = regression
rationale: >
  Imports reqwest inside core/, bypassing the adapter boundary…
```

- **Severity is an anchored ordinal, not a bare float.** Models can't calibrate a continuous 0–1, but they can distinguish *grazes the boundary* from *entrenches the breach*. The four anchors map to fixed numerics for the accumulator.
- **Citations are mandatory for violations.** A verdict that can't point at lines doesn't exist — this kills hallucinated violations structurally, and makes every verdict verifiable.
- **`abstain` is a first-class ruling.** It never accumulates; it escalates with a wider context ring, then up the ladder. Forced calls are worse than honest uncertainty.
- **Aligned verdicts stay terse.** Only violations earn rationale. Compliance must be cheap to certify.

## 5. Panels turn disagreement into signal

For `judgment`-class assertions with high precision: sample N=3, take **median severity**, and let inter-judge variance either **discount the event's effective surprise** or bounce the case to a human. Three judges split on whether it's a breach? That uncertainty belongs in the ledger, not papered over.

## 6. The bar exam and judge drift

- **Precedents moonlight as the bar exam.** Any new judge — a change to model id *or* prompt hash — must re-decide the settled cases in `precedents.yaml` and match the rulings before it may sit.
- **Golden-sample drift checks.** Periodically re-judge a frozen sample of past cases. If verdict distributions shift while the code didn't, *the judge drifted*. The observer is observed, with the same machinery.
- **Seating is constitutional.** Judge definitions (model + prompt hash) live in `.program/manifest.yaml`; seating a new judge is a ratified PR gated on a passing bar exam.

## 7. The regression judge is a different animal

Invariant judges check assertions; the regression judge works by **analogy over case law**:

1. Embed the `killed` patterns from `precedents.yaml`.
2. Retrieve candidate matches against the incoming diff.
3. An LLM confirms *same pattern or lookalike*, citing the `PRE-id` in the verdict.

Retrieval-first keeps it cheap and grounded; the confirming call is narrow. False lookalikes that a human overturns become `ruling: coincidence` precedents — the case law sharpens itself.
