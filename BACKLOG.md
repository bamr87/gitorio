# GitFactory — Backlog

> **Append-only** register of follow-ups discovered during implementation. Every `/implement` cycle MUST append discovered work here in addition to closing the current task. Items graduate from this list into `specs/NNN-*/` via `/specify`. Adopted from law-ai's AO-SDLC (ADR-022, golden rule #11); the pre-existing prose backlog in `docs/ROADMAP.md § Backlog` was migrated here on 2026-08-16 and is now frozen history.
>
> **Format**: One bullet per item, kebab-case ID, status, brief context, link to the spec/PR/ROADMAP section that surfaced it.
>
> Not to be confused with `.factory/backlog.yml` — that is the *product's* content work queue read by deployed agents; this file is the *repo's* engineering work register.

## Conventions

| Field        | Notes                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| `id`         | `BL-YYYYMMDD-NN` — the date discovered + an ordinal (`python3 tools/next_backlog_id.py` mints the next one) |
| `status`     | `open` / `claimed-by:specs/NNN` / `wontfix` (with reason) / `done`     |
| `kind`       | `feature` / `refactor` / `tech-debt` / `test-gap` / `doc-gap` / `infra`|
| `severity`   | `low` / `med` / `high`                                                 |
| `surfaced-in`| Spec, PR, or ROADMAP section that discovered it                        |

## Triage rules

1. New items go to **Open**. Promotions go to **Claimed**. Resolved items move to **Done** (kept for audit; never delete).
2. Items unclaimed > 60 days get reviewed at the next `/specify` cycle and either closed `wontfix` or escalated.
3. CI gate ([tools/backlog_lint.py](tools/backlog_lint.py)) enforces format and forbids deletion of historical entries.

---

## Open

