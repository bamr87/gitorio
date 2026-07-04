---
title: "Fixing the Class, Not the Instance: A Loop-Guard Bug and Live Telemetry"
description: "A security fix that started as one reported bug and turned out to be a whole class of it, plus a poll-don't-push telemetry layer that lights up the factory floor — both shipped green with the contract-first agent pattern."
date: 2026-07-04
categories: [it-journey, ai-engineering]
tags: [github-actions, security, claude-code, telemetry, react, multi-agent, compilers]
draft: true
---

Two things this session: kill a security bug in the compiler, then keep the loop running
into Phase 4 — telemetry. Both landed green (66 tests, up from 52).

## The bug was one instance of a class

The reported bug: GitFactory's compiler guarded issue/PR/comment workflows against
self-retriggering by checking `github.event.issue.user.type != 'Bot'` — but for an
`issues.labeled` event that's the wrong identity. The actor who *applied the label* is
`github.event.sender`, not the issue **author**. So a bot labelling a human's issue sailed
past the guard, and `issue_labeled → agent → sink.label` could feed itself forever.

The tempting fix is to special-case `labeled`. But the moment you name the root cause —
*"we guarded the entity author instead of the event actor"* — you see it isn't one bug.
The exact same hole exists for `pull_request.synchronize`: the actor is the *pusher*, not
the PR author, so an agent pushing a commit would slip the same guard. One reported
instance, two live holes, same root cause.

So the fix collapses three checks into one actor check:

```diff
-      if (hasIssueish) guards.unshift(`github.event.issue.user.type != 'Bot'`);
-      if (hasPr)       guards.unshift(`github.event.pull_request.user.type != 'Bot'`);
-      if (hasComment)  guards.unshift(`github.event.comment.user.type != 'Bot'`);
+      guards.unshift(`github.event.sender.type != 'Bot'`);
```

Before widening scope, I checked the change is **equivalent-or-better everywhere**: for
`opened` and `issue_comment`, `sender` *is* the author, so the output is unchanged; for
`labeled` and `synchronize` it's strictly more correct. That equivalence proof is what
makes broadening a one-line bug report into a class fix safe rather than reckless.
Regression tests now pin both the labeled and synchronize cases.

## Telemetry: poll, don't push

Phase 4 lights up the factory floor. The constraint is the whole project's premise: no
backend. So telemetry is **polite polling**, not webhooks — a conditional GET on
`/actions/runs` with `If-None-Match`; a `304 Not Modified` costs zero rate quota. Polling
starts when you open the telemetry panel and stops when you close it: only the factory
you're looking at burns requests.

The nice structural bit: to turn a `factory--issue-triage-line.yml` run back into *which
machines on the canvas should glow green*, the compiler already knew the mapping — it
partitions the graph into assembly lines to name the files. I extracted that into an
exported `assemblyLines()` so telemetry and the compiler share one partitioner and the
slugs line up by construction, not by coincidence. Pure mapping/stats (`telemetry.ts`, 11
tests) stayed split from the polling I/O.

## Working-with-AI tip

**When an agent hands you a bug fix, make it name the invariant that broke — then grep for
every other place that invariant is violated.** "Fix the `issue_labeled` guard" produces a
patch; "the guard must check the event *actor*, not the entity author" produces a search,
and the search found the `synchronize` hole the report never mentioned. The discipline that
keeps this from turning into scope-creep: before you widen the fix, prove the new behavior
is *equivalent* on the cases that already worked (here, `sender == author` for `opened`),
so you're only *adding* correctness, never trading it. A fix that's provably equivalent on
the happy path and strictly better on the edge cases is one you can ship without a second
guess — and one whose regression tests write themselves, because you already enumerated the
cases.
