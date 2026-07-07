---
title: "The queue is GitHub itself: an issue-processing factory in two assembly lines"
description: "GitFactory learns to process issues end-to-end — a batcher agent groups related issues into work orders, a fixer agent turns each work order into one reviewable PR — with the queue stored as plain GitHub issues."
date: 2026-07-05
categories: [it-journey]
tags: [gitfactory, claude-code, github-actions, agents, issue-triage, automation]
draft: true
---

Until today GitFactory could triage a single issue (label it, summarize it) and tend docs on
a schedule. What it couldn't do was the thing an issue tracker actually fills up with: a
backlog of twenty half-related reports that somebody has to read, sort, cluster, and turn
into fixes. This session shipped that as a first-class capability — the **Issue Factory** —
with `bamr87/lifehacker.dev` as the worked example.

## The shape: sorter and fixer, never the same machine

The pipeline is two assembly lines behind one kill switch:

1. **Intake** (weekdays 06:00 UTC): a new machine type, `processor.issue_batcher`, surveys
   every open issue, labels the non-actionable ones `factory:needs-human`, groups the rest by
   shared root cause (it greps the checked-out code to confirm two issues really touch the
   same thing), and files **one work-order issue per group** — a task list of members, a
   root-cause hypothesis, a fix plan, acceptance criteria.
2. **Fix** (weekdays 07:00 UTC): a plain Claude agent picks the oldest open work order,
   implements the whole batch, and opens **one PR** whose body carries a `Closes #N` line per
   member issue. Merging stays human, forever.

The separation isn't prompt etiquette — it's compiled into the `--allowedTools`. The batcher
gets issue verbs only:

```yaml
--allowedTools "Read,Glob,Grep,Bash(gh issue list:*),Bash(gh issue view:*),...,Bash(gh issue create:*)"
```

No `Edit`, no `git push`, no `gh pr create`. The fixer gets the file/git/PR verbs but never
`gh pr merge`. A prompt injection in an issue body can't make the sorter write code or the
fixer land it.

## The gnarly problem: where does the queue live?

The obvious design was a `.factory/workorders.yml` file, symmetric with the CMS backlog. It
died on two grounds. First, permissions: queue bookkeeping would need `contents: write` on the
default branch for a machine whose whole point is that it *doesn't touch code* — and routing
the bookkeeping through PRs instead would stall the pipeline on human merges of pure noise.
Second, visibility: a YAML queue hides pipeline state from the place maintainers actually
look.

The answer was under ADR-001 the whole time: **GitHub is the database.** A work order is just
an issue with a `factory:work-order` label. Humans can read the queue in the tracker, edit a
bad fix plan, delete a wrong grouping, or file a work order by hand — and the fix line
consumes it identically, because `gh issue list --label "factory:work-order"` doesn't care who
wrote it. State machine, audit log, and manual override UI, all for free.

One subtlety fell out of dogfooding the design on paper: the fix line runs in "survey mode"
(cron-triggered, no event entity), and survey agents were only granted `gh issue list` /
`gh search issues` — they could *discover* work orders but not *read* them. One compiler line
(`Bash(gh issue view:*)` in the survey grant) and an invariant test closed the gap.

## Numbers

22 machine types (schema-synced, drift-guarded), 231 tests across 28 files, typecheck + build
green. The example package — blueprint, two compiled workflows, both prompts, install guide —
lives in `examples/issue-factory/`, regenerated from the real template + compiler by
`app/scripts/gen-issue-factory.ts` so it can never drift from what the app would deploy.

## Postscript: it ran for real the next morning

The day after this was built, the factory went live on lifehacker.dev. The batcher surveyed
41 open issues and filed 11 work orders (40 issues queued, one correctly routed to
`factory:needs-human` — an admin task no PR can fix). It even inferred the repo's accept-ledger
convention and made "record the exception" batches instead of "rewrite the prose" ones. The
fixer then shipped [PR #175](https://github.com/bamr87/lifehacker.dev/pull/175): four
scare-quoted "10x" lint warnings resolved with four ledger entries whose keys it computed
using the linter's own hashing code — verified by running that linter on both refs. One PR,
five `Closes` lines, zero prose churn.

The live run also broke things the tests couldn't: the rate limiter counted its own run
(off-by-one), `gh` died before checkout without `GH_REPO`, and the fixer's 40-turn budget was
a guess that hit `error_max_turns`. All three became compiler/template fixes with regression
tests within the hour (ADR-021). A generated safety step that has never executed on a real
runner is untested by definition.

## Working-with-AI tip

**Make the generated artifact a build product, not a snapshot.** The lifehacker.dev example
workflows aren't copy-pasted compiler output — a 30-line script imports the app's actual
template and actual compiler and refuses to write anything if compilation errors. When the
contract wording or a tool grant changes next month, `npx vite-node scripts/gen-issue-factory.ts`
re-derives the committed example instead of letting it rot into documentation-fiction. Any
time an AI session produces "example output of the real system," spend the extra ten minutes
wiring the example to the system; examples that can drift, will.
