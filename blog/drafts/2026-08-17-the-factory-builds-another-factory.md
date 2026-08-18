---
title: "The Factory Builds Another Factory: Sweeping the Backlog and Orchestrating a Sibling Repo"
description: "One session, two workstreams: seven parallel agents clear every locally-fixable defect in GitFactory, and GitFactory's compiler starts managing law-ai's AI orchestration — three governed agent lines, generated, never hand-written."
date: 2026-08-17
categories: [it-journey, ai-engineering]
tags: [claude-code, github-actions, multi-agent, compilers, sdlc, least-privilege, orchestration]
draft: true
---

Yesterday GitFactory absorbed law-ai's AO-SDLC development loop. Today the loop got its first real workout — "fix all issues, and make GitFactory manage law-ai's AI orchestration" — and both halves ran as spec packages through the machinery installed twenty-four hours earlier.

The issue sweep started with a gift: the repo had zero open issues but three open PRs, and one of them — a draft filed by the fleet's own automation — documented a live incident worth more than any bug report. Factory 3, the dependency warden, had starved at its turn cap on every scheduled run since deployment: the compiler told every agent to "read and follow the operating instructions in your prompt file" while granting file-read tools only to agents whose sinks happened to be file-writing ones. A comment/label/merge line was ordered to read a file it could not open, and burned 12 of 26 turns on permission denials. The fix is one `if` block; the lesson is an invariant — *if the emitted prompt orders a read, the emitted grant must contain Read* — now pinned by a table-driven test across five line shapes, and all four deployed factories were regenerated from their blueprints to carry it.

The rest of the sweep ran as seven parallel agents on disjoint file sets: invariant tests for the last two untested machine types, per-type config subschemas with a registry↔schema drift guard (dependency-free, in the house style), a committed idempotent regen script for the reference outputs, four small UI fixes plus an error boundary, a first lint toolchain tuned to the code rather than the code mass-edited to the toolchain, a Pages deploy finally chained onto CI success, and a sweep that traced every absolute-date fixture to prove no more time bombs are ticking. The one cross-agent collision — a regenerated lockfile silently dropping a testing peer dependency — was caught because agents report blockers, not just successes.

The second workstream is the fun one. law-ai's development loop had an automated deterministic half (a weekly audit that appends findings to its backlog) and a manual agentic half (a tracking issue politely asking a human to run `/evolve`). Now GitFactory compiles that missing half: a target-repo generator stamps three blueprints into law-ai and compiles them with gitorio's own compiler — an evolve pilot (weekly, one AO-SDLC cycle, one PR, never merges), a backlog triager (monthly reconciliation, append-only), and an issue concierge (label + one deduped comment, bot-guarded). Every line ships default-OFF behind its own repo variable; arming is a human flipping a switch. The prompts are honest about their grants: the pilot's tool ceiling has no `make` or `pytest`, so it says so and defers every heavy gate to CI on its own PR instead of pretending it verified something it couldn't run.

The gnarly problem was neither workstream — it was the seam between them. Editing law-ai's spec files tripped gitorio's brand-new enforcement hook, which derived "the repo root" from the shell's working directory and tried to gate a sibling repo's specs with gitorio's tool paths. Cross-repo work found the bug the single-repo adversarial review couldn't: assumptions about *where you are* only break when you go somewhere else.

## Working-with-AI tip

Give autonomous fixers a *blockers* field, not just a result field. The lockfile regression in this session was invisible to the agent that caused it and fatal to the full test suite — but the agent it collided with reported the collision as a first-class output ("the lockfile owner should restore this dependency"), which turned an hour of future debugging into a one-line pin. Structured agent reports beat transcripts precisely because you can make "what should the orchestrator worry about" a required key.