- **BL-20260818-09** — *infra, low* — Dogfood the first real inter-repo belt (law-ai → gitorio or reverse) once a fleet PAT secret exists in the sender repo — operator decision + secret provisioning. _Surfaced in:_ specs/008-dispatch-sender.
- **BL-20260818-08** — *feature, low* — Combined-canvas inter-repo belts (sharpened from BL-20260816-22's remainder): render dispatch sender→receiver edges across observed repos in the Fleet map. _Surfaced in:_ specs/007-repository-dispatch.
- **BL-20260818-05** — *feature, med* — Migrate gitorio's main blueprint to `lineNaming: 'auto'` and fold the standalone Docs Gardener into it (regenerate + clean up the old indexed filenames) — the ADR-028 payoff redeploy. _Surfaced in:_ specs/006-per-line-names.
- **BL-20260818-06** — *tech-debt, low* — Deploy planner: detect previously-deployed `factory--*.yml` orphaned by a line rename and offer their removal in the plan. _Surfaced in:_ specs/006-per-line-names.
- **BL-20260818-04** — *doc-gap, low* — Dogfood: wire the Dependency Warden to the label-gated automerge line on gitorio (Warden labels, deterministic line merges) and retire the Warden's own merge grant — the full ADR-015 end-state. _Surfaced in:_ specs/005-label-gated-merge.
- **BL-20260818-02** — *infra, low* — `/compile-check` step that re-verifies `PINNED_ACTIONS` against live upstream tag refs and reports drift. _Surfaced in:_ specs/004-sha-pinned-actions.
- **BL-20260818-03** — *feature, low* — Inspector meta-form toggle for `pinActions` (the flag is JSON-only today). _Surfaced in:_ specs/004-sha-pinned-actions.
- **BL-20260818-01** — *feature, low* — Render check grants as readable phrases in `describeWorkflow` (Inspector "Capabilities · compiled" + Monitor drill-down) instead of raw Bash patterns. _Surfaced in:_ specs/003-verification-grant.
- **BL-20260817-06** — *tech-debt, low* — Revert the `typescript` alias devDependency to a plain spec once typescript-eslint supports TS ≥ 7.1 (the alias exists only so eslint can parse under the native TS 7 toolchain). _Surfaced in:_ specs/001-issue-sweep.
- **BL-20260817-07** — *tech-debt, low* — Re-enable `react-hooks/set-state-in-effect` (two deliberate hits were rule-off'd) and clear the five advisory `exhaustive-deps` warnings. _Surfaced in:_ specs/001-issue-sweep.
- **BL-20260817-05** — *tech-debt, low* — Audit hooks for the cwd-derived-repo-root assumption class fixed in ADR-024 (gate-check.sh gated a sibling repo's specs/ with this repo's tool paths during cross-repo work). _Surfaced in:_ specs/002-law-ai-factory.
- **BL-20260816-20** — *test-gap, high* — Red-team pass on ARCHITECTURE §8: comment-loop and prompt-injection tool-escape attempts against a live scratch repo; parked since Phase 6 because it needs a real deployment. _Surfaced in:_ docs/ROADMAP.md § Phase 6.
- **BL-20260816-17** — *feature, med* — OODA dispatcher + computed-matrix fan-out (`processor.dispatcher`, `matrix: fromJSON(plan)`); parked as the heaviest Phase 8 machine — needs compiler matrix support + a deterministic planner. _Surfaced in:_ docs/ROADMAP.md § Phase 8.
- **BL-20260816-19** — *feature, med* — Belt mode: structured JSON handoff from agent to deterministic sinks (Phase 6.1, ADR-003); wants its own session. _Surfaced in:_ docs/ROADMAP.md § Phase 6.
- **BL-20260816-23** — *feature, med* — Facts-parser recursion into composite actions and reusable workflows — ≈90% of AI/sink logic hides there in some repos (feature-scout FF-0010). _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-28** — *feature, med* — Auto-remediation draft PRs for mechanical fleet-audit findings (never auto-merge). _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-30** — *feature, med* — Expected-vs-real failure classifier: continue-on-error legs, rate-limit soft-skips, and cancel-in-progress cancels are *intended* outcomes the raw run conclusion misreads. _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-34** — *feature, med* — Dogfood the weekly evolve audit as a compiled factory line (`trigger.schedule` + `gate.enablement` + deterministic step + `sink.open_pr`) so `.github/workflows/evolve.yml` is generated by GitFactory instead of hand-authored. _Surfaced in:_ ADR-022 merge session.
- **BL-20260816-01** — *feature, low* — Touch-drag support for the canvas (mobile/tablet authoring). _Surfaced in:_ docs/ROADMAP.md § Backlog.
- **BL-20260816-02** — *feature, low* — Blueprint marketplace: browse/share community blueprints as encoded strings. _Surfaced in:_ docs/ROADMAP.md § Backlog.
- **BL-20260816-04** — *infra, low* — Optional webhook worker + SSE live belts (Phase 7+ upgrade path; keeps the core static per golden rule #1). _Surfaced in:_ docs/ROADMAP.md § Backlog.
- **BL-20260816-05** — *feature, low* — Multi-repo train stations: first-class stations for cross-repo belts on the authoring canvas. _Surfaced in:_ docs/ROADMAP.md § Backlog.
- **BL-20260816-12** — *infra, low* — `.claude/settings.json` permission allowlist via `/fewer-permission-prompts` (the file now exists carrying the AO-SDLC hooks, ADR-022; the allowlist itself is still missing). _Surfaced in:_ docs/ROADMAP.md § Backlog.
- **BL-20260816-13** — *infra, low* — LICENSE decision: MIT vs Apache-2.0 (intentionally deferred at foundation time). _Surfaced in:_ docs/ROADMAP.md § Backlog.
- **BL-20260816-15** — *feature, low* — Table rendering in the Docs tab's dependency-free Markdown renderer. _Surfaced in:_ docs/ROADMAP.md § Phase 8.
- **BL-20260816-18** — *feature, low* — Phase 8 supporting machinery: work-leasing (git-ref CAS mutex), diff-classifier router, multi-tier job DAG within a line, shared knowledge store + brand linter (see ADR-017 brief). _Surfaced in:_ docs/ROADMAP.md § Phase 8.
- **BL-20260816-21** — *feature, low* — GitHub App device flow — blocked on browser CORS (`login/device/code` sends no CORS headers); needs the optional worker (BL-20260816-04). _Surfaced in:_ docs/ROADMAP.md § Phase 7.
- **BL-20260816-24** — *feature, low* — Persistent open-issue dedup sweep before fleet-audit work-order filing. _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-25** — *feature, low* — Fleet scan-result caching (ETags/facts/metrics to localStorage — slugs and facts only, never tokens). _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-26** — *feature, low* — Fleet-wide generated-workflow drift board (blueprint-hash diff across the roster). _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-27** — *feature, low* — Runner-pricing table so fleet cost converts minutes to dollars instead of the wall-clock shadow price. _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-29** — *feature, low* — Per-matrix-leg cost/step timeline in the fleet drill-down (survey § D). _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-31** — *feature, low* — Quest-ledger (`.quests/`) surfacing in Fleet Ops. _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-32** — *feature, low* — "Re-run only the missing legs" for dynamic-matrix loops. _Surfaced in:_ docs/ROADMAP.md § Fleet.
- **BL-20260816-33** — *feature, low* — Log-zip viewing (fflate) in the Monitor run drill-down. _Surfaced in:_ docs/ROADMAP.md § Phase 4.
- **BL-20260816-35** — *feature, low* — Surface BACKLOG.md and `specs/` in the app (a process cockpit alongside the Content tab's `.factory/backlog.yml` view), keeping the repo-work vs content-queue distinction visible. _Surfaced in:_ ADR-022 merge session.

## Claimed


## Done

- **BL-20260818-07** — *feature, med* — **(resolved 2026-08-18)**: `sink.repository_dispatch` (23rd machine) — endpoint-exact agent grant, deterministic PAT step, `client_payload.number` protocol, compile-time self-dispatch-loop refusal. _Shipped in:_ specs/008-dispatch-sender (ADR-030).
- **BL-20260816-22** — *feature, med* — **(resolved 2026-08-18)**: `trigger.repository_dispatch` shipped as the 22nd machine (typed dispatch scoping, survey-mode grants, `client_payload.number` entity plumbing, numbers-not-bodies preserved); the sender sink + combined-canvas remainder re-filed sharpened as BL-20260818-07/-08. _Shipped in:_ specs/007-repository-dispatch (ADR-029).
- **BL-20260816-16** — *feature, med* — **(resolved 2026-08-18)**: per-line names — `meta.lineNaming: 'auto'` derives each line's name from its agent promptRef (else trigger+sink), collision-suffixed, shared between `compile()` and `assemblyLines()` so telemetry never diverges; default stays indexed (no silent renames). _Shipped in:_ specs/006-per-line-names (ADR-028).
- **BL-20260816-06** — *feature, med* — **(resolved 2026-08-18)**: label-gated merge line — `trigger.pr_opened` `fireOn: labeled` + exact-label guard composed with the terminal merge sink; merge policy is now YAML structure with zero agent judgment in the merge path; `label-gated-automerge` gallery template. _Shipped in:_ specs/005-label-gated-merge (ADR-027).
- **BL-20260816-03** — *feature, med* — **(resolved 2026-08-18)**: SHA-pinned actions mode — `meta.pinActions` pins every emitted `uses:` ref via the verified `PINNED_ACTIONS` table with tags preserved as comments; two-way drift guard; default output byte-identical. _Shipped in:_ specs/004-sha-pinned-actions (ADR-026).
- **BL-20260817-04** — *feature, med* — **(resolved 2026-08-18)**: `checks` config on `agent.claude` — each declared command compiles to exactly its own `Bash(<cmd>:*)` grant + VERIFY obligation; quoting/substitution is a compile error; law-ai pilot/triage regenerated with the two validators. _Shipped in:_ specs/003-verification-grant (ADR-025).
- **BL-20260817-02** — *tech-debt, high* — **(resolved 2026-08-17)**: promptRef read grants are a compiler invariant (`Read`/`Glob`/`Grep` + survey `gh pr checks`); Factory-3 regression + 5-shape invariant table; the four deployed `factory--*.yml` regenerated. _Shipped in:_ specs/001-issue-sweep (ADR-023, from draft PR #37).
- **BL-20260817-01** — *test-gap, med* — **(resolved 2026-08-17)**: swept all 8 absolute-date test fixtures; only fleetops fed a real-clock window (already pinned); the rest verified clock-independent. _Shipped in:_ specs/001-issue-sweep.
- **BL-20260816-07** — *test-gap, med* — **(resolved 2026-08-17)**: 10 new invariant tests — `filter.condition` (guard joins, empty-filter warning, merge-scope interplay) + `sink.commit_files` (obligations, git grants, permissions, deterministic-line error). _Shipped in:_ specs/001-issue-sweep.
- **BL-20260816-08** — *tech-debt, med* — **(resolved 2026-08-17)**: 21-branch per-type config subschemas + a dependency-free registry↔schema drift-guard test; committed blueprints validate. _Shipped in:_ specs/001-issue-sweep.
- **BL-20260816-09** — *tech-debt, low* — **(resolved 2026-08-17)**: `app/scripts/regen-examples.ts` (idempotent, refuses on errors, owns `examples/compiled/`), two fresh anchors incl. the no-agent deterministic line + PR-triggered line; stale hand-annotated file removed. _Shipped in:_ specs/001-issue-sweep.
- **BL-20260816-10** — *tech-debt, low* — **(resolved 2026-08-17)**: blob-URL revoke after click, `say()` timer cleared, Inspector `NumberInput` draft-state blanking, `ErrorBoundary` ("Line jam") wrapping the shell + tests, ui-store test. _Shipped in:_ specs/001-issue-sweep.
- **BL-20260816-11** — *infra, med* — **(resolved 2026-08-17)**: ESLint 10 flat config (typescript-eslint + react-hooks) + Prettier, `npm run lint` green (0 errors) and wired into CI. _Shipped in:_ specs/001-issue-sweep.
- **BL-20260816-14** — *infra, med* — **(resolved 2026-08-17)**: Pages deploy now `workflow_run`-chained on CI success (dispatch bypass kept; builds the CI-validated SHA). _Shipped in:_ specs/001-issue-sweep.
- **BL-20260817-03** — *feature, high* — **(resolved 2026-08-17)**: GitFactory now builds/manages law-ai's AI orchestration — `ao-sdlc-autopilot` gallery template + `gen-aosdlc-factory.ts` target-repo generator + three default-OFF lines installed in law-ai (blueprints, prompts, compiled `factory--*.yml`), governed by law-ai's own specs/037. _Shipped in:_ specs/002-law-ai-factory (ADR-024).
