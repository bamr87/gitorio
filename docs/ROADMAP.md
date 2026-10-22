# Roadmap

> The product phases and their acceptance history, from the bootstrap seeds through Fleet Ops, maps and the harness; open work lives in BACKLOG.md.

Phases mirror `seeds/` (the bootstrap era, now closed). A phase is done when its acceptance criteria pass and `npm test && npm run build` are green. Park anything else in `BACKLOG.md` (AO-SDLC, ADR-022) — § Backlog below is frozen history.

## Phase 0 — Bootstrap (seeds/00)
- [ ] `npm install / dev / test / build` all work on a fresh clone
- [ ] Baseline screenshot of the canvas committed to `docs/img/`
- [ ] Any dependency/tooling fixes logged in DECISIONS.md

## Phase 1 — Canvas MVP (seeds/01)
- [ ] Palette → drag onto canvas → machine node renders with category styling
- [ ] Belts connect out→in ports; delete via keyboard; grid snap
- [ ] Inspector edits machine config (fields from registry) and factory meta
- [ ] Blueprint export/import (JSON file + base64url blueprint string) round-trips
- [ ] Compile drawer shows per-workflow YAML + diagnostics

## Phase 2 — Compiler v1 (seeds/02)
- [ ] All 13 v0 machine types emit correct YAML (invariant tests per type)
- [ ] Loop-guard refusal path tested (comment trigger + comment sink, no guard → error)
- [ ] Permissions/concurrency computed per component; generated header + hash
- [ ] Output verified against examples/compiled/ and current claude-code-action docs

## Phase 3 — GitHub connect (seeds/03) — MVP ✅
- [x] PAT auth (sessionStorage), repo entry, permission preflight checklist
- [x] Load/save blueprint + workflows via contents API (commit or PR mode)
      — prompt *content* editing/writing lands with Prompt Studio (Phase 5); deploy
      warns on referenced-but-missing prompt files
- [x] Power hookup: sealed-box secret provisioning for ANTHROPIC_API_KEY (tweetnacl)
- [x] Drift detection: hash-mismatch banner when deployed workflows were hand-edited
- Note: repo *picker* is a text field for the MVP (list picker = backlog); live
  end-to-end demo on a scratch repo pending a user PAT.

## Phase 4 — Telemetry (seeds/04) — MVP ✅
- [x] Runs polling with ETag conditional requests (304s are free); status LEDs on machines
      (green=success, amber=running, red=failed, grey=idle) via `assemblyLines` mapping.
      Polling follows the open panel only (rate-hygiene).
- [x] Run list: conclusion, duration, event, deep link per `factory--*` run
      — jobs drill-down + log-zip (fflate) view deferred to backlog
- [x] Dashboard: total runs, success rate, in-progress, p50 duration (global). Per-line
      status is the machine LEDs; per-line stat *rows* (`statsByLine` exists, tested) = backlog.

## Phase 5 — Prompt Studio (seeds/05) — ✅ (ADR-016)
- [x] Prompt list/edit/diff; PR-by-default writes (branch `factory/prompts-*`); frontmatter form
- [x] Prompt lint (no committed secrets = error; frontmatter/obligations/injection/untrusted = warn/info)
- [x] Cron overview: next scheduled runs per line + fires/day + overlap warnings (in the Monitor tab)

## Phase 6 — Agent patterns (seeds/06) — partial (ADR-016)
- [ ] Belt mode: structured JSON handoff agent→deterministic sinks — **parked** (6.1; wants its own session)
- [x] Watchdog factory template (cron → rate-limited agent → alarm issue) — in the template gallery
- [x] Rate limiter (`rate.limiter`) + approval gate (`gate.approval`) machines — full /add-machine checklist
- [ ] Red-team pass on §8 (comment-loop + prompt-injection tool-escape) — **parked** (needs a live scratch repo)

## Phase 7 — GitHub App (seeds/07) — **parked: device flow needs the optional worker (CORS)**
- [ ] Device-flow auth — GitHub's `login/device/code` sends no CORS headers to a browser origin,
      so a pure-static SPA can't run it without the Phase-2 worker (ADR-004/016). PAT stays the path.
- [x] Multi-repo factory switcher — shipped as the Settings/Fleet connection switcher (Fleet B below).

