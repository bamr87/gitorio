<!-- kit: governance v0.1.0 -->
# 0003 — Missions

- **Status:** proposed
- **Date:** 2026-11-16
- **Proposed by:** Grok Bot (agent), at the maintainer's request
- **Ratified by:**
- **Affects:** constitution §1; PRD §1.1; feature GITORIO-015
- **Supersedes:** none
- **Related:** [PRD.md](../../PRD.md) §1.1; feature GITORIO-015

## Context

Constitution §1 Mission was a product description (or, for a new constitution, had not been written yet), not a three-mission direction statement. The fleet now requires every repo's constitution §1 to be one direction statement followed by exactly three numbered missions, adopted through a numbered amendment the maintainer ratifies by merging. The maintainer asked for those missions to be comprehensive and epic: GitFactory as the ultimate open home for all things GitHub automation. Mission 1 follows the maintainer's wording, adapted to this domain: provide data, tools, resources and transparency for all stakeholders, domain practitioners and the general public. The ambition is the direction, not a claim that the work is already finished. The missions are aligned with this repo's existing constitution and PRD.

## Amendment

Replace constitution §1 with the following, retitled **Missions**:

GitFactory's direction is to become the ultimate open home for all things GitHub automation — data, tools, resources and transparency, gathered in one place that anyone can inspect and reuse.

1. **Provide data, tools, resources and transparency for all stakeholders, automation engineers and practitioners, and the general public.** Maintainers, harness authors, agent builders and anyone automating a repository are first-class audiences. The aim is a shared, inspectable commons: the same blueprints, the same compiled workflows, and the same trail of configuration for everyone.
2. **Let anyone design, compile and share visual blueprints that become readable, auditable GitHub Actions workflows on their own repos, with no hosted backend.** Users arrange triggers, Claude Code agents and actions on a canvas, connect them, and Deploy compiles the blueprint into workflow YAML that works without GitFactory. GitHub remains the database, event bus and compute layer; blueprints and prompts stay versioned in the repo.
3. **Be the fleet's Harness Studio: observe every loop and harness live, design and configure new ones as reviewable blueprints, and manage them only through confirm-gated operations — read-only by default.** A versioned graph and config schema, and an engine and API any UI can consume, keep the front end independent of the back end; the studio stays extensible through plugin node types, engine adapters and config-driven behavior, with Jev as the foundation for numbering, fragments and generated files.

These missions set the course; they do not claim the work is finished. They serve the PRD goals: compiling visual blueprints into auditable Actions YAML, versioned and shareable blueprints, guarded agent contracts, and factory-floor status from the Actions API.

_Source: [PRD.md](../PRD.md) §1.1._


Existing §1 normative content is preserved under the missions, not dropped:

### Harness Studio (amendment 0002)

GitFactory is also the fleet's Harness Studio: a production-ready, community-ready open harness tool for creating agentic workflows. It observes every loop and harness live, designs and configures new ones as reviewable blueprints, and manages them only through confirm-gated hub operations — read-only by default. Its front end is abstracted from its back end by a versioned graph/config schema (`fleetgraph/v1`) and an engine/API layer that any UI consumes; it is extensible through plugin node types, engine adapters and config-driven behavior; and Jev is its foundation for numbering, fragments and generated files. _(proposed, [amendment 0002](amendments/0002-harness-studio-mission.md))_

## Consequences

Agents and reviewers judge fit against these three missions before inventing scope, treating them as the direction of the repo rather than a description of what already ships. The same text is added as PRD §1.1 so the constitution's `_Source:` line stays accurate. The original PRD purpose / overview paragraph is left in place. This PR also aligns the README and AGENTS.md taglines with the missions and links them to constitution §1, and adds feature GITORIO-015 to the feature catalog, traced to requirement MR1. Merging this PR ratifies amendment 0003. Until then the record stays `Status: proposed`.
