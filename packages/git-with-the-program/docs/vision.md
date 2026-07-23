# Vision: Git with the Program

## The problem

Every long-lived repository has a program — an intent, a set of boundaries, a direction of travel. Almost none of them have it *written down in enforceable form*, and none of them have machinery that notices when reality and intent part ways. Lint bots enforce the letter of rules nobody remembers ratifying. Code review enforces whatever the reviewer remembers. Architecture erodes one reasonable-looking PR at a time, and dead subsystems linger because no artifact ever said what the repo still claims to be.

## The bidirectional hinge

The concept that separates GWTP from every code-quality agent: **drift is not always the code's fault.** Forty commits pointing the same "wrong" direction can mean the program is stale, not the contributors. A system that can only enforce intent is a nag. A system that can also recommend *reprogramming* — amending intent itself, through a sanctioned, human-ratified channel — is a governor.

So the loop has two failure attributions and two outputs:

- **The code is wrong** → refactoring recommendation. The assertion stands; the change gets flagged, an issue or patch PR is opened.
- **The law is wrong** → reprogramming proposal. A PR against `.program/` itself, citing the accumulated evidence that the org has already outvoted the statute in practice.

Which one fires is decided by the **dispersion** of accumulated evidence, not by any single judgment. One author repeatedly hitting one seam in a tight window: refactor. Many authors independently hitting the same wall for months: reprogram.

## The predictive-processing frame

The design is predictive processing applied to repositories, and the mapping is load-bearing, not decorative:

| Predictive processing | GWTP |
|---|---|
| Generative model | The program (`.program/`) |
| Observations | Commits, PRs, merges |
| Prediction error | Drift verdicts |
| Precision weighting | Per-assertion `precision` |
| Evidence accumulation | Leaky-integrator accumulators in the ledger |
| Threshold / decision bound | Per-assertion `budget` |
| Model update | Reprogramming (amendment PR) |
| Change-point detection | Epoch segmentation in distillation |

This frame answers design questions on principled grounds:

- **Recommendation fatigue** → act on *accumulated surprise*, never single deviations. Precision, budget, and half-life are the sensitivity knobs, tuned per-assertion.
- **Judge independence** → evidence accumulation assumes conditionally independent samples. A judge that can see the running accumulator produces autocorrelated verdicts, and accumulated surprise stops being evidence. Hence the blindness rules (spec 03).
- **Bootstrap from history** → distillation is the loop run in reverse: infer the model from observations instead of scoring observations against the model. The live loop filters forward; distillation smooths backward.

## Non-goals

- **Not a linter.** Deterministic checks exist inside GWTP, but only as the cheap tier of a judgment ladder attached to ratified, provenance-bearing law.
- **Not auto-enforcement.** Default outputs are recommendations and proposals. Humans ratify amendments; humans merge refactors. Autonomy can be raised per-assertion, later, deliberately.
- **Not a metrics dashboard.** The ledger is evidence for decisions, not a vanity surface. If a number never changes a proposal, it doesn't need to exist.
- **Not forge-locked.** Git is the substrate. GitHub PR/issue metadata enriches distillation and delivery through an adapter; a bare repo degrades gracefully to commits-only.

## The self-hosting obligation

GWTP's own repository carries a `.program/` from day one and runs its own loop as soon as v0 exists. The framework must eat its own constitution: judge changes are ratified PRs, its precedents are its judges' bar exam, and the first reprogramming proposal it ever files should be against itself.
