# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This is a **seed package, not a codebase**. As of the `init` commit it contains only specs, schemas, ADRs, judge prompts, and this repo's own `.program/` constitution. There is no `src/`, no package manager, no CI, and therefore **no build/lint/test commands yet** — they are created by SEED-01.

Implementation proceeds through four ordered seed prompts in [seeds/](seeds/), each meant to be run as its own Claude Code session: SEED-01 (scaffold + `gwtp validate` + CI) → SEED-02 (ledger engine) → SEED-03 (judge harness) → SEED-04 (distillation miner). Each seed lists required reading, deliverables, constraints, and acceptance checks. Do not skip ahead; each seed's prerequisite is the previous one merged.

**The stack is undecided.** [docs/adr/0006-reference-stack.md](docs/adr/0006-reference-stack.md) is `Status: Proposed`, leaning TypeScript for v0. The first act of SEED-01 is to flip it to Accepted with a justification, then scaffold accordingly. Until then, `schemas/*.schema.json` is the only binding contract.

CLI surface the seeds are required to build: `gwtp validate` (SEED-01) and `gwtp ledger append|fold|replay|status` (SEED-02). Post-seed additions: `gwtp nexus build|status|defs|imports|importers|callers|seams|ring` and `gwtp judge --ring` (ADR-0007, spec 05).

## The core idea in one paragraph

The **program** (`.program/`) is a generative model of the repo; commits are observations; drift verdicts are prediction error; accumulated surprise past a per-assertion budget fires a proposal; and the **dispersion** of the contributing evidence decides whether the proposal points at the code (*refactoring recommendation* — one author, one seam, tight window) or at the program itself (*reprogramming proposal* — many authors, many paths, sustained). That bidirectionality is the whole point: a system that can only enforce intent is a nag. [docs/vision.md](docs/vision.md) has the predictive-processing mapping, which is load-bearing rather than decorative — design questions get answered from it.

## Architecture

Read the four specs before touching anything they govern; they are the source of truth and are more precise than this summary.

| Area | Spec | What it fixes |
|---|---|---|
| Core memory | [docs/spec/01-core-memory.md](docs/spec/01-core-memory.md) | `.program/` layout, the assertion atom, status lifecycle, precedents, manifest |
| Ledger | [docs/spec/02-ledger.md](docs/spec/02-ledger.md) | Event store on `refs/program/ledger`, the fold, firing + dispersion, compaction |
| Judge | [docs/spec/03-judge.md](docs/spec/03-judge.md) | The judgment ladder, blindness rules, output contract, panels, bar exam |
| Distillation | [docs/spec/04-distillation.md](docs/spec/04-distillation.md) | Cold-start bootstrap: fact miner, epochs, synthesis, ratification, backfill |
| Nexus | [docs/spec/05-nexus.md](docs/spec/05-nexus.md) | The perception layer (ADR-0007, clean-room GitNexus adaptation): derived code knowledge graph in `src/nexus/**`, cached gitignored under `.gwtp/nexus/`; context rings, seams, negative-space queries. Identity-free by construction — it may never read git log/blame, `accumulators/`, or the ledger, and no blind dir may import it until the INV-003 scope amendment ratifies (`proposals/PROPOSED-nexus-amendment.md`) |

Three structural facts that span multiple files:

1. **Two stores with different politics.** `.program/` is in-tree, normative, human-ratified-PR-only. The ledger is an out-of-tree ref (`refs/program/ledger`, event-sourced, content-addressed under `events/` with derived `accumulators/`), machine-append-only. Tooling must handle a non-default ref: explicit fetch config, push-with-retry (fetch → set-union merge → fast-forward). Forks inherit the law; the surveillance does not travel.

2. **The judgment ladder is a cost ladder.** deterministic check → hybrid prescreen → single LLM judge → panel of 3 → human. One assertion, one diff, one invocation. Each rung *supersedes* the previous as a ledger event; nothing is edited. Verdict cache key is `assertion-id + hunk-hash + judge-hash`, which is also the event store's idempotency key.

3. **Judges are part of the constitution.** Seated judges (model id + prompt sha256) live in `.program/manifest.yaml`. Editing [prompts/invariant-judge.md](prompts/invariant-judge.md) or [prompts/regression-judge.md](prompts/regression-judge.md) *is* seating a new judge — it changes the prompt hash and requires a ratified PR plus a passing bar exam against `precedents.yaml`.

