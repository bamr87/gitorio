# Git with the Program

**An agentic governance framework that keeps a repository's evolution in accordance with its program — and knows when the program itself should change.**

Git with the Program (GWTP) distills a repo's git history and metadata into a versioned **core memory** (the *program*), then runs an evidence-accumulation loop that scores every change against it. It distinguishes four conditions — **drift**, **regression**, **obsolescence**, and **alignment** — and emits two kinds of output: **refactoring recommendations** (the code is wrong) and **reprogramming proposals** (the law is wrong). The second kind is what separates a governor from a nag.

## The one-sentence mechanics

The program is a generative model of the repo; commits are observations; drift is prediction error; accumulated surprise past a budget fires a proposal; and the *dispersion* of the evidence — one author drifting vs. the whole org outvoting a statute — decides whether the proposal points at the code or at the program.

## Architecture at a glance

```
                    ┌──────────────────────────────┐
                    │  .program/   (in-tree, sacred)│
                    │  charter · invariants ·       │
                    │  trajectory · precedents ·    │
                    │  scope · manifest             │
                    └──────┬───────────────▲────────┘
        assertions + knobs │               │ ratified amendment PRs
                           ▼               │
   push/PR ──▶ ┌─────────────────┐   ┌─────┴──────────────┐
               │  JUDGE BENCH     │   │  PROPOSAL ENGINE   │
               │  deterministic → │   │  dispersion stats  │
               │  hybrid → LLM →  │   │  → refactor rec    │
               │  panel → human   │   │  → reprogram PR    │
               └───────┬─────────┘   └─────▲──────────────┘
              verdict events               │ threshold crossings
                       ▼                   │
                    ┌──────────────────────┴────────┐
                    │  LEDGER  refs/program/ledger   │
                    │  (out-of-tree, profane)        │
                    │  content-addressed events ·    │
                    │  leaky-integrator accumulators │
                    └───────────────────────────────┘

   cold start: DISTILLATION WALK  (history ▶ candidate program ▶ ratification PR ▶ ledger backfill)
```

Seven components, six specs, one loop:

