---
title: "Twenty-Eight Open PRs and the Generated-File Trap"
description: "Sweeping a factory repo's PR queue: four clean merges, one Dependabot bump that had to become a compiler change, and eighteen confident-looking docs that had never read the code."
date: 2026-08-28
categories: [it-journey, ai-engineering]
tags: [claude-code, github-actions, dependabot, code-review, generated-code, documentation]
draft: true
---

The ask was one line — review, fix, and merge every open pull request — and the queue was twenty-eight deep. Sorting it took longer than acting on it, because the queue was not twenty-eight pieces of work; it was three kinds of thing wearing the same green checkmark.

The first kind was easy: four PRs that did exactly what they said and passed CI. A one-line lockfile refresh that cleared a `nanoid` advisory Dependabot itself could not fix (its sub-dependency policy forbade the very patch-level bump that satisfied the range), two dev-dependency bumps, and a CI workflow that now *pushes* the markdown-unwrap fix back to a PR branch instead of merely failing on it. Merged in order, re-verified on `main` afterwards: 546 tests green.

The second kind is the one worth writing down. Dependabot had bumped `actions/checkout` from v4 to v7 across the four `factory--*.yml` workflows. Green CI, sensible release notes, a two-line diff per file. It was also the second time it had done this: the same bump had merged months earlier as #3 — and then vanished, because those files are compiler output, and the compiler still said `v4`. The next regeneration quietly put v4 back. Merge #55 and the cycle repeats. So the fix went where the repo's own golden rule says it goes:

```ts
// app/src/compiler/compile.ts — the only place a version lives
'actions/checkout@v7': '3d3c42e5aac5ba805825da76410c181273ba90b1', // v7.0.1, git ls-remote-verified
...
steps.push({ uses: pinRef('actions/checkout@v7', pinActions) });
```

Then regenerate everything with the app's own `compile()`. That regen showed why the rule exists: the diff was not only `v4 → v7`. The deployed lines had drifted since two later ADRs — the `client_payload.number` plumbing for inter-repo belts, a model refresh in the docs-gardener template — because nobody had re-run the compiler over the committed artifacts. The Dependabot PR was a symptom; the artifacts being behind the compiler was the disease.

The third kind was eighteen documentation PRs from a fleet of writing agents, each polished, each green, each stating in its own body that it had not read the repository. They documented a `pin-check` CI job, an action-version ignore list, a provenance sidecar file, and `{cache}` path tokens — none of which exist — and declared `.factory/` to be compiler output, which is exactly backwards. Three of them would have replaced `dependabot.yml` wholesale and silently dropped the npm ecosystem. The questions underneath them were good ones, though: which files are generated, how do you tell, how do you regenerate, what does the hash mean, how does pinning actually work. So they got one answer, written against the code, in `docs/GENERATED-FILES.md`, and every draft was closed with a pointer to it.

## Working-with-AI tip

**A green check tells you a change is consistent with the repo; it cannot tell you the change is *true*.** Before merging anything an agent produced, find the sentence in its PR body that says what it could not verify — good agents write one, and these did ("I was not able to list the repository tree"). That sentence is the review. When it is present, do not merge; either verify the claim yourself against the source (a `grep` for the gate it names, a `ls-remote` for the SHA it quotes) or replace the draft with a version that was. And when the same PR shows up twice — a bump that keeps coming back — stop reviewing the diff and ask what regenerates the file.
