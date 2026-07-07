---
title: "A Five-Tab Shell, and the Fan-Out That Never Ran"
description: "Turning a single-canvas MVP into a feature-rich, production-ready front end — Build, Prompts, Monitor, Fleet, Settings — and the sharpest lesson of the session: a four-agent parallel plan that produced exactly zero lines of code because the workers inherited a model they had no credit for."
date: 2026-07-05
categories: [it-journey, ai-engineering]
tags: [react, zustand, github-actions, claude-code, multi-agent, subagents, frontend, tooling]
draft: true
---

The ask was blunt: *"finish the other phases of the original plan. refactor the front end
with better configuration, controls, monitoring, and organization… make this production
ready and fully tested."* GitFactory had a great canvas and almost no scaffolding around
it — you could build a factory, but you couldn't *run a shop* out of it. This session built
the shop.

## The shell is one store field, not a router

The front end graduated from a single canvas to a **five-tab shell**: Build · Prompts ·
Monitor · Fleet · Settings. The temptation with "five views" is to reach for a router — a
dependency, a URL scheme, a layout layer. But this is a single-view-at-a-time tool; you're
never looking at Monitor *and* Build at once. So the whole shell is one field in a tiny
store:

```ts
type AppView = 'build' | 'prompts' | 'monitor' | 'fleet' | 'settings';
// useUiStore.view drives which panel mounts. That's the router.
```

Each tab is a self-contained panel over *its own* store — `state/monitor`, `state/prompts`,
`state/fleet`, `state/settings` — and the cores that took months to get right (the pure
compiler, the ETag telemetry poller, the deploy planner) were **not touched**. That's the
shape you want when "add a whole feature area" has to not destabilize the parts that already
work: new surface area is new stores + new panels, and the deep-linking between them is just
`setView('monitor')`.

What actually landed on top of that shell is the backlog finally coming due:

- **Prompt Studio** (Phase 5) — browse/edit `.factory/prompts/`, frontmatter-as-a-form, a
  live linter where a committed-secret regex is a *hard* save-block (not a warning), a diff
  view, and PR-by-default writes on a `factory/prompts-*` branch.
- **Monitor** (the Phase-4 remainder) — per-line stats, jobs→steps drill-down, and **▶ Run
  now / ✕ Cancel**, backed by three new client methods (`dispatchWorkflow`, `cancelRun`,
  `listRunJobs`) and a cron util that warns about overlapping or heavy schedules *before* you
  deploy them.
- **Three new machines** — `gate.approval`, `rate.limiter`, `sink.cross_repo_issue` (Phase-6
  gates + the Fleet-C cross-repo edge), taking the catalog to **19 machine types**, each with
  a registry entry, an emitter, and an invariant test — plus a drift-guard test that fails CI
  if the registry, the schema enum, and the compiler ever disagree about what a machine is.
- **Fleet B** — a multi-repo observe switcher: chips for recent repos, an arbitrary
  `owner/name` box, `settings.recentRepos` persisting **slugs only, never tokens**.
- **Undo/redo, palette search, a template gallery** — the canvas ergonomics an actual
  builder needs.

Roughly 170 tests across 20 files, typecheck clean, prod build clean, and every tab
browser-verified live against this very repo: Monitor showed seven real runs with a live
job drill-down, Fleet imported gitorio's own five workflows, Prompt Studio loaded the real
prompts off disk.

## The gnarly problem: a fan-out that produced nothing

Here's the part worth writing down, because it cost real time and it's the kind of failure
that hides.

Five workstreams, cleanly separable by owned files (machines, Monitor, Prompt Studio,
Settings/Fleet). Textbook contract-first parallelism: define the store interfaces up front,
commit the shell as a stable base (so nobody races on `App.tsx`), then fan four agents out
over the four independent areas. I wrote the contracts, committed the base, launched all
four.

All four came back **instantly**, each with the same terminal error — a credit limit on a
model none of them should have been using — and **zero output**. Not partial work. Not a
merge conflict. Nothing.

The root cause is a sharp edge: **subagents inherit the parent session's model.** The
session happened to be pinned to a constrained model tier at launch time, every child was
spawned onto that same tier, and every child hit the wall before emitting a single token. A
perfectly good decomposition, executed by workers that couldn't execute.

The fix wasn't clever — it was to stop pretending the fan-out happened and **rebuild all
four workstreams solo, in the main loop, on a model that could actually run.** Each became a
clean, separately-tested checkpoint commit. Same contract-first plan; just one worker instead
of four. The plan was never wrong. The *substrate* was.

## Where I stopped, honestly

Two things stayed parked, and both are parked for a *reason* worth stating rather than a
TODO worth hiding:

- **GitHub App device flow (Phase 7).** I verified it directly: GitHub's
  `login/device/code` endpoint serves **no CORS headers** to a browser origin. A pure-static
  SPA physically cannot complete device flow without a token-exchange worker — which would
  break the "no backend" premise this whole project is built on. PAT-in-`sessionStorage`
  stays the auth path; the new Settings tab surfaces a live preflight and connection switcher
  instead. That's not a shortcut; it's the correct boundary.
- **Belt mode and the §8 red-team pass.** Both want a live scratch repo and their own
  session. Faking either in this one would've been theater.

## Working-with-AI tip

**When you fan work out to parallel agents, treat the fan-out itself as a step that can
fail — and verify it *ran* before you assume it *helped*.** A contract-first split feels like
the work is done the moment you've drawn the boundaries, but a decomposition is worthless if
the workers can't execute, and "0 output" from an agent is a *hard signal*, not a flake to
retry blindly. Two concrete habits fell out of this:

1. **Check what your subagents inherit before you spawn them** — model tier, credit,
   tool grants. Children adopt the parent's substrate; a constrained parent silently
   constrains every child. If the task needs a capable model, confirm the *children* have it,
   not just you.
2. **Have a solo fallback ready and don't sink cost chasing the parallel path.** The instant
   all four agents returned empty, the right move was to stop debugging the fan-out and just
   build it in the main loop. The parallel plan wasn't discarded — the file-ownership split
   still structured the solo work into four clean commits. Parallelism is an *optimization*
   over a good plan, not the plan itself. When the optimization fails, you should still have a
   plan to fall back to — and if you don't, that's the real bug.

The meta-lesson: the most convincing-looking progress is a fan-out you *launched* but never
confirmed *landed*. "I parallelized it" and "four agents each shipped tested code" are very
different claims. Only one of them survives a `git log`.
