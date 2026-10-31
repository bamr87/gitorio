# Proposal — RL drift learning: calibrating drift against outcomes across phases of history

- **Status:** proposed (design only — no code)
- **Date:** 2026-10-30
- **Proposed by:** agent (Grok Bot) for Amr (bamr87)
- **Affects:** spec 02 §4–§5 (knobs), spec 03 §6 (bar exam / golden samples), spec 04 §1 (epochs) and §5/§8 (precision seeding, knob retunes), ROADMAP v2; `.program/charter.md` *Direction* (amendment drafted in [`proposals/PROPOSED-learning-amendment.md`](../../proposals/PROPOSED-learning-amendment.md), not applied); gitorio PRD `FR-NEW` / feature `GITORIO-NEW` (placeholders, numbered at merge)
- **Counterpart:** bamr87/githubai `ai-seed/docs/proposals/seed-recipes.md` (the seed-recipe proposal) — see [Counterbalance contract](#counterbalance-contract-shared-section--identical-in-both-proposals)
- **Related:** gitorio #160 (Harness Studio on Jev), hub bamr87/bamr87#480 (prior art first), #478 (architecture research harness), ADR-0001/0002/0003/0004/0008

## 0. Needs assessment (hub §10.8 "Prior art first", proposed in #480)

**Problem.** GWTP's drift signal is only as good as its knobs (`precision`, `budget`, `half_life`) and its judges. Today precision is *seeded* from evidence strength (spec 04 §5, `src/distill/precision.ts`) and then *rises under affirmation* (Q-47), but nothing checks whether a drift score of 0.75 actually predicts anything bad. Spec 04 §8 and ROADMAP v2 already promise "knob-retune proposals justified by ledger replay" without saying what justifies them.

**Need.** A controlled way to learn, from the repo's own past, which drift verdicts turned out to matter (the change was reverted, needed a bug fix, or was rejected in review) and which were noise — and to turn that into *proposed* knob values and judge-seating evidence that a human ratifies.

**Who benefits.** Maintainers (fewer, better-aimed proposals: recommendation fatigue is the failure vision.md names), the bench (judge drift becomes measurable), and AI seed (a calibrated, honest counterweight to its recipes).

**Non-need.** GWTP does not need an agent that acts in the repo, learns online from its own outputs, or changes law. Those are explicitly ruled out below.

## 1. What "reinforcement learning" means here — precisely

Amr's framing is "a reinforcement-learning mechanism that looks through git history across periods and phases." The honest technical name for what this proposal builds is **offline, human-gated reward-model calibration with a contextual-bandit policy over knob settings**. It borrows RL's vocabulary (state, action, reward, policy, off-policy evaluation) because the structure fits, but it rules out the parts of RL that would break GWTP's constitution:

| RL ingredient | Here | Ruled out |
| --- | --- | --- |
| Environment | A frozen, replayable git history + ledger (ADR-0002 already makes the ledger replayable) | A live repo the policy acts on |
| Learning | Offline, batch, on held-out phases | Online updates from the system's own live actions |
| Policy output | A *proposed* knob vector and calibration map, delivered as a ratification PR | Direct writes to `.program/` (INV-001) |
| Reward | Observed downstream outcomes (§3.3), not the model's own judgment | Self-reward, LLM-as-reward without human anchor |
| Credit assignment | One step: change → outcome within a horizon (bandit) | Multi-step trajectories / value bootstrapping |

Why a bandit and not full RL: GWTP's actions (what score to give, whether to fire) do not change the future history it learns from — the history is already written. With no state transition caused by the action, the problem *is* a contextual bandit, and the right tools are calibration (Platt / isotonic), logged-bandit off-policy evaluation (inverse propensity / doubly robust), and reward modeling from preferences (Bradley–Terry) — all of which are auditable, cheap and deterministic given a seed. Full RL (PPO/Q-learning) would add opacity and nondeterminism for no gain.

## 2. Phase segmentation of history

GWTP already segments history into **epochs** whose boundaries "aren't dates" (spec 04 §1). This proposal reuses that and adds explicit phase kinds so learning can be evaluated *across* phases, not just within one.

**Phase kinds, in precedence order** (a boundary from a higher kind wins when two fall within 3 commits of each other):

1. `release` — a published release or semver tag (spec 06 §2.2/§2.3 already reads these; upkeep's tag backfill — Q-74 — gives us tags even where none were pushed).
2. `tag` — any other annotated tag.
3. `epic` — a span bounded by the first and last merged PR linked to one epic issue / milestone / FEAT id (via the forge adapter; bare git degrades to commit-message references).
4. `epoch` — spec 04 §1's statistical boundaries (churn regime change, dependency or layout shifts).
5. `window` — fixed committer-time windows (default 30 days), used only to fill gaps longer than 2× the window and as the fallback on a bare repo.

**Output:** `phase-map/v1` (shared format, see contract), content-addressed, written to `.gwtp/learn/phase-map.json` (gitignored cache, like `.gwtp/nexus/`). Segmentation is a pure function of `(commit graph, tags, forge metadata snapshot)`: same inputs, same bytes.

**Committer time throughout** (ADR-0004), so phase boundaries agree with decay arithmetic and backfill.

## 3. State, action and reward

### 3.1 State (context) — what the learner sees about one change

For each scored unit (one assertion × one change, the same unit the ledger already records — spec 02 §2):

- the verdict already on the ledger: `kind` (aligned/drift/regression/stale-claim/abstain), anchored severity, rung of the ladder that produced it, panel variance if any;
- assertion class and current knobs (`precision`, `budget`, `half_life`);
- change shape: files, lines, hunks, nexus ring/seam (spec 05), test files touched;
- phase context: phase kind and id, position within phase (early/late), dispersion features at that time (author *entropy* and path entropy — counts only, never identities).

**Blindness.** The learner lives in a new sighted module (`src/learn/**`, proposed), *outside* the blind zone, and it reads accumulators and dispersion the way sentencing does. It never feeds anything back into `src/judge/**`, `src/evidence/**` or `src/nexus/**`: its only outputs are a proposal PR and a calibration file the *fold* reads. `check:inv003` gains a rule that no blind module imports `src/learn/**`. Author identity is never a feature (INV-003's rationale — conditional independence — applies equally to a learner: a model that learns "this author drifts" is a meter on people, not code).

### 3.2 Action

Two action spaces, learned separately and both *proposed*, never applied:

- **A1 — calibration map** `f: raw evidence → p_drift ∈ [0,1]` per assertion class (isotonic regression, monotone in severity so it can never rank a `grazes` above a `breach` for the same assertion). Stored as `drift-calibration/v1`, hashed; seated like a judge (it changes what the meter means).
- **A2 — knob vector** per assertion: `(precision, budget, half_life)` chosen from a small discrete grid around current values (e.g. precision ±{0, 0.05, 0.1}, budget ×{0.75, 1, 1.25}, half_life ×{0.5, 1, 2}). Each arm is evaluated by **ledger replay** (ADR-0002: "counterfactual replay"): refold the held-out phases with the arm's knobs and observe which proposals would have fired.

### 3.3 Reward — human-anchored outcomes, not self-judgment

Rewards come from `outcome-label/v1` records mined deterministically from history, in decreasing trust:

| Signal | How it is mined | Label | Weight |
| --- | --- | --- | --- |
| Counterbalance resolution / explicit human label | Issue resolution on a `counterbalance` finding; precedent `ruling` | ground truth | 1.0 |
| PR review verdict | `CHANGES_REQUESTED` that led to the hunk being removed, or a closed-unmerged PR | bad | 0.8 |
| Revert | `git revert` trailer / "Revert \"…\"" subject / exact inverse diff within horizon | bad | 0.8 |
| Bug-fix-of | SZZ-style blame of a later `fix:` commit or `bug`-labelled PR back to the lines this change introduced (§6 adopts PySZZ's approach) | bad | 0.6 |
| Survived | Lines still present and untouched by fix/revert after horizon H (default 90 days of committer time) | good | 0.4 |
| Unknown | Horizon not elapsed, or history too short | excluded | 0 |

Reward for a calibration arm is the negative **Brier score** of `p_drift` against these labels; reward for a knob arm is a **cost-weighted F-score of firing** (a fired proposal on a change later labelled bad = TP; fired on survived = FP; bad but never fired = FN), with FP cost = 1, FN cost = 2 by default (human-ratified constants in `.program/`, not code). Weights are a prior, not a fit: changing them is a program amendment.

**Label hygiene.** Weak labels are noisy (a revert can be a release-train shuffle; SZZ over-blames refactors). Mitigations: ignore reverts of reverts and merge commits; SZZ filters for whitespace/comment/refactor-only hunks; and the *trust-weighted* table above. Labels are never produced by an LLM in this loop.

### 3.4 Policy and update rule

- **Batch, per cycle.** Fit A1 on training phases; choose A2 arms by replay on validation phases; report on test phases (§4). No gradient steps on live data.
- **Conservative improvement.** An arm is proposed only if its lower 95% bootstrap confidence bound on reward beats the incumbent's point estimate on held-out phases (safe policy improvement); otherwise "no change" is the output and the report says so (fail loud, never silent).
- **Step limits.** At most one grid step per knob per cycle, so ratified law moves gradually and every move is explainable in one sentence.

## 4. Evaluation

- **Held-out phases, forward-chaining.** Phases are ordered by committer time; train on phases 1…k, validate on k+1, test on k+2, then roll forward (time-series CV). No random splits: they leak the future. A repo with fewer than 5 labelled phases gets a report and no proposal.
- **Drift precision / recall.** On test phases: precision = fired proposals whose changes were later labelled bad / all fired; recall = bad changes that fired / all bad; plus PR-AUC (labels are imbalanced, so ROC-AUC alone flatters).
- **Calibration.** Expected calibration error (10 equal-mass bins), Brier score with its reliability/resolution decomposition, and a reliability diagram in the report. A calibrator is only seated if ECE on test ≤ the incumbent's.
- **Stability.** Kendall τ between this cycle's and last cycle's per-assertion ranking; a large swing without a matching change in labels is reported as *learner drift* (the observer observed, spec 03 §6).
- **Bar exam.** Any proposed calibrator must re-decide `precedents.yaml` cases identically to the seated bench, the same gate a new judge passes.
- **Counterbalance agreement.** Rate of `disagree-*` outcomes against AI seed recipes per phase; a rising rate with stable metrics is a signal for a human, not an optimisation target (optimising it would make the two systems collude).

## 5. Guardrails

- **Read-only.** Reads git objects, the ledger ref and forge metadata through `adapters/github` (INV-005). Writes only: `.gwtp/learn/` cache (gitignored) and one draft PR per cycle that touches `.program/` *only as a proposal file* under `proposals/` — a human applies it (INV-001).
- **Deterministic and reproducible.** Pure functions of a pinned input manifest `{head_sha, ledger_tip, forge_snapshot_hash, phase_map_hash, label_set_hash, seed}`; bootstrap and tie-breaking use the recorded seed; the report embeds the manifest so `gwtp learn replay <manifest>` reproduces it byte for byte (exit code contract 0/1/2 from CONTRIBUTING.md).
- **Human-gated.** No knob, calibrator or judge changes without a ratified PR; the learner is default OFF (`GWTP_LEARN_ENABLED` repo variable, same consent model as `tend`).
- **No model in the reward path.** Model calls exist only where the ledger already used them (judges). Learning itself is stdlib arithmetic in TypeScript; it adds no dependency (ADR-0006 pins the runtime set).
- **Cost** is reported per cycle as **"API-equivalent (estimate)"**. The learner itself costs ~0 model tokens; the only spend is re-judging golden samples for the bar exam, estimated at (cases × tokens per judgment × list price).
- **Privacy.** No author identity in features, reports or proposals; dispersion stays counts and entropies.

## 6. The loop in practice

**Cadence.** Monthly (and on every `release` phase boundary), dispatched by a scheduled workflow next to `upkeep.yml`; manual `workflow_dispatch` for a chosen manifest. Bounded runtime (timeout 30 min) and concurrency 1.

**Inputs.** Repo history to HEAD; `refs/program/ledger`; `.program/` (knobs, precedents); forge snapshot (PRs, reviews, issue labels) via the adapter; `outcome-label/v1` set (mined + counterbalance resolutions); the latest AI seed recipes for this repo (read-only, for the agreement metric only).

**Outputs.** (1) `phase-map/v1`, `outcome-label/v1`, `drift-calibration/v1` in `.gwtp/learn/`; (2) a markdown + JSON report (metrics, reliability diagram, proposed arms, confidence bounds, manifest, cost); (3) at most one draft PR adding `proposals/PROPOSED-knob-retune-<cycle>.md` with copy-pasteable `.program/` diffs and provenance lines (spec 01 §4 rule 1); (4) `counterbalance-finding/v1` issues for disagreements.

**CLI (proposed, mirrors existing verbs).** `gwtp learn phases | labels | fit | evaluate | propose | replay`.

### Example cycle (illustrative numbers)

1. *Segment.* gitorio history → 9 phases: 4 `release` (v0.1…v0.4), 3 `epic` (Fleet Ops, Harness tab, packages import #136), 2 `window` gap-fillers.
2. *Label.* 412 scored units in phases 1–7: 38 bad (11 reverts, 19 SZZ bug-fix-of, 8 review rejections), 301 survived, 73 unknown (horizon not elapsed — excluded).
3. *Fit.* Isotonic calibrator on phases 1–5 per class. On phase 6 (validation) INV-005 drift at `bends` maps to `p_drift = 0.41`, but `breach` only to 0.52 — severity separates weakly for this assertion.
4. *Replay arms.* For INV-005, arm `(precision 0.9→0.85, budget ×1.25)` replayed on phase 7 (test) cuts fired proposals 9 → 5 with the same 4 true positives: precision 0.44 → 0.80, recall unchanged at 0.67, ECE 0.11 → 0.06. Bootstrap lower bound beats incumbent → proposable.
5. *Counterbalance.* 3 `disagree-flagged-expected` cases in the packages-import epic: GWTP flagged path moves that the AI seed recipe for `GITORIO-005` lists as expected steps. Filed as one finding issue for a human.
6. *Propose.* Draft PR `docs/learn-cycle-2026-11` adds `proposals/PROPOSED-knob-retune-2026-11.md` with the INV-005 diff, the report, and "Cost: 0 tokens learner + 120k tokens bar exam ≈ $0.90 API-equivalent (estimate)". A human ratifies or rejects; a rejection is recorded as an `affirmed` precedent and enters the next cycle's labels.

## 7. Phasing (proposed roadmap entry: ROADMAP v2 "The institution" gains "v2.1 — The apprentice")

- **L0** — `phase-map` + `outcome-label` mining, report only (no fitting). Exit: deterministic rerun is byte-identical on gitorio.
- **L1** — calibrator + evaluation report. Exit: ECE and PR-AUC reported on held-out phases for gitorio and one OSS fixture.
- **L2** — knob arms by replay + proposal PR. Exit: one ratified or rejected retune PR, the rejection written as a precedent.
- **L3** — counterbalance comparator against AI seed recipes (after the hub contract lands).
## 8. Prior-art survey and build-vs-adopt (hub §10.8, proposed in bamr87/bamr87#480)

Surveyed from published documentation and papers; versions and licences should be re-checked at implementation time. "Adopt" means use the tool or method as is; "adopt method" means reimplement a published algorithm inside our constraints (GWTP pins its runtime dependencies in ADR-0006; ai-seed tooling is single-file stdlib Python); "build" means nothing fits.

| Prior art | What it does | Fit | Call |
| --- | --- | --- | --- |
| [PyDriller](https://github.com/ishepard/pydriller) | Python git-mining: commits, modifications, metrics, per-file history | Good for AI seed's offline miner; GWTP is TypeScript and already has `src/distill/miner.ts` | **AI seed: adopt** (dev-time dependency of the recipe miner, not the kernel). **GWTP: build** (keep the existing miner; dependency pin) |
| [GitHub Linguist](https://github.com/github-linguist/linguist) | Language / generated / vendored file classification | Needed to exclude vendored and generated files from labels and recipes | **Adopt its data, not the gem**: read the forge's language stats via the API and reuse Linguist's `vendor.yml`/`generated` heuristics as a pinned list |
| [CodeScene](https://codescene.com/) / [code-maat](https://github.com/adamtornhill/code-maat) | Behavioural code analysis: hotspots, temporal coupling, change coupling | Temporal coupling is a useful recipe feature ("these files change together") | **Adopt method** (code-maat's coupling metric, open source). CodeScene itself is SaaS and identity-centric (author analyses) — **not adopted** |
| SZZ ([Śliwerski, Zimmermann, Zeller 2005](https://doi.org/10.1145/1083142.1083147)); [PySZZ](https://github.com/grosa1/pyszz), SZZ Unleashed | Trace bug-fix commits back to bug-introducing commits via blame | Core of both the reward labels (GWTP) and pitfall mining (AI seed) | **Adopt method** (B-SZZ + refactoring/whitespace filters per PySZZ's variants); use PySZZ as the reference oracle in tests |
| Architecture erosion / drift research: Perry & Wolf 1992; reflexion models ([Murphy, Notkin, Sullivan 1995](https://doi.org/10.1145/222124.222136)); [ArchUnit](https://www.archunit.org/); dependency-cruiser | Compare an intended architecture model to the extracted one | GWTP's `.program/` + nexus *is* a reflexion model; ArchUnit-style rules are its deterministic rung | **Already adopted in spirit**; cite in spec 05. No new tool |
| RLHF / reward modelling ([Christiano et al. 2017](https://arxiv.org/abs/1706.03741)); Bradley–Terry preference models | Learn a reward from human comparisons | Useful only for pairwise human labels on findings | **Adopt method, small**: Bradley–Terry over resolved findings, offline. No policy optimisation (PPO) — ruled out (§1) |
| Contextual bandits + off-policy evaluation ([Li et al. 2010](https://arxiv.org/abs/1003.0146); [Vowpal Wabbit](https://vowpalwabbit.org/); doubly-robust OPE) | Choose an arm per context; evaluate policies from logs | Exactly the knob-selection problem | **Adopt method** (grid arms + replay + bootstrap bound). VW not adopted (native dependency, overkill for a few dozen arms) |
| Probability calibration (Platt scaling; isotonic regression; [scikit-learn calibration](https://scikit-learn.org/stable/modules/calibration.html)) | Map scores to calibrated probabilities; reliability diagrams, ECE | Core of A1 | **Adopt method** (isotonic/PAV is ~40 lines, pure, deterministic). scikit-learn used only as a test oracle |
| [OpenRewrite](https://docs.openrewrite.org/) recipes | Declarative, composable, testable code-transformation recipes (YAML + visitors, before/after tests) | Closest prior art to *seed recipes*: declarative steps + preconditions + tests. But it transforms code deterministically; seed recipes describe intent for an agent | **Adopt shape, not engine**: borrow `preconditions`, composition, and before/after test conventions into `seed-recipe/v1`. Emit an OpenRewrite recipe reference when a step is a mechanical migration |
| [Semgrep](https://semgrep.dev/) / [Comby](https://comby.dev/) / codemods (jscodeshift) | Pattern match / rewrite | Good for recipe *checks* ("this pitfall pattern must not appear") | **Adopt optionally** as an acceptance-check runner in planted repos that already use it; not a kernel dependency |
| [SWE-bench](https://www.swebench.com/) / Defects4J / [BugsInPy](https://github.com/soarsmu/BugsInPy) | Benchmarks that replay real fixes from history in a sandbox and score against real tests | Exactly the *validation-by-replay* method for recipes | **Adopt method**: checkout parent SHA, apply agent work on a sandbox branch, run the real later tests (fail-to-pass / pass-to-pass) |
| [GrimoireLab / Perceval](https://chaoss.github.io/grimoirelab/) | Collect forge data (issues, PRs, reviews) at scale | Heavier than needed; identity-centric dashboards | **Not adopted**; `gh api` through each repo's adapter suffices |
| Conventional Commits / [git-cliff](https://git-cliff.org/) / release-please | Commit type parsing; changelog from history | Both repos already use Conventional Commits; `fix:` types seed bug-fix chains | **Adopt** the convention as a labelling input (already in force) |
| [TokenEconomizer](https://github.com/microsoft/TokenEconomizer) (Apache-2.0) | Coding-agent plugin: micro-skills, tool pruning, failure-loop guard; claims 18–31% lower cost on SWE-Bench | Agent passes that run again and again in the same repo | **Adopt** as-is, opt-in, pinned, shadow first; see §8.1 |
| Jev (hub numbering + fragments) | `HUB-NEW`/`FR-NEW` placeholders, `features.d/` and `changelog.d/` fragments numbered at merge | The fleet's own standard for ids in proposals | **Adopt** for every new id in this proposal |

**Net decision.** Build a small, auditable core in each repo's existing language (TypeScript in GWTP, stdlib Python in ai-seed) that reimplements published methods (SZZ, isotonic calibration, bandit replay, SWE-bench-style replay); adopt PyDriller as AI seed's offline mining library; adopt OpenRewrite's recipe *shape*; adopt Jev for numbering. No hosted service, no online RL framework.

### 8.1 TokenEconomizer (microsoft/TokenEconomizer): token-cost control for the agent loops

Added 2026-10-30 at Amr's request. Facts below were read from the repository README and LICENSE at commit `e428fc9` and the GitHub API on that date. Re-check them before implementation, because the project is about 2.5 weeks old.

**What it is.** [microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer) ("Experience-Driven Black-Box Cost Control for Coding Agents"; UC Berkeley + Microsoft Research; paper [arXiv 2610.22732](https://arxiv.org/abs/2610.22732)) is a **plugin, not a library**. It works with Claude Code, Codex, GitHub Copilot CLI and Pi, and opencode support is experimental. It leaves the agent unchanged and learns from earlier sessions in the same repository. It has three switchable mechanisms:
- **Micro-skills** (off by default): learns repo facts such as "run `python -m pytest`" from repeated failures and from a proposer model call every *k* = 3 sessions. It injects a fact at session start once 3 sessions confirm it and drops the fact when later sessions contradict it. The `microskills=envfacts` mode learns from failures only and makes no model calls.
- **Tool pruning** (on by default): leaves out tools that went unused (*p* = 10 prompts over at least *m* = 2 sessions, or *s* = 5 sessions). It does this through the agent's own settings, which for Claude Code is `.claude/settings.local.json`, kept out of git via `.git/info/exclude`. The `toolprune=propose` mode only proposes, and `toolprune restore` undoes it.
- **Loop guard** (on by default): when a turn repeats failures, a judge model (confidence *c* ≥ 0.7) adds at most *r* = 1 redirect note. It **never stops a turn itself**; it only tells the operator.
- Interfaces: slash commands and the `~/.tokeneconomizer/bin/te` CLI (`status`, `config`, `microskills`, `toolprune`, `doctor`). Settings use `TE_*` env vars, and `TE_DISABLE=1` turns the plugin off. State stays local in `~/.tokeneconomizer`. It needs **no API key of its own** and never handles credentials. Its own model calls go through the host agent, and they are counted in its cost reports, which use cache-aware pricing.
- Reported result (the authors' own measurement on SWE-Bench, 5 agent–model combinations): **18.4–30.9% lower mean cost**, cheaper in 30/30 repo × combination cells, Pass@1 up in 4/5. On new-repo security benchmarks it saved 6–20%. Savings are largest for **repeated sessions in the same repository**.
- Maturity: Apache-2.0. Created 2026-10-12 (MDT) and pushed daily, with about 2.1k stars. Agent support is pinned to narrow version windows (for example Claude Code 2.1.300–2.1.310, and "older versions not supported"). Research-grade, with no release tags.

**Needs assessment.** Both designs add model-calling loops: per-commit triage, epoch synthesis, recipe drafting, replay judging, and the `tend` / germinate / grow / steward passes that run Claude Code in Actions. The research review (risk 6, "cost creep") and the open `ai-seed/CONCEPT.md §2` item "Cost governor" both say cost control must exist before any scheduled run. That need has two parts:
1. **Pacing / budgets**: hard caps per run and per period (`--max-budget-usd`, the manifest budget block, `gate.budget`). TokenEconomizer does **not** do this.
2. **Waste reduction inside a loop**: re-learning the repo, unused tool definitions, and stuck loops. This is what TokenEconomizer does, and building our own would duplicate a published, measured tool.

**Build-vs-adopt decision: ADOPT as-is, opt-in, pinned, in shadow mode first. Do not build our own token-economy layer. Keep budget enforcement as our own (deterministic) build.**

| Concern | Call |
| --- | --- |
| Waste reduction for Claude Code agent passes (tool pruning, loop guard) | **Adopt** TokenEconomizer, pinned to a commit SHA and installed from a clone on the runner. Enabled only by a repo variable (default OFF), the same consent model as the learner / kill switch |
| Micro-skills | **Adopt in `envfacts` mode only** (no extra model calls) until a measurement shows the proposer pays back |
| Budget caps and pacing (per run, per week, per repo) | **Build** (already planned): deterministic gate against the telemetry ledger. TokenEconomizer's `status` cost report is an *input* to that ledger, never the enforcer |
| Cache-aware cost accounting ("count cost as it is billed", including the plugin's own calls) | **Adopt method** in our cost reports. Keep labelling it "API-equivalent (estimate)" |
| Deterministic rungs (compiled erosion rules, SZZ, calibration arithmetic) | **Not applicable**: these already cost $0 in model tokens. No plugin there |

**Guardrails for the integration.**
- **Measurement hygiene.** TokenEconomizer changes agent behaviour: it injects facts, removes tools and adds redirects. Every run record must therefore carry `te: {enabled, sha, mechanisms}` in its input manifest. Learned calibrations, replay scores and A/B comparisons must never mix runs with TE on and TE off unless that field is a recorded covariate.
- **Reproducibility.** Learned state (`~/.tokeneconomizer`) is per machine. On ephemeral CI runners it either starts cold every run, which loses most of the benefit, or is restored from an Actions cache keyed by repo + agent + TE SHA. A cached state is an input: hash it into the manifest, and never commit it.
- **No new write path.** Tool pruning writes only `.claude/settings.local.json`, which TE excludes from git. A run's diff guard must still fail if any `.claude/`, `.codex/` or `.github/copilot/` settings file shows up in a pushed diff.
- **Human stays in charge.** The loop guard only redirects and reports. It is not a substitute for our kill switch, repair budgets or `--max-budget-usd`, which remain the hard stops.
- **Version drift.** The narrow supported-version window means a Claude Code bump on the runner can silently put TE outside support. Run `te doctor` as a pre-step and treat "unsupported" as "TE disabled for this run" (fail open, as TE itself does), and log it.
- **Secrets.** TE needs no token. It must not be given one, and it adds no secret to any workflow.

**License notes.** Apache-2.0, which is compatible with both repos. We **do not vendor** it. It is installed at run time from a pinned SHA, so no NOTICE obligation arises in our tree. If code is ever copied, for example the cache-pricing logic, keep its license header and add a NOTICE entry. The arXiv numbers are the authors' own claims, so cite them as such until we reproduce them.

**Integration points in GWTP.**
- **`tend` agent** (opt-in, opens PRs) and the LLM judges that score soft drift are Claude Code sessions run again and again in the *same* repo. That is TE's best case. Enable TE there behind `GWTP_TE_ENABLED` (default OFF), with `toolprune=propose` for the first cycles.
- **Learner (§3–§6): none.** The learner is stdlib arithmetic. TE matters only for the bar-exam re-judging of golden samples. Those judgments must run with TE **off**, or with a pinned TE state hashed into the manifest, so calibration is not confounded by a changing judge context (§5 "Deterministic and reproducible").
- **Loop-guard events as a weak signal.** A `tend` turn that TE flags as stuck is evidence about the *finding*: an unfixable or ill-posed finding. Record it as a feature of the finding (count only, no transcript). It is never a reward label.
- **Cost line.** The per-cycle "API-equivalent (estimate)" (§5) adds TE's own judge/redirect spend from `te status`.
- **Phase E-TE (before v2.1 ships):** shadow A/B on `tend` over at least 20 sessions, TE off vs on (tool pruning + loop guard). Keep TE on only if mean cost drops by 10% or more with no loss in PR acceptance rate. Report both numbers in the cycle report.


## Counterbalance contract (shared section — identical in both proposals)

> This section appears verbatim in `bamr87/gitorio` → `packages/git-with-the-program/docs/proposals/rl-drift-learning.md` and in `bamr87/githubai` → `ai-seed/docs/proposals/seed-recipes.md`. Edit both together, or better, move it to the hub (below) and link it from both.

### Roles

| | GWTP (gitorio `packages/git-with-the-program/`) | AI seed (githubai `ai-seed/`) |
| --- | --- | --- |
| Question it answers | "Did this change deviate from declared intent, and how surprising was it?" | "What path should this feature have taken to reach its intent?" |
| Artifact | Drift verdicts on the ledger, calibrated scores (`drift-calibration/v1`) | Seed recipes (`seed-recipe/v1`) |
| Direction | Backward-looking: observation vs. the program (`.program/`) | Forward-looking: expected path from mined progressions |
| Failure mode it checks in the other | Recipes that encode a path the program already forbids, or that "expect" drift | Drift scores that flag the expected, well-trodden path (false positives) or miss steps a recipe says are load-bearing (false negatives) |

GWTP flags drift from intent. AI seed's recipe is the expected path. Neither is ground truth; each is the other's accuracy check, and a human settles disagreements.

### The comparison

For one scope (a FEAT id, a phase, and a commit range), a deterministic comparator joins:

- GWTP's per-change calibrated drift probability `p_drift` and its cited verdicts (assertion id, `file:line-span`, anchored severity);
- the recipe's expected step for that change (step id, expected files, expected tests) or `unmatched` when the change maps to no step.

It emits exactly one of four outcomes per change:

| GWTP says | Recipe says | Outcome | Who acts |
| --- | --- | --- | --- |
| low drift | on-path (matches a step) | `agree-aligned` | nobody; counted only |
| high drift | off-path (unmatched or matches a known pitfall) | `agree-drift` | GWTP's normal ladder (no new finding) |
| high drift | on-path | `disagree-flagged-expected` | **finding → human**: either the program is stale (reprogramming candidate) or the recipe learned a bad habit |
| low drift | off-path | `disagree-missed` | **finding → human**: either GWTP has a blind spot (missing assertion / miscalibrated knob) or the recipe is over-specified |

Thresholds for "high/low" are the calibrated operating point from GWTP's held-out evaluation (not a raw score), and "on/off-path" is the recipe's step-match rule; both are pinned in the contract file so a disagreement is reproducible.

### Findings

A finding is a record, never an action. It is filed as one GitHub issue per scope per cycle (labels `counterbalance` + `human-review`, so ai-seed's board lane parks it and GWTP never auto-files a proposal from it). A human resolves it with one of: `program-stale`, `recipe-wrong`, `gwtp-miscalibrated`, `both-wrong`, `inconclusive`. Resolutions are the highest-value labels either side gets: GWTP consumes them as reward labels (they enter the calibration set), and AI seed consumes them as recipe corrections (a `recipe-wrong` resolution bumps the recipe version and adds a `pitfall`).

Neither side may consume its own disagreement output without a human resolution. That is what stops the two systems from co-adapting into agreement (each "learning" to say what the other says).

### Shared data formats

All formats are JSON (YAML accepted on input), versioned with a `schema:` key, content-addressed (`sha256` of canonical JSON, same canonicalization as GWTP's `src/core/canonical.ts`), and identity-free (no author names or logins; GWTP INV-003 extends to anything a judge could see).

- `phase-map/v1` — the segmentation of a repo's history: `{repo, phases: [{id, kind: release|tag|epic|window|epoch, from_sha, to_sha, from_time, to_time, label}]}`. Produced by GWTP (it already has epochs, spec 04 §1); consumed by AI seed so both sides cut history the same way.
- `change-ref/v1` — a stable handle for one unit of change: `{repo, sha | pr, phase_id, hunk_hash?}`.
- `outcome-label/v1` — an observed outcome attached to a change: `{change, kind: revert|bug-fix-of|review-verdict|ci|counterbalance-resolution|human-label, value, source_url, observed_at}`. Both sides read it; neither side writes the other's.
- `drift-calibration/v1` — GWTP's per-change calibrated probability with its verdict citations and calibrator hash.
- `seed-recipe/v1` — AI seed's recipe (schema in the seed-recipes proposal).
- `counterbalance-finding/v1` — `{scope, change, gwtp: {p_drift, verdict_ids}, recipe: {id, version, step_id|null}, outcome, contract_hash, resolution?}`.

### Where the contract lives

Following the hub rule that a standard evolves in the monorepo first, the schemas and the comparator spec live in **`bamr87/bamr87`** as a design-only proposal first (proposed path: `docs/COUNTERBALANCE.md` plus `templates/counterbalance/*.schema.json`, with a `features/features.d/` fragment `HUB-NEW` and a `changelog.d/` fragment, numbered at merge by `tools.jev number`). Gitorio and githubai vendor a pinned copy (the way gitorio pins `vendor/archify/`) and CI fails on drift from the pin. Until the hub PR exists, this section is the contract of record and both copies must match byte for byte.

### Guardrails common to both sides

- Read-only against history and the forge; the only writes are (a) GWTP's own ledger ref, (b) AI seed draft PRs on `seed/*` branches, and (c) finding issues. Neither side edits the other's repo.
- Deterministic and reproducible: every run records input SHAs, schema versions, model id + prompt sha256 for any model step, and random seeds; a rerun with the same inputs produces byte-identical outputs or the run fails loud.
- Human-gated: no merge, no `.program/` write (GWTP INV-001), no kill-switch or guardrail edit (ai-seed constitution rule 4).
- Cost is reported per cycle as **"API-equivalent (estimate)"**: token counts × list price, even when the run used a Claude Code OAuth subscription, so the number is comparable across auth modes and is never mistaken for an invoice.

## 9. Open questions (to append to `docs/spec/OPEN-QUESTIONS.md` when work starts)

- Does a calibrator count as a judge (seated in `manifest.yaml` with a hash) or as a knob (in `invariants.yaml`)? This proposal assumes *seated*, since it changes what the meter means.
- Should FP/FN costs be global or per assertion? Proposed: global in `charter.md` constants, per-assertion override later.
- Label horizon H: 90 days of committer time matches the default half-life; should it equal each assertion's `half_life`?
- Q-21 (does the judge see the knobs?) stays answered "no": the learner is sighted, the judges stay blind.