## Fleet / plug-and-play (apply GitFactory to any repo, multi-repo, cross-repo)
Goal: point GitFactory at *various* repos, *multiple* at once, and see automation *between* repos — grounded in the real lifehacker.dev fleet (see ADR-011/012).
- [x] **A — Observe mode.** Reverse-import any repo's `.github/workflows/*.yml` into a
      read-only fleet map: one node per workflow, `workflow_run` belts, cross-repo `--repo`
      belts to external-repo stations, live telemetry LEDs. Generalized run polling beyond
      `factory--*`. Validated against `bamr87/lifehacker.dev` (14 workflows, `pipeline` hub →
      `auto-*`, cross-repo to `zer0-mistakes` + `it-journey`). (ADR-011)
- [x] **B — Multi-repo fleet switcher.** Fleet tab observes any repo via a repo-chip switcher +
      arbitrary owner/name box; `settings.recentRepos` persists slugs (never tokens); `switchRepo`
      re-points the session; live telemetry per observed repo. (ADR-016)
- [x] **C — Cross-repo edges.** `sink.cross_repo_issue` machine matching the proven `gh … --repo`
      + scoped-PAT pattern (authorable + deployable). Still parked: `repository_dispatch` trigger
      + inter-repo belts drawn on a *combined* fleet canvas. (ADR-016)
- [x] **Fleet Ops — the fleet-wide cockpit (ADR-020).** A Fleet-tab **Command** mode (the
      single-repo map is now the **Observe** toggle) that scans a *roster* of repos and renders
      four game-like boards to monitor/review/analyze/align/improve their Actions org-wide.
      Three pure engines: `fleet/facts.ts` (deep per-workflow facts — resolves the `claude-run`
      composite AI path, kill switches, cross-repo/token-chain privilege, dormant crons,
      provenance headers; 21 archetypes + dash cost type), `fleet/metrics.ts` (an exact port of
      the dash's `actions_analytics.py` — cost/effectiveness/waste/p95/flags/priority — plus
      **rework** (`run_attempt>1`) and **queue latency**), and `fleet/audit.ts` (14 alignment
      rules → 0–100 score + S–D certification grade). Roster imports from a hub's `.gitmodules`
      (`fleet/manifest.ts`); the first **multi-repo** store (`state/fleetops.ts`, concurrency-3
      user-driven scan, slugs-only persistence). Cockpit boards: **Districts** (LED-wall repo
      cards + grades), **Rankings** (offender/slowest/rework/hall-of-fame leaderboards),
      **Audit** (certification + one-click work-order issue filing with a dedup marker),
      **Schedule** (24h cron congestion + armed/disarmed kill switches + dormant automation).
      Validated against the real `zer0-mistakes` + `lifehacker.dev` fleets (19 verbatim fixtures)
      and live in-browser; adversarially reviewed; 370 tests / 34 files.