| Component | Spec | One-liner |
|---|---|---|
| Core memory | [docs/spec/01-core-memory.md](docs/spec/01-core-memory.md) | Two stores with different politics: normative `.program/` (human-ratified) vs. observational ledger (machine-append) |
| Ledger | [docs/spec/02-ledger.md](docs/spec/02-ledger.md) | Event-sourced, content-addressed, conflict-free; leaky-integrator accumulators; dispersion decides firing direction |
| Judge | [docs/spec/03-judge.md](docs/spec/03-judge.md) | Bench of narrow magistrates; author-blind and accumulator-blind; anchored ordinal severity; precedents as bar exam |
| Distillation | [docs/spec/04-distillation.md](docs/spec/04-distillation.md) | Two-pass bootstrap: deterministic fact miner + LLM law-namer; epoch segmentation by change-point detection; ratification ritual |
| Nexus | [docs/spec/05-nexus.md](docs/spec/05-nexus.md) | The perception layer: a derived, identity-free code knowledge graph (a clean-room [GitNexus](https://github.com/abhigyanpatwari/GitNexus) adaptation, ADR-0007) powering context rings, seams and negative-space proofs |
| Upkeep | [docs/spec/06-upkeep.md](docs/spec/06-upkeep.md) | Keeps the repo's forge-side presentation (description, topics, tags, releases, labels, doc references) from drifting: a deterministic plan, AI-authored content slots, forge-only apply, in-tree drift as reviewed PRs (ADR-0008) |
| Vision | [docs/vision.md](docs/vision.md) | Why bidirectionality is the point, and the predictive-processing frame behind the design |

## Repo layout

```
.program/          This repo's OWN program (dogfood, status: inferred — ratify it first)
docs/vision.md     Conceptual foundation
docs/spec/         The six component specifications
docs/adr/          Architecture decision records (the irreversible choices)
schemas/           JSON Schemas: assertion, event, verdict, precedent, nexus, upkeep-config, upkeep-plan
prompts/           Judge prompt templates (invariant judge, regression judge)
seeds/             Claude Code seed-session prompts, SEED-01 → SEED-04
posts/             it-journey draft posts documenting the build
.github/upkeep.yaml  This repo's upkeep config: where its description, topics, versions, releases and labels come from
ROADMAP.md         v0 → v2 slices
GLOSSARY.md        The vocabulary, in one place
```

## Getting started (building the framework)

1. **Ratify this repo's own program.** Open `.program/` — every assertion is `status: inferred`. Review, edit, flip to `ratified` in your first PR. The first ritual of the framework is performing the framework.
2. **Run SEED-01.** Point a Claude Code session at [seeds/SEED-01-scaffold.md](seeds/SEED-01-scaffold.md). It scaffolds the engine workspace, wires schema validation, and sets up CI.
3. **Proceed through the seeds in order.** SEED-02 (ledger engine) → SEED-03 (judge harness) → SEED-04 (distillation miner). Each seed states its objective, required reading, deliverables, and acceptance checks. Each ends by validating against `schemas/`.
4. **v0 target:** a repo that is *sighted* — hand-authored program, deterministic judges only, live accumulators, and issues filed on threshold crossings. No LLM in the loop yet. See [ROADMAP.md](ROADMAP.md).

## Repository upkeep (self-maintaining repo)

`gwtp upkeep` compares what the repository *says about itself* with what its config, tree and
history say it should be, and converges the two
([spec 06](docs/spec/06-upkeep.md)). It runs weekly and on demand
([`.github/workflows/upkeep.yml`](.github/workflows/upkeep.yml)):

```bash
npx tsx src/cli/index.ts upkeep plan            # observe + report (writes .gwtp/upkeep/plan.json)
npx tsx src/cli/index.ts upkeep fill --provider model   # AI-author the content slots (or let an agent edit the plan)
npx tsx src/cli/index.ts upkeep check           # validate the plan, including authored content
npx tsx src/cli/index.ts upkeep apply --yes     # tags, releases, labels, description, topics (forge only)
npx tsx src/cli/index.ts upkeep run             # all of the above as one dry run; add --yes to apply
```

Remote drift (description, topics, tags, releases, labels) is fixed by API calls. In-tree drift
(a version bump, a stale README line, a missing LICENSE, a doc that stopped naming a schema or
CLI command) is never committed by the job. It becomes a checklist, and the opt-in `tend` job
hands it to Claude Code as a draft PR.

## Design principles (the short list)

- **Program is sacred, ledger is profane.** Humans ratify law; machines append observations. Never mix the write paths.
- **Verdicts are facts.** Judges may be stochastic; the fold over their recorded verdicts is deterministic. Re-judging supersedes, never edits.
- **No citation, no verdict.** A violation that can't point at lines doesn't exist.
- **Decay is the only forgiveness.** Compliance is counted but never pays down the accumulator.
- **Dispersion decides direction.** Statistics, not vibes, distinguish "fix the code" from "amend the law."
- **Constitutional minimalism.** A twelve-assertion program gets read; a sixty-assertion one gets rubber-stamped.
- **The observer is observed.** Judges live in `.program/`, take a bar exam on the case law, and get drift-checked against a frozen golden sample.

## Repository Reporting

`gwtp report` is an editorial lane for the **Git With the Program** campaign and series on lifehacker.dev. Select a local repository and a commit or branch tip; GWTP collects a bounded history sample, patches, branch/tag information, sample trends, and optional GitHub PR/issue evidence. It prepares a source-grounded brief for an AI reporter, separately from the governance judge, without changing the source repository, `.program/`, or ledger.

Install dependencies with `npm install` (Node 22 or newer). From this directory, prepare a bundle without making a model call:

```bash
npm run gwtp -- report --repo ../git-with-the-program --site ../lifehacker.dev \
  --out /tmp/gwtp-report-first --ref HEAD --limit 20
```

The output directory must not already exist, its parent must exist, and it must be outside both the analyzed repository and publication site. It contains `evidence.json` and `agent-prompt.md`; keep it as the review/audit record. Only committed history is included, not local edits. GitHub access is opt-in, requires authenticated `gh`, and never guesses a repository from credential-bearing remotes:

```bash
npm run gwtp -- report --repo ../git-with-the-program --site ../lifehacker.dev \
  --out /tmp/gwtp-report-github --ref main --since 2026-09-01 --limit 30 \
  --github bamr87/git-with-the-program --pr 1 --issue 2
```

`--pr` and `--issue` are repeatable selectors. Without explicit numbers, `--github` collects bounded recent PR/issue context. A commit SHA can be supplied as `--ref` to study the history ending at that commit; `--limit 1` focuses on that commit. A branch name selects its reachable history, not a branch comparison. Missing forge access, shallow history, truncation and sample-only trend limitations are exposed in the evidence, not represented as complete history.

After inspecting a prepared bundle for private material, invoke a fresh run with `--run` to send the evidence to lifehacker.dev's configured AI service:

```bash
npm run gwtp -- report --repo ../git-with-the-program --site ../lifehacker.dev \
  --out /tmp/gwtp-report-draft --ref HEAD --limit 20 --run
```

This uses the site's `scripts/ai/run.sh` with its text-only API path (`AI_FORCE_API=1`). The default provider is Anthropic and requires `ANTHROPIC_API_KEY`. `--provider openai` uses `OPENAI_API_KEY` and `gpt-4.1` unless `OPENAI_MODEL` is set. Either call may incur API charges. A Claude Code OAuth login alone is not sufficient. This deliberately avoids the runner's tool-enabled agent and automatic formatting of unrelated Markdown changes; no new provider or scheduler is introduced. The AI returns a structured article or an explicit no-story reason. GWTP checks its response and citation IDs, writes `result.json`, and creates a **`published: false`** article under `pages/_posts/field-notes/` with campaign, voice, series and evidence-digest metadata. A missing credential/no-output runner is an error, not a successful draft. Existing output files are never overwritten. Neither command commits, pushes, opens a PR, or publishes.

The complete AI prompt is limited to 96 KiB for compatibility with the shared runner. Oversized runs retain their prepared bundle but refuse the model call; reduce `--limit`, narrow `--since`, or select fewer PRs/issues. GitHub items are current metadata, not historical snapshots or full PR diffs, comments, reviews, or CI results. The explicit GitHub slug is operator-supplied and is not verified against the local repository.

A repository can also keep its own retrospective record. IT-journey's first installment is `docs/git-archaeology/000-first-steps/` in that repository: an evidence index plus a report that separates observed Git facts from inference. That record examines the 2020-07-30 root and the five commits through 2020-07-31. It is not a governance verdict, and it does not publish the local paths found in the original commits.

The brief calls for narrative reporting, technical critique, entertaining framing, source-versus-inference distinctions and conditional ownership disclosure. Repository text is untrusted data, not agent instructions. Citation checks establish that cited evidence exists, not that every interpretation is correct: a human must verify claims, redact sensitive material, generate preview art if appropriate, run the site's content gates and review before setting `published: true`. Retain the evidence bundle, especially for local-only repositories whose commits have no public source links. Campaign policy lives in lifehacker.dev's `_data/campaigns/git-with-the-program.yml`; the series landing page is `/series/git-with-the-program/`.

## Status

The TypeScript CLI implements validation, ledger, judge, distillation, program inspection, Nexus and repository reporting commands. Run `npm run gwtp -- --help` for the current command surface and `npm run ci` for the local verification suite. The specs and seed prompts retain the design and implementation history.
