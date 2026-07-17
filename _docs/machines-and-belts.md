---
title: Machines and Belts
description: The machine catalog — triggers, processors, and sinks — and how belts connect them.
order: 2
---

# Machines and Belts

A blueprint is a graph of **machines** connected by **belts**. Machines come in three categories.

## Triggers (copper)

Triggers start an assembly line. They map to a workflow's `on:` block.

- `trigger.issue_opened` — a new issue lands.
- `trigger.pr_opened` — a pull request opens (optionally on new pushes too).
- `trigger.comment` — a comment matches a phrase (always bot-guarded).
- `trigger.cron` — a schedule fires, in UTC.
- `trigger.manual` — run on demand; in *plan-first* mode a manual run is a dry run.
- `trigger.workflow_run` — another workflow finished; act on its success or failure.

## Processors (steel)

Processors sit in the middle of a line.

- `agent.claude` — the motor. Runs Claude Code with a repo prompt and scoped tools.
- `filter.condition` — gate the line on a raw Actions expression.
- `rate.limiter` — stop the line after N runs a day (runaway + cost insurance).
- `gate.enablement` — a default-OFF kill switch tied to a repo variable.
- `processor.feedback_controller` — the loop-tuner (see *Feedback loops*).

## Sinks (signal green)

Sinks are the outcome of a line: `sink.comment`, `sink.label`, `sink.create_issue`, `sink.open_pr`, `sink.commit_files`, `sink.merge_pr`, and `sink.cross_repo_issue`.

## Belts

A belt is a directed edge from one machine's output to the next machine's input. Downstream sinks of an agent become the agent's **obligations** — a numbered contract appended to its prompt — plus the matching `--allowedTools` grants. A trigger wired straight to a sink with no agent between them compiles to deterministic `gh` CLI steps.

## Assembly lines

Each connected subgraph that contains at least one trigger is one **assembly line**, and each line compiles to one workflow file. Machines with no trigger upstream are idle and produce a diagnostic rather than a workflow.
