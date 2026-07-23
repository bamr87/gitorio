---
title: "Git with the Program: Teaching a Repo to Know Its Own Law"
date: 2026-07-23
draft: true
tags: [git, ai-agents, governance, llm-judges, event-sourcing, system-design]
---

*Draft for it-journey. Design thread → seed package; implementation starts next.*

Every long-lived repo has a program — an intent, boundaries, a direction — and almost none of them have it written down in enforceable form. Lint bots enforce the letter of rules nobody remembers ratifying. Architecture erodes one reasonable PR at a time. **Git with the Program** (GWTP) is a framework that distills a repo's git history into a versioned *core memory*, scores every change against it, and — here's the part that matters — knows the difference between "the code is wrong" and "the law is wrong."

## The hinge: bidirectionality

Forty commits pointing the same "wrong" direction can mean the program is stale, not the contributors. A system that only enforces intent is a nag; one that can also propose *amending* intent — through a sanctioned, human-ratified channel — is a governor. GWTP's two outputs: refactoring recommendations (assertion stands, fix the change) and reprogramming proposals (a PR against the constitution itself, carrying the evidence that the org already outvoted the statute in practice).

Which one fires is decided by **dispersion statistics** over the accumulated evidence. One author repeatedly hitting one seam in a tight window → refactor. Many authors independently hitting the same wall for months → reprogram. Statistics instead of vibes.

## Five mechanisms worth stealing

1. **Two stores, two politics.** The program (`.program/`, in-tree) is human-ratified law; the ledger (`refs/program/ledger`, out-of-tree ref) is machine-appended evidence. Never mix the write paths — that's how you get bots committing to governance files. Bonus from git itself: clones carry the program, but non-default refs don't fetch by default, so forks inherit the law and not the surveillance.

2. **Event-source the observations.** One content-addressed file per verdict; accumulators are a deterministic fold over the set. Concurrent CI writers merge as set union (hashes can't conflict), re-judging *supersedes* instead of editing, and you can retune sensitivity knobs retroactively and replay. When your writers are stochastic LLMs, "verdicts are recorded facts; the fold is deterministic anyway" is the whole ballgame.

3. **Evidence accumulation, not tripwires.** Each assertion carries precision (weight per violation), budget (firing threshold), and half-life (decay). The accumulator is a leaky integrator: `A ← A·2^(−Δt/τ½) + p·s`. Compliance is counted but never pays down the meter — decay is the only forgiveness — and hysteresis (re-arm below half budget) stops flapping. This is what kills bot-nagging fatigue on principled grounds: act on accumulated surprise, never single deviations.

4. **Blind the judges.** LLM judges never see the author (verdicts attach to conduct; demography happens downstream) and never see the accumulator — a judge who knows the meter reads 2.7 of 3.0 will find the breach, verdicts autocorrelate, and accumulated surprise stops being evidence. Evidence accumulation assumes conditionally independent samples; protect that assumption structurally.

5. **Case law as test suite.** Reverts and fix-commits are free labeled data. Mined into precedents, they do triple duty: the regression judge matches new diffs against killed patterns by analogy; any *new* judge (model or prompt change) must re-decide the settled cases — a bar exam — before it may sit; and human rejections of inferred rules become tombstones so the system can't re-propose them.

## Bootstrapping: the distillation walk

Cold start is the loop run in reverse — infer the model from observations. Two passes with strict division of labor: a **deterministic miner** walks every commit building a fact base (co-change graphs, import graphs per epoch, revert pairs, doc snapshots — the strongest laws live in *negative space*, and absence is exactly what a cheap exhaustive pass can prove), then **LLM synthesis** runs map-reduce over history epochs to *name* candidate laws, with provenance mandatory and `status: inferred` the only thing it may emit. Epoch boundaries come from change-point detection on the repo's own statistics, not calendar time.

Ratification is deliberately minimalist: ship the top ~12 candidates as a reviewable PR. A sixty-assertion day-one constitution gets rubber-stamped; a twelve-assertion one gets read. Then backfill the current epoch through the judges — and because decay runs on *committer time*, backfilled events arrive pre-decayed. The accumulators start warm instead of blind without firing on stale news. Mechanisms composing to solve problems you haven't hit yet is the tell that a design is load-bearing.

## Tips: designing systems *with* an AI, not just asking for one

- **Design by seam, one session-turn each.** Concept → memory schema → ledger → judge → distillation. Each turn ended by naming the next seam. Small decisive cuts beat one giant "design me a system" prompt: every turn's output was concrete enough to disagree with.
- **Demand decisive commitments, not option lists.** "Dedicated ref, not notes" with a one-line reason is reviewable; a survey of five storage options is homework. Make the AI take positions; you retain the veto — and the vetoes themselves are worth recording (they became ADRs here).
- **Import a real domain as a design generator.** The predictive-processing frame (program = generative model, drift = prediction error) wasn't decoration — it *answered questions*: why judges must be blind (independent samples), why thresholds beat tripwires (accumulate surprise), why backfill needs decay. Pick a mature field adjacent to your problem and mine its constraints.
- **Engineer around LLM weaknesses structurally, not with hope.** Can't calibrate floats → anchored ordinals. Hallucinates violations → no citation, no verdict. Non-deterministic → event-source the verdicts and keep the fold pure. Prompt changes shift behavior → hash the prompt into the judge's identity and make it pass a regression exam.
- **End design with a package, not a chat log.** Specs, ADRs, machine-readable schemas, seed session prompts with acceptance criteria, and the project's own dogfood constitution — a repo an agent can start building from cold. The conversation was scaffolding; the package is the artifact.

Next post: v0 build — the sighted repo.
