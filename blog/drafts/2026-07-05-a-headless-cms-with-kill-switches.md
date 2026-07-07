---
title: "A Headless CMS With Kill Switches: Turning a Factory Builder Into a Self-Improving Content System"
description: "Making GitFactory configure an autonomous, self-tuning content system meant adopting a real fleet's governance patterns — default-OFF kill switches, a no-self-merge invariant, a feedback loop that tunes the machine — and then building one demonstrable loop that exposed a latent bug all our tests had missed."
date: 2026-07-05
categories: [it-journey, ai-engineering]
tags: [github-actions, claude-code, headless-cms, automation, feedback-loops, governance, ai-engineering]
draft: true
---

The ask was ambitious: make GitFactory configure "an autonomous, configurable, headless content
management system with AI integrations and feedback loops." The trap in a task like that is to
start inventing. Instead we started by reading a real one.

## Adopt the patterns, not the runtime

`lifehacker.dev` is a hand-built AI content fleet — 16 workflows, a universal `claude-run` runner,
a Ruby OODA dispatcher, a `loop-tuner` that tunes the fleet from its own telemetry, and a
default-OFF `*_ENABLED` repo-variable gate on every outward job. It is *more* sophisticated than
what GitFactory compiles. The first real decision was a fork: do we refactor GitFactory's compiler
to emit lifehacker's CLI-runner-plus-`ai.yml` architecture, or keep our proven
`claude-code-action` core and adopt its *patterns* as new machines?

We kept the core and adopted the patterns. Rewriting a tested compiler to gain zero new
capability is motion, not progress. What lifehacker actually teaches isn't its runtime — it's how
to make autonomy *safe and configurable*.

## The governance backbone: default-OFF, and a compromised agent can't re-arm itself

Every autonomous line now sits behind a `gate.enablement` machine that compiles to a tiny gate job:

```yaml
gate:
  steps:
    - id: check
      env: { ENABLED: ${{ vars.CONTENT_FACTORY_ENABLED }}, OAUTH: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }} }
      run: if [ "$ENABLED" = "true" ] && [ -n "$OAUTH" ]; then echo "go=true" >> "$GITHUB_OUTPUT"; else echo "go=false" >> "$GITHUB_OUTPUT"; fi
```

The line `needs: gate` and runs only when it says go. An unset variable reads as idle — never as
"safe to run." Flipping the variable arms or disarms a line *instantly, with no redeploy*, and the
crucial property: a compromised agent can't re-arm itself, because setting a repo variable needs an
admin scope the fleet token deliberately lacks. The kill switch lives outside the fleet's reach.

The headline feature is the **feedback loop** — a `processor.feedback_controller` (the loop-tuner).
It's a scheduled agent with a fixed contract: measure the factory's own run telemetry, verify the
*last* change against an improvements ledger, make the smallest upstream fix to a prompt or config,
record a new pending entry so the next run can check it, and open exactly one PR. It is granted
telemetry reads, file edits, and PR-open — and deliberately **not** `gh pr merge`. A human stays in
the loop for every change to the machine. The compiler enforces that no-self-merge invariant by
simply never granting the tool.

## Make it real, and it finds your bugs

Abstractions are easy to believe until something demands they work. So we built a demonstrable
loop on GitFactory itself: a **Docs Gardener** — a daily factory that scans a `_docs/` collection,
improves a few pages using configurable review criteria and skill specializations, and opens one
PR you review. And since GitFactory's own site *is* the app, we render `_docs/` in a Docs tab, so
the loop is visible: the gardener improves a doc → you merge → the next Pages deploy → the page
updates. The factory that tends the docs and the site that renders them are one repo.

Building it surfaced a real bug that 200-plus passing tests had never caught. GitFactory's
`sink.open_pr` told the agent to "commit your changes and open a pull request" — but the compiled
tool grant was only `Bash(gh pr create:*)`. No `Edit`. No `Write`. No `git commit`. The agent was
instructed to change files it had no permission to change. It had never mattered, because *no
previous template made an agent edit a file and then open a PR* — every prior agent commented,
labelled, or merged. The Docs Gardener was the first to actually write content, and it would have
failed closed. The demonstration was the test that found it.

## Working-with-AI tip

**A demonstration is a test — build the end-to-end thing, because it exercises the seams your unit
tests can't.** Our compiler had exhaustive invariant tests; none of them caught that an agent
asked to edit files was never granted edit tools, because no test *composed* "edit a file" with
"open a PR." Unit tests verify the pieces you thought to check; a real demonstration verifies the
*seams between* them — and the seams are where an AI's (or anyone's) unstated assumptions hide. The
practical move: for any system you're building with an agent, don't stop at green tests. Make it do
one real, end-to-end, user-visible thing on real inputs. The first genuine dogfood run is worth a
hundred more unit tests, because it's the first time the whole contract has to hold at once. If
you're tempted to ship on "the tests pass," ask what end-to-end path *no test actually walks* — and
walk it once by hand.
