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

Six components, five specs, one loop:

| Component | Spec | One-liner |
|---|---|---|
| Core memory | [docs/spec/01-core-memory.md](docs/spec/01-core-memory.md) | Two stores with different politics: normative `.program/` (human-ratified) vs. observational ledger (machine-append) |
| Ledger | [docs/spec/02-ledger.md](docs/spec/02-ledger.md) | Event-sourced, content-addressed, conflict-free; leaky-integrator accumulators; dispersion decides firing direction |
| Judge | [docs/spec/03-judge.md](docs/spec/03-judge.md) | Bench of narrow magistrates; author-blind and accumulator-blind; anchored ordinal severity; precedents as bar exam |
| Distillation | [docs/spec/04-distillation.md](docs/spec/04-distillation.md) | Two-pass bootstrap: deterministic fact miner + LLM law-namer; epoch segmentation by change-point detection; ratification ritual |
| Nexus | [docs/spec/05-nexus.md](docs/spec/05-nexus.md) | The perception layer: a derived, identity-free code knowledge graph (a clean-room [GitNexus](https://github.com/abhigyanpatwari/GitNexus) adaptation, ADR-0007) powering context rings, seams and negative-space proofs |
| Vision | [docs/vision.md](docs/vision.md) | Why bidirectionality is the point, and the predictive-processing frame behind the design |

## Repo layout

```
.program/          This repo's OWN program (dogfood, status: inferred — ratify it first)
docs/vision.md     Conceptual foundation
docs/spec/         The five component specifications
docs/adr/          Architecture decision records (the irreversible choices)
schemas/           JSON Schemas: assertion, event, verdict, precedent, nexus
prompts/           Judge prompt templates (invariant judge, regression judge)
seeds/             Claude Code seed-session prompts, SEED-01 → SEED-04
posts/             it-journey draft posts documenting the build
ROADMAP.md         v0 → v2 slices
GLOSSARY.md        The vocabulary, in one place
```

## Getting started (building the framework)

1. **Ratify this repo's own program.** Open `.program/` — every assertion is `status: inferred`. Review, edit, flip to `ratified` in your first PR. The first ritual of the framework is performing the framework.
2. **Run SEED-01.** Point a Claude Code session at [seeds/SEED-01-scaffold.md](seeds/SEED-01-scaffold.md). It scaffolds the engine workspace, wires schema validation, and sets up CI.
3. **Proceed through the seeds in order.** SEED-02 (ledger engine) → SEED-03 (judge harness) → SEED-04 (distillation miner). Each seed states its objective, required reading, deliverables, and acceptance checks. Each ends by validating against `schemas/`.
4. **v0 target:** a repo that is *sighted* — hand-authored program, deterministic judges only, live accumulators, and issues filed on threshold crossings. No LLM in the loop yet. See [ROADMAP.md](ROADMAP.md).

## Design principles (the short list)

- **Program is sacred, ledger is profane.** Humans ratify law; machines append observations. Never mix the write paths.
- **Verdicts are facts.** Judges may be stochastic; the fold over their recorded verdicts is deterministic. Re-judging supersedes, never edits.
- **No citation, no verdict.** A violation that can't point at lines doesn't exist.
- **Decay is the only forgiveness.** Compliance is counted but never pays down the accumulator.
- **Dispersion decides direction.** Statistics, not vibes, distinguish "fix the code" from "amend the law."
- **Constitutional minimalism.** A twelve-assertion program gets read; a sixty-assertion one gets rubber-stamped.
- **The observer is observed.** Judges live in `.program/`, take a bar exam on the case law, and get drift-checked against a frozen golden sample.

## Status

Design complete (2026-07). Implementation not started. This package is the seed: specs, schemas, decisions, prompts, and its own constitution, ready for an agentic build.