## Rules that constrain how you may work here

- **Never write to `.program/` as an automated actor** (INV-001, precision 1.0, budget 1.0 — a single breach fires immediately). Changes to charter, invariants, trajectory, precedents, scope, or manifest arrive only as human-reviewed ratification PRs. If work implies an amendment, propose it in the PR body and let the human make the edit.
- **`status` is a lifecycle, not a flag.** `inferred` (distillation may emit this and nothing else; never enforced) → `ratified` (human promotion only) → `contested` (auto-set when a reprogramming PR opens; enforcement mutes) → `amended` | `retired`.
- **INV-001 … INV-006 are ratified and therefore enforced** (commit `f9e61ec`, merged as PR #1 — the framework's own ratification ritual, performed by hand). They are live law, not aspiration; the invariants below are requirements on the code, and their scopes point at real directories. `.program/scope.yaml` was *not* amended, so `src/**` is still unclaimed by the program — which per spec 01 §6 is exactly the obsolescence baseline. The pending amendment is in [proposals/](proposals/); applying it is a human's call.
- **Do not change `docs/spec/**` or `schemas/**` semantics while executing a seed.** Ambiguities go to `docs/spec/OPEN-QUESTIONS.md` (create it) with the least-committal interpretation chosen.
- **Module headers cite the spec section they implement** (a SEED-01 constraint that carries forward).

## Invariants the implementation must satisfy

These are this repo's own laws ([.program/invariants.yaml](.program/invariants.yaml)) and they dictate code structure, not just review taste:

- **INV-003 — blindness is structural, not conventional.** The evidence assembler must be *incapable* of reading author identity or `accumulators/`; enforce via module/type boundary so a violation fails to compile or raises, and test that. Authorship appears only in dispersion computation at firing time. Rationale in [docs/adr/0003-judge-blindness.md](docs/adr/0003-judge-blindness.md): accumulation assumes conditionally independent samples, and a judge that can see the meter destroys that.
- **INV-005 — `src/core/**` imports no forge-specific APIs.** All GitHub access lives under `adapters/`; a bare git repo must degrade to commits-only.
- **INV-002 — ledger events are never mutated or deleted.** Corrections emit a `supersedes:` event; the fold takes the tip of each chain.
- **INV-004 — no citation, no verdict.** Violation verdicts require `file:line-span` evidence and one of exactly four anchored severities (`grazes|bends|breach|entrenches` → 0.25/0.5/0.75/1.0). `abstain` never accumulates; it escalates with a wider context ring.
- **INV-006 — everything validates against `schemas/` in CI.**

## Load-bearing math and its edge cases

Accumulator, per assertion, on each **violating** event only (`drift`/`regression`/`stale-claim` — never `aligned`, never `abstain`):

```
A ← A · 2^(−Δt / half_life) + precision_at · severity
```

- **Δt is committer time**, not observation time ([ADR-0004](docs/adr/0004-committer-time-decay.md)). This is what makes distillation backfill safe: an 8-month-old breach against a 90-day half-life arrives at ~15% strength. Events on rebased-away SHAs are kept and marked `orphaned`.
- **Aligned events do not pay down the accumulator.** Compliance is *counted* (the ratio ships in every proposal as evidence quality) but subtracts nothing. Decay is the only forgiveness. This asymmetry is deliberate — without it, high-traffic repos never fire.
- **Hysteresis, not reset.** After firing, re-arm only below ~50% of budget.
- **The fold must be pure**: same event set + same knobs → identical state, verified by property test. `--replay` recomputes with overridden knobs for counterfactuals.
- Rejected proposal → `affirmed` precedent *and* precision rises. Accepted → amendment PR, assertion `amended`, accumulator zeroes. Ignored → governance debt.

## Vocabulary

[GLOSSARY.md](GLOSSARY.md) is short and worth reading in full — the terms (program, ledger, assertion, precision/budget/half-life, verdict, drift, dispersion, precedent, tombstone, bar exam, epoch, watermark) are used precisely throughout the specs and prompts, and imprecise use in code or PR text is itself a defect here.

## Self-hosting obligation

GWTP runs its own loop on its own repo as soon as v0 exists (TRJ-003; [.program/charter.md](.program/charter.md)). Changes to this repo are expected to be judged by it — which means the framework's own code is the first thing its invariants are enforced against.
