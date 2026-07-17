---
title: The Docs Gardener
description: A daily factory that reviews and improves this docs collection as a pull request.
order: 5
---

# The Docs Gardener

The pages in this collection aren't static — they're tended by a factory. The **Docs Gardener** is a daily assembly line, built in GitFactory, that keeps the docs accurate and clear over time.

## How it runs

Each morning the line fires on a schedule (a manual run is available too, as a dry run unless you tick *apply*). It sits behind the `DOCS_GARDENER_ENABLED` kill switch and a rate limiter, so it can neither run without your consent nor run away.

When armed, a Claude agent:

1. Scans the docs directory named in `.factory/config.yml` (`docsDir`, default `_docs`).
2. Picks the most-improvable items — as many as `itemsPerRun` (default 3).
3. Applies the configurable **review criteria** and adopts the matching **skill
   specialization** (technical writer, tutorial author, API reference, …).
4. Improves those docs in place and opens **one** pull request for you to review and merge.

## Configuring it

Everything the gardener honors lives in `.factory/config.yml` and is editable from the **Content** tab:

- `docsDir` — which collection to tend.
- `itemsPerRun` — how many docs to improve each day.
- `reviewCriteria` — the checklist every doc is held to.
- `skills` — the specializations the agent can adopt per item.

Because these are read at runtime, changing them takes effect on the next run with no recompile.

## The visible loop

When you merge the gardener's PR, the next GitHub Pages deploy rebuilds the app — and this very page updates. The factory that improves the docs and the site that renders them are the same repository.
