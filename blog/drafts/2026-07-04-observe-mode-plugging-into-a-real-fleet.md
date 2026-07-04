---
title: "Observe Mode: Plugging GitFactory Into a Real, Hand-Built Agent Fleet"
description: "To make a factory-builder plug-and-play across repos, the first move isn't to author — it's to observe. Reverse-importing lifehacker.dev's 14 hand-written workflows into a live fleet map, without shoehorning a mature repo into our own model."
date: 2026-07-04
categories: [it-journey, ai-engineering]
tags: [github-actions, claude-code, reverse-engineering, react-flow, multi-repo, automation, parsers]
draft: true
---

The ask was to apply GitFactory to `lifehacker.dev` and make the tool plug-and-play across
repos. The first thing I did was *not* build — I looked. And what I found reframed the
whole task.

## The repo was already a better factory than ours

`lifehacker.dev` isn't a blank canvas waiting for GitFactory to author it. It's a
deliberately-engineered, two-layer content factory: an always-on merge pipeline
(`pipeline.yml` → `auto-fix`/`auto-merge`/`auto-update` via `workflow_run` events) and an
opt-in generative fleet (`content-factory`, a `fleet-dispatch` OODA controller) that leases
role-agents. 14 workflows, one universal `claude-run` runner, 11 named agents, a kill-switch
on every outward job, and cross-repo issue-filing to two sibling repos. It's *more*
sophisticated than what our compiler emits.

That kills the naive interpretation of "apply GitFactory to it." Deploying our simpler
`trigger→agent→sink` factories over their system would be a regression. The right verb
isn't *author* — it's **observe**.

## Don't shoehorn a mature system into your model

The tempting engineering move: decompose each workflow into our 13 machine types. It fails
immediately — real workflows use `workflow_run` chains, matrix fan-out, gate jobs, and a
custom runner that don't fit our authoring vocabulary. Forcing them in would *lie* about
how the fleet works.

So Observe mode reverse-imports at the right granularity: **one node per workflow**, with
belts for the `workflow_run` chains and dashed belts for the cross-repo `--repo` emissions,
landing on external-repo "station" nodes. That's faithful to how the fleet actually
behaves — event-driven *between* workflows — and it generalizes to any repo, which is the
whole point of plug-and-play.

The parser is pure and total (never throws): it reads YAML for structure and regex-scans
the raw text for the messy signals (agent runner, `--repo` targets, `*_ENABLED` gates,
`gh`/`git` sinks), because real workflows take too many shapes to walk structurally. The
proof it works isn't a fixture — it's the real thing:

```
workflows: 14   agents: 9
workflow_run:  pipeline → auto-fix, auto-merge, auto-update
cross-repo:    theme-scout ⇢ bamr87/zer0-mistakes
               quest-forge ⇢ bamr87/it-journey
warnings: (none)
```

It recovered the exact hub-and-spoke architecture, and the telemetry we built last session
lights each workflow's real run status. Point it at any repo; you get its fleet map.

## Working-with-AI tip

**Before you build against an existing system, make an agent inventory it — and let the
inventory veto your plan.** I nearly started writing an authoring adapter. A read-only
cataloguing pass (fan out agents over the workflows, actions, and runner) came back with
"this is a coherent two-layer factory with kill-switches and cross-repo PATs," and that
single finding flipped the design from *author* to *observe* and saved a wrong build. The
meta-move: when a task says "apply X to Y," spend the first cycle proving what Y *already
is*. The most expensive code is the adapter you write because you assumed the target was
simpler than it was.

Corollary, for the parser specifically: validate reverse-engineering against the **real
artifact**, not just fixtures. A throwaway test that ran our parser over lifehacker's actual
14 YAML files (self-skipping in CI) caught the truth that hand-written fixtures can't — that
`content-factory` opens its PR *from inside the agent prompt*, so a static sink-scan can't
see it. Now we know to mark those "agent-driven" instead of silently showing an empty node.
