---
title: "Seven Cycles on Autopilot: A Self-Pacing Loop Drives the Factory's Own SDLC"
description: "One /loop, seven AO-SDLC cycles: the framework fixes flow back upstream, agents earn exact-command verification grants, actions get pinned, merge policy compiles to YAML, lines get real names, and two repos grow a typed inter-repo belt."
date: 2026-08-18
categories: [it-journey, ai-engineering]
tags: [claude-code, autonomous-agents, sdlc, github-actions, compilers, cross-repo, least-privilege]
draft: true
---

The instruction was one line — keep growing these two repos until they're aligned and fully featured — and the mechanism was a self-pacing loop: wake, pick the top backlog item by the deterministic ordering, run it through the spec chain the repo itself enforces, verify every gate in both repos, mirror the follow-ups, schedule the next wake. Seven cycles ran before the backlog's remaining weight shifted from "implementable" to "needs a human decision," which is the loop's own stop condition.

Cycle one paid the alignment debt: every hardening fix the gitorio port's adversarial review had found went back upstream to law-ai as its own spec — the lifecycle-blocking placeholder gate, the append-only check that was a no-op in CI, the audit dedup that re-appended the same findings forever, plus the picker scripts that had been stranded in a stale worktree. The donor repo ended up healed by its own transplant.

Cycles two through seven were feature work, each a full spec package with its ADR: `checks` (an agent declares its repo's verification commands; each compiles to exactly that `Bash(<command>:*)` grant plus a VERIFY obligation — law-ai's evolve pilot can now run the validators it edits against); SHA-pinned actions mode (a curated, upstream-verified pin table — the compiler stays pure, and a two-way drift guard ensures no emitted ref escapes it); the label-gated merge line (July's incident finally closed structurally: the label IS the merge policy, compiled, with zero agent judgment in the merge path); per-line names (lines named by what they are, computed in the one helper both the compiler and telemetry share); and a typed inter-repo belt — a `repository_dispatch` trigger and sink pair whose protocol is an entity *number*, never payload text, whose agent grant is endpoint-exact, and whose compiler refuses self-dispatch loops at compile time.

The framework being built was also the framework doing the building. The blocking hook interrupted spec authoring four times — every time correctly (missing files, uncovered requirements, a stale status). The registry↔schema drift guard caught each new machine's paired schema edit. The picker's ordering decided the cycles. The follow-ups sections force-fed the backlog nine new items even as eight closed. A loop that must leave the task graph richer than it found it cannot quietly run dry.

## Working-with-AI tip

Give an autonomous loop a *deterministic* work-picker and an *append-only* ledger, then let the model spend its judgment on the work itself, not on choosing it. The severity/kind/age ordering lives in a forty-line script, which means every cycle's pick is predictable, auditable, and boring — and when the model deviates (skipping a blocked-on-human item, splitting an oversized one), the deviation is visible precisely because the default was mechanical. Judgment spent inside a deterministic frame compounds; judgment spent choosing what to do next just burns tokens re-litigating priorities.
