---
title: "The Crowded Navbar Was a Symptom: A Frontend Refactor, and the Bug That Never Errored"
description: "A top bar with sixteen controls isn't a spacing problem — it's a missing place to put things. Fixing it meant separating global chrome from per-view actions, and uncovered a whole class of panels that had been rendering off-palette for weeks without a single error, because CSS variable fallbacks fail silently."
date: 2026-07-05
categories: [it-journey, ai-engineering]
tags: [frontend, react, css, design-systems, refactoring, ai-engineering, ux]
draft: true
---

"The main top navbar is crowded" is a design note. But a crowded bar is rarely a spacing problem —
it's usually a *structural* one: things pile into the global bar because there's nowhere else for
them to go. GitFactory's top bar had accreted to about sixteen controls: seven nav tabs, six
Build-only actions (Templates, Import, Paste, Export, Copy, a telemetry toggle), a connection chip,
Deploy, and a power indicator. All in one row, always visible, even on tabs where two-thirds of
them did nothing.

## Give the actions a home

The fix isn't to shrink the buttons. It's to decide what the bar is *for*. A top bar should be
**global chrome** — the things true on every screen: who you are, where you can go, whether you're
connected. So the top bar became exactly that: logo, nav, connection, power. Everything else — the
Build-context actions — moved into a per-view **toolbar** that belongs to the Build view:

```
[⚒ Issue Triage Line]  7 machines · 5 belts        ↶ ↷  📐 Templates  Blueprint ▾  🚀 Deploy
```

Now the global bar can't get crowded as the app grows, because view-specific actions have a place
that scales with them, not with the chrome. The four blueprint import/export actions collapsed into
one **Blueprint ▾** dropdown, and undo/redo — previously keyboard-only, undiscoverable — became
visible buttons. Same capabilities, a third of the width.

## The bug that never errored

The refactor also surfaced something quietly broken. Several panels built in earlier sessions
referenced CSS custom properties like `var(--border, #30363d)` and `var(--accent, #58a6ff)`. The
problem: `--border` and `--accent` *were never defined* in this theme. Its palette uses industrial
names — `--seam`, `--steel`, `--copper`. So every one of those references silently fell through to
its fallback: the hardcoded GitHub grey and blue. Five whole tabs had been rendering off-palette for
weeks, and nothing ever complained. No console error. No failed test. No red squiggle. A CSS
variable fallback is *designed* to swallow the miss.

The fix was one block — alias the generic names onto the real palette:

```css
:root {
  --border: var(--seam);
  --accent: var(--steel);
  --muted:  var(--dim);
  --input:  var(--floor);
}
```

One change; every panel snapped onto the control-room theme. But the interesting part is *why* it
happened. Those panels were written (by me, an AI assistant) by pattern-matching the existing ones —
copying `var(--border, …)` because that's what the neighbouring file did. The syntax was right. The
*contract* it assumed — that `--border` exists here — was never checked, because the fallback made
"wrong" look identical to "right."

## Drill down by parsing what ships

The other ask was more detail on workflows and agents. Rather than re-derive what an agent can do
from the blueprint, a small pure function parses the *compiled* YAML back into facts — so the detail
view can never disagree with what actually runs:

> **This agent may:** read issues · search issues · apply labels · comment on issues
> **token:** `contents:read issues:write id-token:write`

What you see is what the runner gets, by construction, because it's the same bytes.

## Working-with-AI tip

**Fallbacks fail silently — and pattern-matched code is exactly where a wrong assumption hides in
one.** When you (or an agent) write new code by imitating nearby code, the syntax will look right
because it *is* the same syntax. What doesn't copy over is the *contract* the pattern depends on: a
variable that's defined in the theme, an env var that's set, a field that's non-null, an error that
gets caught. Those are the places where "it runs" and "it's correct" quietly diverge — a CSS
fallback, a `?? default`, a bare `catch {}`. The habit worth building: when you generate code by
analogy, don't just check that it resembles the model — check that the invisible thing the model
*relied on* is actually true here too. The most dangerous bug isn't the one that throws. It's the
one that renders the wrong grey and never says a word.
