# 0002 — Harness Studio mission: observe, design and manage fleet loops over a shared graph on JEV

- **Status:** proposed
- **Date:** 2026-10-30
- **Proposed by:** Grok Bot (agent), at the maintainer's request
- **Ratified by:**
- **Affects:** constitution §1; PRD FR4–FR9, NFR4–NFR5 (proposed); features GITORIO-007…GITORIO-011
- **Supersedes:** none
- **Related:** [docs/proposals/redesign-harness-studio.md](../proposals/redesign-harness-studio.md); bamr87/bamr87#479, bamr87/bamr87#480; hub amendment 0002 (conflict-free numbering, JEV)

## Context

The mission describes a factory builder. The app now also observes fleets, ports the hub's harness engine and operates loops, and the fleet needs one interactive surface for loops and harnesses. A purpose change needs a mission amendment.

## Amendment

Append to §1 Mission: "GitFactory is also the fleet's Harness Studio: it observes every loop and harness live, designs new ones as reviewable blueprints, and manages them only through confirm-gated hub operations — read-only by default, over a graph schema shared with the hub and numbered and generated under JEV."

## Consequences

PRD gains FR4–FR9 and NFR4–NFR5; the feature catalog gains GITORIO-007…011 (planned); AGENTS.md "What this repo is" is updated when P1 of the proposal starts. Nothing in the static-frontend, read-only-hub or secrets invariants changes.
