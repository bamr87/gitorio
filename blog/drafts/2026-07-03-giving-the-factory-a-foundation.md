---
title: "Giving the Factory a Foundation: Git, Hygiene, and a Multi-Agent Review"
description: "Turning an unpacked GitFactory starter into a real repository — flattening to the right root, putting it under git, wiring dev hygiene, and running a fan-out review that verified the scaffold before a single feature session."
date: 2026-07-03
categories: [it-journey, ai-engineering]
tags: [git, github-actions, repo-setup, claude-code, code-review, ai-agents, developer-experience]
draft: true
---

The GitFactory starter had been unpacked but never *founded*. The code lived one level
too deep in `gitorio/gitfactory/`, a duplicate `CLAUDE.md` and a `gitfactory-starter.zip`
were stranded in the parent folder, and — most tellingly — `git rev-parse` returned
*fatal: not a git repository*. A sound scaffold with no version control is a sandcastle.
This session gave it a foundation.

## The one real decision: where is the repo root?

Everything hinged on one ambiguous question. The project name inside every doc is
"GitFactory", but the folder is `gitorio` — which, read aloud, is **Git + Factorio**.
So is the repo root the outer `gitorio/`, or the nested `gitfactory/`?

I didn't guess. I let the existing artifacts vote. The CI and Pages workflows are
hardcoded:

```yaml
defaults:
  run:
    working-directory: app
# ...
cache-dependency-path: app/package-lock.json
```

Those paths resolve *only* if `app/` sits one level below the git root. The `CLAUDE.md`
repo map lists `app/`, `docs/`, `seeds/` at the top level too. Both point the same way:
flatten `gitfactory/*` up so `gitorio/` is the root. The ambiguous decision turned out
to be already-decided — by config written before I arrived.

So: lift everything up a level, delete the byte-identical duplicate `CLAUDE.md` and the
now-redundant starter zip, route the stray `draft: true` blog post into `blog/drafts/`,
then `git init` on `main`. Recorded as ADR-007.

## Verify the scaffold before you build on it

Before adding hygiene files, I ran a fan-out review: six agents reading in parallel —
one each on the compiler, the machine registry + schema, the React canvas, the GitHub
I/O layer, the docs/seeds, and the infra/foundation — then a synthesis pass. The verdict
was reassuring and specific: the compiler is a genuinely *pure* Blueprint→YAML function
whose output matches the checked-in reference fragment-for-fragment, and the registry,
JSON schema, and compiler all agree on 13 machine types. `npm test` is 13/13 green;
typecheck and prod build pass.

It also caught things worth *parking* rather than fixing mid-foundation — the discipline
`CLAUDE.md` asks for. The sharpest: the `issue_labeled` loop guard checks
`github.event.issue.user.type` (the issue *author*) when a `labeled` event's actor is
`github.event.sender`. A bot-applied label on a human's issue would slip the guard and
could self-retrigger — exactly the failure the loop-guard rule exists to prevent. That's
now a flagged item in `docs/ROADMAP.md § Backlog`, not a silent surprise for the next
session. And a stale "12 machine types" in the docs (it's 13) got corrected on the spot.

## What "foundation" actually meant

- **Version control**: `git init` at the correct root, `main`, comprehensive `.gitignore`
  (secrets, build output, editor cruft), initial commit.
- **One Node source of truth**: `.nvmrc` = 22 + `engines` in `package.json`, and the
  workflows switched from a hardcoded `node-version: 22` to `node-version-file: .nvmrc`
  so dev and CI can't drift.
- **Cross-editor consistency**: `.editorconfig`, `.gitattributes` (LF normalization,
  generated files marked).
- **Contribution surface**: `CONTRIBUTING.md`, `SECURITY.md` (the app compiles workflows
  with repo write access — a disclosure policy isn't optional), a golden-rules PR
  template, and Dependabot for npm + Actions.

LICENSE was deliberately deferred (MIT vs Apache-2.0 is a real choice, not a default).

## Working-with-AI tip

**Let the code's own artifacts break your ties — don't ask the model to guess structure.**
When an agent hits a genuinely ambiguous layout decision, the instinct is to pick a
convention and move on. Better: find the file that already encodes an answer. Here, a CI
workflow's `working-directory: app` silently mandated the repo root; honoring it made the
whole toolchain line up on the first try. Config, lockfiles, import paths, and CI YAML are
constraints that have *already decided* a surprising number of "open" questions — read
them before you invent.

Corollary: run a **read-only, fan-out review before you build on unfamiliar scaffolding**,
and split its output into *fix-now* (a wrong doc count) versus *park-with-a-pointer* (a
loop-guard bug that deserves its own tested change). Verifying soundness first is cheap
insurance; discovering the compiler was broken *after* wiring GitHub I/O would not be.
