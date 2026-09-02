---
title: The Harness
description: Agent = Model + Harness — the hub's six layers, the scorecard and trip wires, and how a factory line becomes a lane the hub can present.
order: 6
---

# The Harness

**Agent = Model + Harness.** The model reasons; everything else — the guides it is given, the sensors that check its work, the bounds on its loop, the memory it keeps, the permissions it holds, and the telemetry that watches it — is the harness. The [bamr87 hub](https://bamr87.github.io/bamr87/harness/) presents and monitors that harness for a whole fleet of repositories. GitFactory is where you design one.

The **Harness** tab renders the hub's page from the same numbers, evaluates the same alarms over a live fleet scan, grades the blueprint on the floor against the six layers, and shows every assembly line as the record the hub reads. Nothing here writes to the hub.

## The six layers

| Layer | What the playbook means | What it is on the factory floor |
| --- | --- | --- |
| Guides | The operating instructions an agent reads before it acts, with the build/test line it must run | The `promptRef` on an agent machine (`.factory/prompts/*.md`) and its `checks` list |
| Sensors | A computational check the agent cannot talk its way past | `checks` verification grants, the evidence seal, the verified-fix gate |
| Bounded loop | Retries with a ceiling and an escalation path | `maxTurns`, a rate limiter or budget gate, the actor guard on comment-driven lines |
| Memory | State that survives a run and chooses the next unit of work | The ledger processor and its committed ledger file |
| Permissions | The smallest boundary that lets the work happen | The enablement gate (default-OFF repo variable) and the compiled `permissions:` block |
| Observability | Something outside the agent that can see it run | The compiled `factory--*.yml` the Monitor and Fleet tabs poll |

A deterministic line — a trigger belted straight into a merge sink — is not a harness. Its agent-only layers read *n/a*, and only its permissions and observability are graded.

## The scorecard and the trip wires

The hub computes a nine-metric **scorecard** (completion rate, effectiveness, wasted hours, cost per verified run, standing failures, red repos, open escalations, open agent PRs, oldest credential age) and six **trip wires**:

- `stale-data` — a committed fleet signal stopped refreshing.
- `pass-rate-floor` — the fleet's workflow success rate fell under the floor.
- `waste-ceiling` — wasted minutes crossed the ceiling as a share of the total.
- `cost-spike` — workflows averaging several times the fleet median.
- `standing-failures` — too many workflows red on their latest run.
- `credential-overdue` — a token past its rotation policy plus the grace period.

A tripped wire is an **attention item, not an action** — the loops that own each signal own the fix. Every wire is always listed, armed or tripped, so a quiet panel is distinguishable from a lost one. The thresholds live in the hub's `_data/fleet.yml`; GitFactory reads them and uses the same defaults when a hub has none.

## Hub and Live

**Hub** reads the health file the hub committed, then re-runs the same engine in GitFactory over the hub's committed signals and says whether every value, status and wire matches. **Live** evaluates the six wires over a Fleet Ops scan of your roster: the Actions signals come from the scan, while the issue pipeline and token rotation are hub loops, so they read as missing and `stale-data` trips by design.

## Lanes: how the hub reads a line

Every assembly line compiles to a **lane** in the `fleet/v1` vocabulary — the `fleet.manifest.yml` the hub and the `wtd` tooling read: an id (the workflow file's name), a kind, the harness that runs it, its triggers, the kill switch that guards it, the tokens it uses, and its guardrails (never merges, opens pull requests, writable paths). The same card appears in the Blueprint passport on the floor, in a workflow's passport under Fleet Observe, and on the Harness tab.

::map docs-gardener The Docs Gardener line — a guide, a rate limiter, a default-OFF switch, and one pull request per run ::map demo--fleet The demo fleet that the demo hub, acme/hub, presents

## Where to go next

Point Settings at another hub (`owner/repo`) to read what it commits, or open the app with `?tab=harness&hub=owner/repo`. To see a harness the way the hub does, read [`docs/HARNESS.md`](https://github.com/bamr87/bamr87/blob/main/docs/HARNESS.md) in the hub itself.