- [x] **Adapt to the #1 consumer + a management surface (ADR-021).** Turned Fleet Ops on
      `it-journey` (44% of fleet minutes, 31 workflows) and closed a full survey's gaps. Facts:
      an **`agentic-engine`** runner (it-journey's biggest, previously-invisible AI cost center)
      + `maxCostUsd`/`matrixDynamic`/`localWorkflowCalls`/`waitBound` + github-script sinks;
      **7 new archetypes** (agent-gatekeeper, issue-to-content, agentic-validator, perfection-loop,
      pr-gate, pr-editor, autonomy-loop) → 28 total. Audit: a real self-retrigger `loop-safety`
      model (stops under-grading disciplined repos) + `gate-job`/`concurrency-singleton` guards +
      a **`pin-sha`** reward → 15 rules. A fifth **Workflows** board (cost-cap column) + a
      **`WorkflowDrawer`** wiring the maintain actions (Run now / Re-run last failure / Cancel /
      **Arm-Disarm the `*_ENABLED` gate** = FF-0013 / Enable-Disable), each confirm-gated.
      Validated against the real `it-journey` + `edgar-data-parse` + `law-ai` fleets (38 fixtures)
      and live in-browser; adversarially reviewed (5 findings fixed, incl. two loop-safety
      false-negatives); 443 tests / 35 files.
- Deferred (survey § D, next up): a per-matrix-leg cost/step timeline; an expected-vs-real failure
classifier (continue-on-error legs, rate-limit soft-skips, cancel-in-progress cancels are *intended* outcomes the raw conclusion misreads); quest-ledger (`.quests/`) surfacing; and "re-run only the missing legs" for a dynamic-matrix loop.
- Backlog for this track (feature-scout specs FF-0010…FF-0016; FF-0013 kill-switch toggle shipped in ADR-021):
facts-parser recursion into composite actions + reusable workflows (≈90% of AI/sink logic hides there in some repos); persistent open-issue dedup sweep before filing; scan-result caching (ETags/facts/metrics to localStorage); one-click kill-switch arm/disarm (confirmed mutation — `setVariable` already exists); a fleet-wide generated-workflow drift board (blueprint-hash diff); a runner-pricing table (minutes → dollars); auto-remediation draft PRs for mechanical audit findings. Plus earlier: import fidelity (agent-authored sinks like content-factory's PR aren't visible in static YAML — now marked via the `content-factory` archetype + `pr` obligation sink); log-zip viewing in the run drill-down.

## Phase 8 — Headless CMS + feedback loops (ADR-017)
Goal: configure an autonomous, configurable, headless content management system with AI integrations and feedback loops — grounded in the real `lifehacker.dev` fleet (a research subagent reverse-engineered its 16 workflows, `claude-run` composite action, OODA dispatcher, and `loop-tuner` before any machine was designed). Runtime stays `claude-code-action@v1`; lifehacker's *patterns* are adopted as machines + app concepts.
- [x] **`gate.enablement`** — default-OFF repo-variable kill switch (a `gate` job + `needs`/`if`);
      instant arm/disarm with no redeploy; a compromised agent can't re-arm itself.
- [x] **`processor.feedback_controller`** — the loop-tuner: measures the factory's own telemetry,
      verifies the last change against an improvements ledger, makes the smallest upstream fix,
      opens ONE PR, **never merges** (no-self-merge invariant).
- [x] **Dry-run/apply duality** — plan-first manual trigger (`apply` input); schedule applies,
      manual plans unless ticked. Deterministic steps gate on it; agents flip to report-only.
- [x] **Central config + backlog** — `.factory/config.yml` + `.factory/backlog.yml` (pure
      parse/serialize + starvation detection) with a new **Content tab** cockpit (config form +
      backlog table + kill-switch toggles); repo-variable client methods.
- [x] **Headless CMS template** — daily writer (kill-switched, rate-limited → PR a human merges)
      + weekly loop-tuner (kill-switched).
- [x] **Docs Gardener** (ADR-018) — a demonstrable daily factory on gitorio: cron + plan-first
      manual → enablement gate → rate limiter → agent → open PR; scans `_docs`, improves
      `itemsPerRun` items using the configured review criteria + skill specializations. Dogfooded
      (template + prompt + config + standalone blueprint + compiled `factory--docs-gardener.yml`),
      default-OFF via `DOCS_GARDENER_ENABLED`.
- [x] **Docs view on Pages** (ADR-018) — `_docs/*.md` bundled + rendered in the app (a Docs tab)
      with a dependency-free Markdown renderer; the visible content loop (improve → merge → deploy).
- [x] **Skill specializations + doc config** (ADR-018) — `skills`, `reviewCriteria`, `docsDir`,
      `itemsPerRun` in `.factory/config.yml`, editable from the Content tab.
- [x] **Compiler `blueprintPath`** — header override for standalone/named blueprints.
- [ ] Backlog: table rendering in the Markdown view; per-line names for multi-line blueprints
      (would let the docs gardener live in the main blueprint instead of a standalone file).
- [ ] **OODA dispatcher + computed-matrix fan-out** (`processor.dispatcher`, `matrix: fromJSON(plan)`)
      — **parked** (heaviest/most novel; needs compiler matrix support + a deterministic planner).
- [ ] Work-leasing (git-ref CAS mutex), diff-classifier router, multi-tier job DAG within a line,
      shared knowledge store + brand linter — **parked** supporting machinery (see ADR-017 brief).

## Maps — archify as the renderer (ADR-034)

- [x] Vendor `tt-a1i/archify` at a pinned commit; pure `Blueprint`/`Fleet` → IR compiler (`app/src/archify/`); generated dogfood + demo maps under `app/public/maps/`; CI `diagram-gate`; skill installed — specs/010-archify-maps.
- [x] Design-token migration to archify's DESIGN.md ("The Evidence Console"), light theme as a peer — specs/011-evidence-console.
- [x] The console (specs/013-archify-console, ADR-035): a pure IR → geometry layout + an inline-SVG `MapView` carrying archify's reader model (Node Finder, Semantic Passport with authored reach, guided views, zoom, evidence beacons), fed live by the IR compiler — Build `Floor | Map` mode, Fleet Observe on the map (the read-only React Flow fleet canvas retired), the palette and Inspector re-homed as floating Machine Finder / Passport, `DiagramFrame` + `::map` Docs embeds through a `gen-maps` manifest, and archify's chrome grammar as `app/src/ui/` primitives on every tab with the viewer's `T` theme toggle. Non-dogfood blueprints get a live map without the Cartographer line (BL-20260828-05 now only serves the delivered HTML).
- [ ] Sequence / lifecycle / dataflow maps (BL-20260828-04); deploy `compare` (BL-20260828-06).

## Harness — the hub as design model, monitor, and contract (ADR-036)

- [x] Harness parity (specs/014-harness-parity): a pure port of the hub's `dash-gen harness` with a golden test over the hub's committed files, a live adapter over Fleet Ops scans, the `fleet/v1` lane bridge (blueprint → lanes, manifest → lanes, one `HarnessCard`, parity with `wtd`'s manifest for this repo), six-layer design readiness + the twelve-row checklist, a read-only hub store (default `bamr87/bamr87`), the eighth tab with the hub's `/harness/` anatomy over Hub and Live sources, a demo hub, deep links both ways.
- [ ] Deploy writes `fleet.manifest.yml` with declared provenance (BL-20260902-13); live adapters for the issue pipeline and token rotation (BL-20260902-14); readiness over observed fleets (BL-20260902-15); hub-side scorecard tint + link back (BL-20260902-16); a vendored-archify drift guard against the hub (BL-20260902-17); ETag-conditional hub reads (BL-20260902-18).

## Backlog

> **Migrated 2026-08-16 (ADR-022):** the live backlog moved to `BACKLOG.md` at the repo root. Every still-open item below — including the Fleet-track FF-list and the Phase 6/7/8 parked boxes — was carried over as a `BL-20260816-NN` entry (undo/redo excluded: shipped in ADR-016). This section is frozen history, kept append-only for the audit trail; add new items to `BACKLOG.md`, never here.

- Undo/redo; touch drag; blueprint marketplace; SHA-pinned actions mode;
  webhook worker + SSE live belts; multi-repo train stations.
- **Deterministic label-gated merge line (ADR-015)**: a `pull_request:[labeled]` trigger
option + filter + terminal merge sink, so "merge anything a human/agent labelled `dep:safe-to-merge`" compiles to YAML instead of living as prose the agent could override. Terminal-sink guard relaxation already permits the bot-labeler case.

### Parked by the 2026-07-03 foundation review
Correctness (compiler):
- ~~**[security] `issue_labeled` loop guard checks the wrong identity**~~ — ✅ FIXED
2026-07-04 (ADR-009): the guard now checks the event actor `github.event.sender.type` (correct for `labeled` and `pull_request.synchronize`), not the entity author. Regression tests added.
- ~~**`sink.commit_files` / `sink.open_pr` under-provisioned**~~ — ✅ FIXED 2026-07-05
(ADR-017): `toolsFor` now grants `open_pr` the git verbs (`git switch/checkout/add/commit/push`) plus `gh pr create`, and `commit_files` gets `git add/commit/push` — so the branch/commit/push obligation is actually executable. Surfaced while building the Headless-CMS content line.

Test coverage (golden rule #3):
- **5 of 13 machine types have zero invariant tests** — `compile.test.ts` now also covers
`issue_labeled` + `pr_opened` (added with the ADR-009 guard fix). Still untested: `trigger.manual, filter.condition, sink.create_issue, sink.open_pr, sink.commit_files`.
- **Drift-guard test**: assert `MACHINES.map(m => m.type)` deep-equals the schema `type`
  enum and the compiler's `TRIGGERS`/`SINKS` sets (single source of truth for machine types).

Lower priority:
- Per-type `oneOf` config subschemas in `schema/blueprint.schema.json` (config is bare
  `object` today — registry field/required constraints go unenforced).
- Committed regen script for `examples/compiled/*` + a golden anchor for a no-agent
(deterministic `gh`) line and a PR-triggered line; strip hand-written comments that cause spurious regenerate-and-diff drift.
- UI polish (`app/src/App.tsx`): `download()` revokes the blob URL before download starts;
flash `say()` doesn't clear the prior timer. `Inspector.tsx`: numeric fields use `Number('') === 0`, so a field can't be blanked. Add a React error boundary + store tests.

Foundation follow-ups (not done this session):
- Lint/format: ESLint flat config (`typescript-eslint` + `react-hooks`) + Prettier; add
  `npm run lint` to CI.
- `.claude/settings.json` permission allowlist (blocked from auto-generation this session
  — run `/fewer-permission-prompts` to create it).
- LICENSE (intentionally deferred — decide MIT vs Apache-2.0).
- Gate `deploy-pages.yml` on CI success (`workflow_run`/`needs`) so a failing-test push
  doesn't spawn an independent deploy.
