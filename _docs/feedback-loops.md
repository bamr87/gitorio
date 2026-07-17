---
title: Feedback Loops
description: How a factory measures its own telemetry and improves itself — the loop-tuner.
order: 3
---

# Feedback Loops

An autonomous factory should get *better* over time, not just repeat. GitFactory models this with the **feedback controller** machine (`processor.feedback_controller`) — a loop-tuner.

## What it does

A loop-tuner runs on a schedule and carries a built-in contract:

1. **Measure** the factory's own telemetry over a window: workflow run outcomes and
   durations, throughput, and time-to-merge.
2. **Verify the last change** against an *improvements ledger* — for every `pending` entry,
   re-measure the metric it claimed to move and mark it `verified` or `regressed`.
3. **Diagnose** the upstream cause of any weak signal and make the *smallest* change to a
   prompt or a config value — never a fix that helps only one item.
4. **Record** a new `pending` entry so the next run can verify it.
5. **Ship** exactly one pull request. It never merges its own work.

## The ledger

The ledger (`.factory/metrics/improvements.yml`) plus a `history.jsonl` snapshot file are what make runs *compound* instead of repeat. Each entry names the metric, its baseline, the direction it should move, and a status. A `regressed` entry becomes the next run's top fix-or-revert candidate.

## Why it never merges

The controller is granted telemetry reads, file edits, and the ability to open one PR — but never `gh pr merge`. A human stays in the loop for every change to the machine. This is the **no-self-merge invariant**, and the compiler enforces it by simply not granting the tool.

## Arming it safely

Like every autonomous line, the loop-tuner sits behind an **enablement gate**: it stays idle until you flip a repo variable to `true`. An unset switch reads as idle, never as "safe to run."
