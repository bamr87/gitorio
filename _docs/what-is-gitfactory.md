---
title: What is GitFactory?
description: A Factorio-style builder that compiles a visual graph into real GitHub Actions workflows.
order: 1
---

# What is GitFactory?

GitFactory is a **factory builder for GitHub automation**. You drag *machines* onto a canvas, connect them with *belts*, and the blueprint **compiles to real GitHub Actions workflows** that run Claude Code agents against your repositories.

The frontend is fully static — it deploys to GitHub Pages with no backend. GitHub itself is the database (your blueprint lives in the repo), the event bus (Actions triggers), and the compute layer (Actions runners).

::map gitorio-factory-1 This repository's own issue-triage line, as the map archify delivers for it — lanes are roles, the guard lane is the actor check the compiled YAML really carries.

## The core idea

Instead of hand-writing YAML, you describe *what* should happen as a graph:

- A **trigger** starts a line (an issue opens, a schedule fires, a PR lands).
- A **processor** does work in the middle (a Claude agent, a filter, a rate limiter).
- A **sink** is the outcome (a comment, a label, a pull request, a merge).

The compiler turns each connected subgraph into one workflow file named `factory--<slug>.yml`, computes a least-privilege `permissions:` block from the sinks, and adds the loop guards that keep an agent from re-triggering itself.

## Why a factory?

The metaphor keeps the mental model honest. A machine has inputs and outputs; a belt moves one thing to the next; power (your Claude auth secret) is what makes the motors run. If a line isn't powered, its machines are greyed out. If a line could feed itself forever, the compiler refuses to build it.

## Where to go next

- **Machines and belts** — the catalog of machine types and how they connect.
- **Feedback loops** — how a factory can measure and improve itself.
- **Power and security** — how secrets, permissions, and untrusted input are handled.
