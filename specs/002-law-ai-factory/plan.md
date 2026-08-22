# Plan: Law-AI Factory

> Companion to `spec.md`. Describes **how** we will satisfy the requirements.

## 1. Architecture Overview

Three governed agent lines, each a standalone blueprint in law-ai compiled by gitorio's compiler (the ADR-018 dogfood pattern, pointed at a *sibling* repo via a target-dir generator): **evolve-pilot** (weekly cron + plan-first manual → kill switch → rate limit → Claude agent running one AO-SDLC cycle → draft-shaped PR), **backlog-triage** (monthly cron + manual → kill switch → agent verifying open BL items against code → reconciliation PR), **issue-concierge** (new-issue trigger → agent → label + one comment, bot-guarded). law-ai's existing deterministic workflows are untouched; the lines fill the agentic gap its `evolve.yml` tracking issue currently assigns to humans.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Templates | `app/src/templates/catalog.ts` | new `ao-sdlc-autopilot` entry (generic evolve-pilot shape) |
| Scripts | `app/scripts/gen-aosdlc-factory.ts` (new) | target-dir generator: 3 blueprints + 3 compiled workflows |
| law-ai | `.factory/*.blueprint.json`, `.factory/prompts/*.md`, `.github/workflows/factory--*.yml` | generated artifacts + hand-authored prompts |
| law-ai | `BACKLOG.md`, `specs/037-gitfactory-orchestration/` | governance per law-ai's constitution §7/§11 |

## 3. Blueprint & Schema Changes

None — existing machine types only; blueprints conform to the current schema (and the new per-type subschemas from spec 001).

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Line packaging | Standalone blueprint per line | One multi-line blueprint | Multi-line filenames are still `<meta.name> <index>` (BL-20260816-16 open); standalone gives stable names + per-line drift hashes (ADR-018 precedent) |
| Where lines live | In law-ai, repo-local token | Cross-repo from gitorio | Least privilege: no PAT with cross-repo write; law-ai's own secrets already configured |
| Reusability | One generic gallery template + script-side variants | Three templates | Concierge/triage are config variants of existing shapes; gallery stays curated |
| law-ai process | Full spec 037 + BL entry | Drop files, skip governance | law-ai's constitution makes spec-driven non-trivial changes mandatory; we are guests, we follow house rules |

## 5. Least Privilege & Permissions

All grants compiler-derived: evolve-pilot/backlog-triage get `contents: write` + `pull-requests: write`, file tools + git verbs + `gh pr create` (from `sink.open_pr`), survey-mode read verbs, and **no merge verb**; issue-concierge gets `issues: write`/`pull-requests: write` comment+label verbs only. Nothing hand-widened; ADR-023 supplies the promptRef read grants.

## 6. Loop Guards & Untrusted Input

Issue-concierge is the only event-triggered writer: the compiler emits the actor-based bot guard (`github.event.sender.type != 'Bot'`, ADR-009), and its prompt passes issue *numbers*, never bodies (ADR-005). Evolve-pilot/backlog-triage are cron/manual (no attacker-controlled trigger payload) and terminal at `open_pr` — a PR-opening emits no event these lines subscribe to.

## 7. Test Strategy

Catalog invariant test auto-covers the new template (compile-clean, zero error diagnostics); generator verified by running against a scratch dir + grep assertions on gate/guard/grant fragments in the law-ai outputs (AC-1..AC-3); law-ai's own validators as the governance gate.

## 8. Rollout

Everything lands default-OFF: all three `*_ENABLED` variables unset ⇒ every line idles. Arming order for the user: set `ISSUE_CONCIERGE_ENABLED=true` first (lowest blast radius), then `BACKLOG_TRIAGE_ENABLED`, then `EVOLVE_PILOT_ENABLED`; watch the first runs in gitorio's Monitor/Fleet tabs.

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Pilot picks a needs-human item (R-1) | med | med | Stop conditions in the prompt; draft-PR-only; rate limiter; default-OFF |
| Concierge noise (R-2) | med | low | Default-OFF; one-comment dedup contract; label-first |
| Generated YAML drifts from law-ai edits | low | med | `GENERATED` header + blueprint hash → gitorio drift banner |

## 10. Estimated Effort

One session, orchestrator-inline (compiler-facing work), law-ai governance included.
