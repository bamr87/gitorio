# 0002 — Harness Studio mission: observe, design and manage fleet loops over a shared graph on JEV

- **Status:** proposed
- **Date:** 2026-10-30
- **Proposed by:** Grok Bot (agent), at the maintainer's request
- **Ratified by:**
- **Affects:** constitution §1; PRD FR4–FR12, NFR4–NFR7 (proposed); features GITORIO-007…GITORIO-014
- **Supersedes:** none
- **Related:** [docs/proposals/redesign-harness-studio.md](../proposals/redesign-harness-studio.md); bamr87/bamr87#479, bamr87/bamr87#480; hub amendment 0002 (conflict-free numbering, JEV)

## Context

The mission describes a factory builder. The app now also observes fleets, ports the hub's harness engine and operates loops, and the fleet needs one interactive surface for loops and harnesses. A purpose change needs a mission amendment.

## Amendment

Append to §1 Mission: "GitFactory is also the fleet's Harness Studio: a production-ready, community-ready open harness tool for creating agentic workflows. It observes every loop and harness live, designs and configures new ones as reviewable blueprints, and manages them only through confirm-gated hub operations — read-only by default. Its front end is abstracted from its back end by a versioned graph/config schema (`fleetgraph/v1`) and an engine/API layer that any UI consumes; it is extensible through plugin node types, engine adapters and config-driven behavior; and Jev is its foundation for numbering, fragments and generated files."

## Consequences

PRD gains FR4–FR9 and NFR4–NFR5; the feature catalog gains GITORIO-007…014 (planned); AGENTS.md "What this repo is" is updated when P1 of the proposal starts. Nothing in the static-frontend, read-only-hub or secrets invariants changes.
