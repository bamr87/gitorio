---
title: "The harness renders the same: porting a Python scorecard so a design tool and a Jekyll dashboard agree"
description: "GitFactory designs GitHub agent harnesses; the bamr87 hub presents and monitors them. This session made the two agree — a ported engine with a golden file, a shared lane vocabulary, and a bundle budget that bit twice."
date: 2026-09-02
categories: [it-journey]
tags: [gitfactory, harness, jekyll, github-actions, typescript, python, parity-testing, bundle-size, claude-code, ao-sdlc]
draft: true
---

## The ask

The request was short and ambitious: GitFactory should have the same style and features as the hub's `/harness/` page, a harness built in either place should render the same in both, and the two should be tightly integrated — GitFactory as the tool that designs, models and deploys AI agent harnesses for GitHub, and the bamr87 monorepo as the Jekyll site that presents and monitors them.

"Render the same" is the kind of phrase that can mean a pixel copy. It cannot mean that here: GitFactory already has a design system (archify's Evidence Console, adopted over the previous three sessions), and the hub uses Bootstrap under a Jekyll theme. Two design systems in one app is the wrong trade. So the first decision was the definition: the same anatomy, the same vocabulary, the same thresholds, the same statuses and the same numbers — drawn in the console's tokens.

## Verify what the hub commits before building anything

The earlier spec that touched this area assumed the hub kept a `harness_registry.yml`. It does not. What it commits is `_data/harness_health.yml`, *generated* every morning by a small Python module, `dash-gen harness`, from four other committed files: Actions usage, fleet triage, the issue pipeline, and a token-rotation ledger. The thresholds live in `_data/fleet.yml`. The page itself is a Liquid template over that one file, plus five archify diagrams.

That changes the shape of the work entirely. There is no API to call and no page to scrape. There is a pure function — signals in, health out — and a file that proves what it produced on a given day.

## Parity is a ported engine and a golden file

The engine was ported to TypeScript as a pure module. The interesting part was not the arithmetic but the formatting: the trip-wire summaries are text the hub prints, so a float that Python renders as `3.0` must not come out as `3` in JavaScript, and Python's `round` is half-to-even. The golden test takes the hub's four input files and its output file from one commit and asserts the port reproduces the output from the inputs.

The commit choice mattered. The generator ran on the tree of the daily pulse commit; by the time the branch head was cloned, one of the inputs had been regenerated an hour later. Taking the inputs from HEAD would have broken parity for a reason that had nothing to do with the port. The fixtures are pinned to the pulse commit and say so in a `SOURCE.md`.

With the engine in hand, the Harness tab does something a screenshot could never do: it reads the hub's committed file *and* re-runs the engine over the hub's committed signals, then prints a note saying whether every value, status and wire matches. The note is computed, not asserted.

## One vocabulary in three places

The integration contract was already there, written by a tool neither project owns: `wtd`'s `fleet/v1` manifest, a `fleet.manifest.yml` that lists a repo's "lanes" — id, kind, harness, triggers, kill switch, tokens, guardrails. The hub reads it. GitFactory now compiles its blueprints to the same lanes and a parity test pins them to the manifest `wtd fleet adopt` wrote for the repo itself, field by field. One small React card draws a lane, and it appears in three places: the Blueprint passport on the floor, a workflow's passport when Fleet Observe imports a repo (the import now fetches the manifest beside the workflows), and the Harness tab.

The only fields excluded from the parity test are `kind` and `triggers`, because `wtd` derives them from workflow names and prompts, while GitFactory derives them from structure. Where the manifest says `other`, the blueprint knows it is `triage`. That gap became the first follow-up: GitFactory's deploy should write the manifest with declared provenance, so the hub reads the structural truth.

## Design readiness: the playbook as compiler facts

The hub's operator guide describes a harness in six layers — guides, sensors, bounded loop, memory, permissions, observability — and a twelve-row production-readiness checklist. GitFactory's machines *are* those layers as parts: a prompt reference is a guide, a verification grant is a sensor, a rate limiter bounds the loop, the ledger is memory, the enablement gate and the compiled permissions block are the boundary, and the compiled workflow is what telemetry observes. So readiness is graded from the blueprint and the compiler's own facts, per line, with the agent-only layers reading *n/a* on deterministic lines.

One rule came out of a failing test: the gardener line was graded "warn" for carrying three write scopes, and one of them was `id-token: write`. That scope is the action runtime's OIDC requirement, not a sink's reach. It is now excluded before counting.

## The bundle budget bit twice

The spec allowed the initial JavaScript bundle to grow by 12 kB. The first build grew it by 28. The tab itself was already a lazy chunk; what leaked was the engine, pulled into the first paint by two static imports — the hub store (imported by the app shell for deep links) and the demo client (which generates a fictional hub's files with the real engine). The fix was three dynamic imports: the hub reader loads when a refresh is requested, the demo hub's tree loads when it is first read, and the manifest emitter loads with it. That landed at +6.4 kB raw.

The second bite was subtler. The lazy seeding set a "seeded" flag before awaiting the import, so when a fleet import fired eight file reads in parallel, seven of them saw the flag and returned an empty tree. Four tests went red at once. The repair is the classic one — store the seeding *promise* and have every reader await it — and it is the kind of race that only shows up when a real caller is concurrent.

## Working-with-AI tip

Ask the agent to verify the target's *artifacts* before it verifies the target's *page*. The hub's page was a template; the thing worth matching was the generated file behind it and the function that made it. An agent that starts from the visible surface will happily reproduce a template with fake numbers; an agent told to find what is committed, at which commit, and by which generator, will find a pure function and a golden file — and then parity becomes a test rather than a claim.

Two smaller habits paid off in the same session. First, give bundle budgets to the agent as a hard number in the spec, then have it print the initial-module set from the built `index.html` rather than trusting chunk names — the chunk called `manifest` was the vendor bundle. Second, when the agent adds a lazy path, ask it to run a concurrent caller through it; the seeding race was invisible to every sequential test.

## Where it stands

Eight tabs, a hub store that reads and never writes, a demo hub generated by the real engine with one wire deliberately tripped, and a Chromium pass in both colour schemes with no console errors and no network calls. The follow-ups are filed: a declared-provenance manifest on deploy, live adapters for the two hub-only signals, readiness over observed fleets, two hub-side fixes GitFactory cannot make from here, and conditional reads so a refresh of eight files is free when the hub has not pulsed.
