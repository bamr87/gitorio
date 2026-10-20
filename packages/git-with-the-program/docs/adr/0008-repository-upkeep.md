# ADR-0008: Repository upkeep: a deterministic plan with authored content slots

**Status:** Proposed · **Date:** 2026-10-03 · **Deciders:** pending PR review · **Decided in:** the repository-upkeep session

## Context

The request: *a feature that reviews, analyzes and reports all of the GitHub-based components, variables and data sets, and performs updates automatically to keep everything from drifting (releases, tags, descriptions and other repository information, noted and updated from the git history and contents), loopable on demand or weekly, using schema files and programmatically extractable references, with an AI agent providing the context and content.*

This repository is the evidence the problem is real. On the day this ADR was written its GitHub description was empty, it had no topics, no tags and no releases, the labels its own engine files proposals with did not exist, and its README still said "Implementation not started" above 80 source files.

Three forces pull against each other:

1. **Automatic** means a machine changes things on a schedule, unattended.
2. **This repository forbids unreviewed machine writes** to its law (INV-001) and to its
   evidence (INV-002), and its whole design is that machines append and humans ratify.
3. **AI-provided content** is stochastic, and the content an AI reads (READMEs, commit
   subjects) is attacker-influenceable text.

## Options considered

### Option A: An agent that does it all

Run Claude Code weekly with broad permissions: "keep the repo tidy". It reads, decides, and calls `gh` or commits.

| Dimension | Assessment |
|---|---|
| Effort | Lowest: one prompt |
| Determinism | None. Every run decides anew; oscillation (rewriting the description weekly) is likely |
| Auditability | A transcript, not a contract |
| Blast radius | Whatever the token allows, steered by whatever text it reads |
| Fit with GWTP | Poor: the opposite of "verdicts are facts, the fold is deterministic" |

### Option B: Deterministic engine, no AI

Derive everything from config, tree and history; template every text.

| Dimension | Assessment |
|---|---|
| Determinism | Total |
| Content quality | Changelogs fine; release summaries, topic suggestions and stale-prose review impossible |
| Fit with the request | Misses "an AI agent provides the context/content" |

### Option C: Deterministic plan with authored content slots (chosen)

The engine computes desired state, findings and actions deterministically, and names the few values only an author can supply as **content slots**, each with a brief, a contract, and a deterministic fallback. An AI, either a model call or an agent editing the plan file, fills slots, and nothing else. A separate step applies validated actions to the forge only. In-tree drift becomes a work order for a reviewed PR.

| Dimension | Assessment |
|---|---|
| Determinism | Plan is pure; AI output is confined to bounded, re-validated slots |
| Convergence | Provable and tested: AI fills only empty fields, remote state is add/set only |
| Blast radius | AI cannot add an action or change a target; apply holds the write token and runs no AI |
| Degradation | No forge → in-tree findings only. No AI → fallbacks. No admin token → `blocked` with the remedy |
| Effort | Highest of the three (~1.5k lines + tests) |

## Decision

Option C. It is the same split the judge bench already makes (spec 03): stochastic authors, deterministic contracts, and a fold that consumes only what validated. It takes three positions:

- **The plan is the interface between engine and agent** (`schemas/upkeep-plan.schema.json`).
An agent's whole job description is "set `status`, `value`, `provider` on requested slots, then make `gwtp upkeep check` pass".
- **Apply writes the forge, never the tree.** Tags are created through the refs API, not
`git push`. Version bumps, doc fixes and LICENSE files are PRs (the opt-in `tend` job), reviewed like any change, judged by CI's INV-001 check like any change.
- **Tag at introduction, not at HEAD.** A backfilled `v0.1.0` points at the commit where
`package.json` first said `0.1.0`. The 11 commits since are reported as unreleased with a suggested bump, not swept into a release they were not part of.

## Consequences

- Three new artifacts (two schemas, one config) and a new CLI command; no `.program/` change,
  no change to any existing spec or schema.
- `GITHUB_TOKEN` cannot set a repository's description or topics. Full automation needs an
admin-scoped `UPKEEP_TOKEN`. Without it, the weekly run reports those two actions as `blocked` (exit 1), loudly, every week, until either the secret is set or the config stops managing them. That is deliberate: a silent partial success would read as "no drift".
- Whether upkeep's artifacts fall under INV-006, and whether `src/upkeep/**` should join
  INV-005's scope, are ratification questions (OPEN-QUESTIONS Q-71, Q-72).
- ROADMAP v2's "packaging as a reusable GitHub Action for arbitrary repos" gets a first
candidate: upkeep is config-driven and has no GWTP-specific assumptions beyond the code-derived labels, which a foreign repository's config simply leaves off.
