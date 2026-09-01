# Promotion criteria and the determinism advisory window

> **Status: DRAFT — UNRATIFIED.** Every value marked `TBD` below is an open
> decision, not a description of current behaviour. Nothing in this file is
> authoritative until a maintainer replaces the `TBD`s and drops this banner.
> Do not implement an aggregator against the placeholders.

## Why this file exists

The determinism aggregator is described as turning "the promotion decision into reading one report". That framing only works if the report's single number has an agreed meaning. Today it does not: the pass rate can be computed at least two ways, over at least two window shapes, and a sha flagged as non-deterministic could either block promotion or merely annotate it. Those choices are not cosmetic — they decide whether the aggregator groups by run or by sha, and what exit code its script returns.

This document is the place where that gets settled once, so the aggregator and its readers agree on what the number means. It is written as a decision request: it fixes the vocabulary and lays out each choice with its consequences, and leaves the actual policy to a human.

If a decision here is ratified, it should also be recorded as an ADR in [`docs/DECISIONS.md`](DECISIONS.md), and this file demoted to the operational restatement of that ADR.

## Vocabulary

These terms are used with exactly these meanings in the aggregator, its report, and any workflow that gates on it.

| Term | Meaning |
| --- | --- |
| **Run** | One execution of the determinism check: recompile the blueprint sources and compare the emitted artefacts against the committed ones. Produces a single pass/fail. |
| **Sha** | One commit of the repository under test. A sha may be exercised by more than one run. |
| **Deterministic sha** | A sha for which every run in scope agreed — all passed, or all failed for the same reason. |
| **Non-deterministic sha** | A sha for which runs in scope disagreed. This is the flag the aggregator raises, and it is a strictly stronger signal than a plain failure: a sha that fails identically every time is deterministic and broken; a sha that flaps is non-deterministic. |
| **Window** | The bounded set of runs or shas the pass rate is computed over. See [Window shape](#window-shape). |
| **Pass rate** | The fraction of the window that passed, under the aggregation unit chosen in [Aggregation unit](#aggregation-unit). |
| **Advisory** | A signal that is reported and surfaced but does not by itself change an exit code. |
| **Blocking** | A signal that causes a non-zero exit code and so fails whatever gate consumes it. |

## Decision 1 — Aggregation unit

**Is the pass rate per-run or per-sha?** `TBD`

The two are not interchangeable when shas are unevenly sampled: a single sha re-run twenty times dominates a per-run rate and contributes one data point to a per-sha rate.

- **Per-run** — pass rate = passing runs ÷ total runs in the window. Simplest to
compute; the aggregator can stream the run list without grouping. Measures "how often does the check pass", which is the flakiness question.
- **Per-sha** — pass rate = shas with no failing run ÷ total shas in the window.
Requires grouping runs by sha. Measures "how much of our history is clean", which is closer to the promotion question, and makes the non-determinism flag fall out of the same grouping.

Whichever is chosen, the report must state the unit next to the number. A bare percentage with no unit is the failure mode this document exists to prevent.

## Decision 2 — Window shape

**What window does the pass rate cover?** `TBD`

Options, not mutually exclusive — the aggregator may report more than one, but exactly one must be named as the promotion window:

- **Last N runs** — `N = TBD`. Stable sample size; the time span it covers
  varies with activity.
- **Last N shas** — `N = TBD`. Aligns with the per-sha unit; ignores re-run
  volume.
- **Trailing time window** — `TBD` days. Stable time span; the sample size
collapses during quiet periods, which makes the rate noisy exactly when nobody is watching.

Also undecided: the **minimum sample size** below which the aggregator reports "insufficient data" rather than a misleadingly precise rate. `TBD`.

## Decision 3 — Promotion threshold

**What pass rate over that window promotes a build?** `TBD`

Record the threshold, and record whether it is inclusive (`>= threshold`) or exclusive (`> threshold`). Off-by-one at the boundary is a real source of disagreement between a script and the humans reading its report.

## Decision 4 — How a non-deterministic sha is treated

**Does a sha flagged as non-deterministic block promotion, or only annotate it?** `TBD`

- **Blocking** — any non-deterministic sha in the window forces a non-zero exit
regardless of the pass rate. Justification: determinism of compiled output is a stated guarantee of the compiler (see [`docs/GENERATED-FILES.md`](GENERATED-FILES.md)), and a flapping sha means that guarantee is not holding, which a high pass rate can mask.
- **Advisory** — the flag is reported prominently and the exit code depends only
on the pass rate. Justification: keeps one number in charge of the gate, and avoids a single flaky sha wedging promotion.

If blocking is chosen, also decide whether the block is scoped to the sha being promoted or to any sha in the window. These give very different behaviour when an old flaky sha is still inside the window.

## Decision 5 — Exit-code contract

Once the above are fixed, the aggregator's script must implement exactly this contract, and the contract must be stated here so callers can rely on it:

| Exit code | Meaning | Decided? |
| --- | --- | --- |
| `0` | Promotion criteria met | `TBD` — depends on Decisions 3 and 4 |
| non-zero | Promotion criteria not met | `TBD` — is there one failure code, or distinct codes for "below threshold" vs "non-deterministic" vs "insufficient data"? |

Distinct failure codes cost nothing to emit and let a calling workflow distinguish "we are not ready" from "we cannot tell". Recommend deciding this explicitly rather than letting it fall out of the implementation.

## What the report must state

Independent of the decisions above, the generated report should be readable without consulting the script. It should carry, at minimum:

- the pass rate, with its aggregation unit named;
- the window definition, and the actual sample size observed;
- the threshold it was compared against, and the resulting verdict;
- the list of non-deterministic shas in the window, and whether they were
  treated as blocking or advisory;
- the exit code the run produced.

A reader who has only the report should be able to reconstruct the decision.

## Open questions for maintainers

1. Decisions 1–5 above.
2. What is being promoted, precisely — a compiled artefact, a tag, a Pages
deploy? The vocabulary here is deliberately neutral, but the ratified version should name it.
3. Where does the report live, and does any workflow in `.github/workflows/`
   currently gate on it? This document does not assume one does.
