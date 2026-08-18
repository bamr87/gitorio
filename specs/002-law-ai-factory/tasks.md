# Tasks: Law-AI Factory

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces coverage.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.

---

## T-001 — ao-sdlc-autopilot template in the gallery

- **Refs**: FR-1, AC-4
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/src/templates/catalog.ts`
- **Steps**: add the template (cron + plan-first manual → enablement gate `AO_SDLC_AUTOPILOT_ENABLED` → rate limiter → `agent.claude` promptRef `.factory/prompts/evolve-pilot.md` → `sink.open_pr`); the existing catalog invariant test must cover it automatically.
- **Verify**: `cd app && npx vitest run src/templates/catalog.test.ts`.

## T-002 — Generator script for a target repo

- **Refs**: FR-2, FR-4, NFR-AUTH-1, AC-1
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: `app/scripts/gen-aosdlc-factory.ts` (new)
- **Steps**: mirror `gen-docs-gardener.ts`; take a target dir argv; build the three line blueprints (template clone + per-line config overrides: variable, cron, promptRef, sinks — concierge swaps to `trigger.issue_opened` → comment+label); compile each with its own `blueprintPath`; refuse on error diagnostics; write blueprints + workflows into the target.
- **Verify**: run against a scratch dir; inspect headers, gates, guards.

## T-003 — Author law-ai's three operating prompts

- **Refs**: FR-3, NFR-SEC-1, R-1, R-2
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: law-ai `.factory/prompts/{evolve-pilot,backlog-triage,issue-concierge}.md`
- **Steps**: frontmatter per the house prompt style; evolve-pilot embeds law-ai's `/evolve` procedure + stop conditions + draft-PR-only; backlog-triage embeds the triager verdicts + append-only rules; concierge: label-first, one deduped comment, numbers-not-bodies.
- **Verify**: prompts reference only files that exist in law-ai; one-paragraph-per-line.

## T-004 — Generate the artifacts into law-ai

- **Refs**: FR-3, FR-4, NFR-LOOP-1, AC-1, AC-2, AC-3
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: law-ai `.factory/*.blueprint.json`, law-ai `.github/workflows/factory--*.yml`
- **Steps**: run the T-002 generator with the law-ai path; verify each workflow's gate variable, the concierge bot guard, the absence of any merge grant, and the generated header + hash.
- **Verify**: grep assertions on the three YAML files.

## T-005 — Close law-ai's governance loop

- **Refs**: FR-5, AC-5
- **Owner**: @agent:orchestrator
- **Status**: `[x]`
- **Files**: law-ai `BACKLOG.md`, law-ai `specs/037-gitfactory-orchestration/{spec,plan,tasks}.md`
- **Steps**: append the BL entry (law-ai's next free id) and claim it; author the 037 package to law-ai's template; run law-ai's two validators; keep markdown one-paragraph-per-line.
- **Verify**: `cd /Users/bamr87/github/law-ai && python3 scripts/spec_validator.py && python3 scripts/backlog_lint.py`.

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` verified; gitorio `npm test && npm run build` green; both repos' validators green.
- **`## Follow-ups Discovered` populated below.**

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id.

- BL-20260817-04 — feature, med — Scoped verification-grant mechanism (a check machine or agent grant option) so factory agents can run repo-declared check commands (e.g. the two stdlib validators) inside a narrow Bash grant; today every heavy gate defers to PR CI (documented in the law-ai prompts).
- BL-20260817-05 — tech-debt, low — gate-check.sh cross-repo bug class: audit the SessionStart hook and any future hooks for the same cwd-derived-root assumption fixed in ADR-024.
