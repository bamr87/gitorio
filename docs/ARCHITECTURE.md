# GitFactory Architecture

> A factory builder for GitHub automation. You lay down machines and belts; the
> compiler emits GitHub Actions workflows; Claude Code agents are the machines'
> motors; the repository is the database, the event bus, and the factory floor.

## 1. System components

```
┌────────────────────────────┐        REST (Octokit, fetch)        ┌──────────────────────────┐
│  Static UI (GitHub Pages)  │ ──────────────────────────────────▶ │  Target repo(s)          │
│  canvas · compiler ·       │ ◀────────────────────────────────── │  .factory/blueprint.json │
│  inspector · telemetry     │        polling (runs, timelines)    │  .factory/prompts/*.md   │
└────────────────────────────┘                                     │  .github/workflows/      │
                                                                   │    factory--*.yml        │
                                                                   └────────────┬─────────────┘
                                                                                │ events
                                                                                ▼
                                                                   ┌──────────────────────────┐
                                                                   │  GitHub Actions runners  │
                                                                   │  anthropics/             │
                                                                   │  claude-code-action@v1   │
                                                                   └──────────────────────────┘
```

There is deliberately **no application server**. Three consequences:

- The UI must do everything through GitHub's REST API with a user-supplied credential.
- All agent compute happens inside GitHub Actions on the target repo's runners.
- "Real-time" monitoring is polite polling (conditional requests) until the optional
  webhook worker phase.

## 2. Auth phases

| Phase | Mechanism | Notes |
|---|---|---|
| 0 | **Fine-grained PAT** pasted into the UI, held in `sessionStorage` only | Permissions needed: Contents (RW), Issues (RW), Pull requests (RW), Actions (R), **Workflows (RW)** — pushing workflow files requires the Workflows permission. Secrets (RW) if using in-app power hookup. |
| 1 | **GitHub App + device flow** | Device flow needs no client secret, so it works from a pure static site. User-to-server token; installation picker becomes the "factory site selector". |
| 2 (optional) | Thin Cloudflare Worker | Only for (a) web-flow OAuth code exchange (nicer UX) and (b) webhook → SSE relay for push telemetry. Core product must keep working without it. |

**Power hookup** (Claude auth): the default secret is **`CLAUDE_CODE_OAUTH_TOKEN`** (from `claude setup-token`, a Claude Code subscription token), with **`ANTHROPIC_API_KEY`** as the fallback — mirroring the `claude-run` convention proven in `lifehacker.dev`. The UI can provision either directly — `GET /repos/{o}/{r}/actions/secrets/public-key`, encrypt the value with a libsodium **sealed box** (`tweetnacl` + `tweetnacl-sealedbox-js` in the browser), then `PUT /repos/{o}/{r}/actions/secrets/{SECRET_NAME}`. Fallback: instruct the user to add it manually in repo settings. The plaintext is never persisted anywhere. Compiled workflows reference the OAuth token first and pass the API key only when the OAuth secret is unset, so exactly one auth input is ever non-empty (no action-side ambiguity).

## 3. Data model — the Blueprint

Canonical schema: `schema/blueprint.schema.json`. Shape:

```jsonc
{
  "version": 1,
  "meta": { "name": "Issue Triage Line", "repo": "owner/name", "description": "…" },
  "nodes": [
    { "id": "n1", "type": "trigger.issue_opened", "position": { "x": 0, "y": 120 }, "config": {} },
    { "id": "n2", "type": "agent.claude", "position": { "x": 320, "y": 120 },
      "config": { "promptRef": ".factory/prompts/triage.md", "model": "claude-sonnet-4-6", "maxTurns": 8 } },
    { "id": "n3", "type": "sink.label", "position": { "x": 640, "y": 60 }, "config": { "labels": "" } }
  ],
  "edges": [ { "id": "e1", "from": { "node": "n1", "port": "out" }, "to": { "node": "n2", "port": "in" } } ]
}
```

- Stored **in the target repo** at `.factory/blueprint.json` → versioned, PR-reviewable,
  portable, and multiple people can open the same factory.
- **Blueprint strings**: base64url of the JSON, shareable like Factorio blueprint
  strings. Import/export lives in the top bar.
- The UI keeps an in-memory working copy; "Deploy" writes blueprint + compiled
  workflows + any new prompt files in a single commit (or a PR, user's choice).

## 4. Machine catalog (v0)

**Triggers** (copper) — map to `on:` blocks
- `trigger.issue_opened` → `issues: [opened]`
- `trigger.issue_labeled` → `issues: [labeled]` + label guard
- `trigger.pr_opened` → `pull_request: [opened]` (opt-in `synchronize`); `fireOn: labeled` mode → `pull_request: [labeled]` with an exact-label job guard — the label-gated automerge keystone (ADR-027), warning-free only when a label is set
- `trigger.comment` → `issue_comment: [created]` + phrase guard + **mandatory bot guard**
- `trigger.cron` → `schedule: [{cron}]`
- `trigger.manual` → `workflow_dispatch`
- `trigger.workflow_run` → `workflow_run: {workflows:[name], types:[completed]}` + conclusion
guard. Runs in the **trusted default-branch context** (write token + secrets, no bot-guard), so it can act on Dependabot/fork PRs after their checks run; entity is `github.event.workflow_run.pull_requests[0].number` (ADR-014).
- `trigger.repository_dispatch` → `repository_dispatch: {types:[eventType]}` — the receiving end of an inter-repo belt (ADR-029). Entity-less (survey-mode grants for agent lines); `client_payload.number` joins the NUMBER/concurrency fallback chains as the entity pointer, while payload free text never enters prompts (ADR-005); empty event type warns.

**Processors** (steel)
- `agent.claude` — the star. Config: `promptRef`, `model`, `maxTurns`, `checks` (one repo check command per line — each compiles to exactly its own `Bash(<cmd>:*)` grant + a VERIFY obligation, ADR-025; quoting/substitution in a check is a compile error). Compiles to a
  `claude-code-action@v1` step (see §5).
- `filter.condition` — a raw Actions expression contributed to the job-level `if:`
  (AND-joined with guards).
- `processor.dependabot_meta` — a `dependabot/fetch-metadata@v2` step; scopes the line to
Dependabot and gates downstream sinks by semver update type via a **step-level** `if:` (steps outputs aren't available at job-guard time). Needs a `pull_request` trigger (ADR-014).
- `gate.approval` — runs the job in a GitHub **Environment** (`environment: <name>`) whose
protection rules pause the run for a human reviewer. Env + reviewers are set in repo Settings (compiler can't) (ADR-016).
- `rate.limiter` — a first guard step counting today's runs of the workflow, failing past
  `maxPerDay` (needs `actions: read`). Runaway-loop + cost insurance (ADR-016).
- `gate.enablement` — a default-OFF kill switch. Compiles to a tiny `gate` job checking a repo
**variable** (`vars.<NAME>`) — plus, for agent lines, that Claude auth exists — and the `line` job `needs: gate` + `if: needs.gate.outputs.go == 'true'`. Unset = idle (never "safe to run"); flip the variable to arm/disarm a line instantly with no redeploy. The app toggles it via the Actions variables API. Governance backbone for autonomous lines (ADR-017).
- `processor.feedback_controller` — the loop-tuner. A specialised agent (a claude-code-action step)
with a built-in contract: measure the factory's own telemetry → verify the last change against an improvements ledger (`.factory/metrics/improvements.yml` + `history.jsonl`) → make the smallest upstream change to a prompt/config → record a `pending` ledger entry → open ONE PR. Granted telemetry-read + file-edit + PR-open; **never `gh pr merge`** (no-self-merge invariant). The feedback loop that lets the factory improve itself (ADR-017).

**Sinks** (signal green)
- `sink.comment`, `sink.label`, `sink.create_issue`, `sink.open_pr`, `sink.commit_files`
- `sink.merge_pr` — `gh pr merge --<method> [--auto]` (grants `contents`+`pull-requests: write`).
A **terminal** sink: it emits no new comment/issue/PR event, so a line whose only action is merge carries no bot loop-guard — the one way to auto-merge Dependabot's own (bot) PRs. Scope it with a Filter or Dependabot-metadata; the compiler warns on an unscoped `pull_request` merge.
- `sink.cross_repo_issue` — files an issue in ANOTHER repo via a scoped token secret (default
`FLEET_TOKEN`); the `GITHUB_TOKEN` can't cross repos. Kept out of `WRITING_SINKS` — writing to another repo can't retrigger this line (Fleet C, ADR-016).
- `sink.repository_dispatch` — POSTs a `repository_dispatch` to ANOTHER repo (`gh api repos/<target>/dispatches`, scoped token secret, `client_payload.number` entity pointer) — the sending end of the inter-repo belt, pairing with `trigger.repository_dispatch` (ADR-030). Agent grant is the exact target endpoint; deterministic emission exists; the compiler REFUSES self-dispatch loops (same repo + an event type the line listens for) and warns on other same-repo dispatches.

Adding a machine type = registry entry + emitter + invariant test + catalog line here (`/add-machine` walks the checklist).

## 5. Compiler specification

`compile(blueprint) → { workflows: [{filename, yaml, diagnostics}], diagnostics }` — a **pure function**, tested by invariants.

**Partitioning.** Each connected component containing ≥1 trigger becomes one workflow: `factory--<kebab(component name)>.yml`. All triggers in the component merge into one `on:` block. Components with no trigger yield a diagnostic, not a workflow. With `meta.lineNaming: 'auto'` (ADR-028), multi-line blueprints name each line by its agent's promptRef basename (else first trigger + first sink types, deduped with numeric suffixes) instead of `<meta.name> <index>`; the naming lives in the shared `assemblyLines()` helper, so compiled filenames and telemetry LED mapping cannot diverge.

**SHA-pinned actions mode (ADR-026).** `meta.pinActions: true` (or the `pinActions` compile option) emits every `uses:` ref pinned to a verified commit SHA with the original tag as a trailing comment (`actions/checkout@11d5960… # v4`). The compiler stays pure: pins come from the curated `PINNED_ACTIONS` table, verified against upstream tag refs (golden rule #4); an invariant test enforces that every emittable ref has a pin.

**Two execution modes.**

1. **Integrated mode (v0 default).** Sinks downstream of an `agent.claude` are not
emitted as steps. Instead they become the agent's **obligations** — an appended, numbered contract in the prompt ("Post exactly one comment that…", "Apply labels using gh…") — plus matching `--allowedTools` grants (`Bash(gh issue comment:*)`, `Bash(gh issue edit:*)`, `Bash(gh label list:*)`, …). Fewer moving parts; the agent verifies its own work.
2. **Belt mode (Phase 6).** The agent writes structured JSON to a well-known path /
`$GITHUB_OUTPUT`; downstream sinks are deterministic steps consuming it via `fromJSON()`. Typed payloads on belts — more Factorio, more auditable, more YAML. The blueprint's edge `port`s are reserved for this.

Trigger→sink chains with **no agent in between** always compile deterministically (`gh` CLI steps with `GH_TOKEN: ${{ github.token }}`).

**Prompt wiring.** The generated step's `prompt:` is a short bootstrap, not the whole prompt:

```
REPO: ${{ github.repository }}
ISSUE_NUMBER: ${{ github.event.issue.number }}

Read and follow the operating instructions in .factory/prompts/triage.md.
[obligations appended here]
```

The operating prompt stays in the repo → editing it changes behavior **without recompiling**. We pass entity *numbers*, not titles/bodies: the agent fetches content itself with `gh`, which keeps attacker-controlled text out of the workflow file (it is still untrusted input once fetched — see §8).

**Computed job metadata.**
- `permissions:` = union of sink needs (+ `contents: read` for checkout, `id-token:
  write` when an agent step is present, matching the action's canonical examples).
- `concurrency:` group `factory--<slug>-${{ github.event.issue.number ||
  github.event.pull_request.number || github.run_id }}` — one line per entity.
- Guards: comment/issue triggers get `github.event.<entity>.user.type != 'Bot'` (or
actor checks) AND-joined with filters. **The compiler refuses** to emit a component where a comment-ish trigger and a comment/issue-writing sink coexist without a guard.

**Generated-file contract.** Every emitted YAML starts with:

```yaml
# ⚙ GENERATED BY GITFACTORY — edit the blueprint, not this file.
# blueprint: .factory/blueprint.json  hash: <fnv1a>
```

The UI compares the hash on load; mismatch ⇒ "manual edits detected" drift warning.

**Agent auth (default OAuth, API fallback).** The emitted step passes `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` plus
`anthropic_api_key: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets.ANTHROPIC_API_KEY || '' }}`
— the API key is supplied only when the OAuth secret is unset, so exactly one auth input is ever non-empty. Both are optional inputs on `claude-code-action@v1` (`claude_code_oauth_token` is documented as "alternative to anthropic_api_key").

**Verify before templating.** The action's inputs changed at v1 (`direct_prompt`, `allowed_tools`, `model`, `max_turns` are deprecated in favor of `prompt` and `claude_args`). Any compiler change touching the step shape must re-check `anthropics/claude-code-action`'s current `action.yml` and `docs/usage.md`.

## 6. Telemetry & monitoring ("the circuit network")

Poll, cheaply:

- `GET /repos/{o}/{r}/actions/runs?created=>YYYY-MM-DD` filtered to `factory--*`
workflow files → map run status onto machines of that component. LED semantics: green = last run success, amber = in progress, red = failure, grey = never ran / no power.
- Per-run drill-down: jobs API; **logs are a redirect to a zip** — fetch, unzip in the
  browser (fflate), render in a drawer.
- Sink verification: issue/PR timeline events (labeled, commented) correlated by time
  window + actor.
- Rate-limit hygiene: conditional requests with `If-None-Match` (304s are free),
  backoff on `x-ratelimit-remaining`, poll only the open factory.
- Dashboard: throughput (runs/day), success rate, p50 duration per assembly line.
- **Watchdog factory** (Phase 6): a compiled cron workflow that files/updates a
  `factory-alarm` issue when failure rate crosses a threshold. The alarm siren.

## 7. Prompt system & scheduling

- Prompts: `.factory/prompts/<name>.md` with YAML frontmatter (`title`, `version`,
`model_hint`, `inputs`, `obligations_note`). Frontmatter is documentation; the *compiled* `claude_args` is what actually grants tools/model.
- Prompt Studio (Phase 5): list, edit, diff; writes go through a PR by default
(checkbox for direct commit). Lint rules: has frontmatter, states inputs, states output obligations, no secrets, no "ignore previous instructions"-style suffix traps.
- Scheduling = `trigger.cron` machines. The UI shows a schedule overview (next runs
  computed client-side from cron strings) so factory shifts are visible at a glance.
- **Dry-run/apply** (ADR-017): a `trigger.manual` "plan-first" mode adds an `apply` boolean
  input; a manual run plans only unless ticked, while scheduled/other events apply
  (`github.event_name != 'workflow_dispatch' || inputs.apply`). Deterministic mutating steps gate
  on it; agent lines get a PLAN/APPLY prompt note (report-only on a dry run).

## 7a. Headless-CMS data files (ADR-017)

Two repo-versioned, hand/agent-editable YAML files (Content tab cockpit, `content/model.ts`):

- `.factory/config.yml` — central config the content agents honor at runtime: `model` (one place
to change it fleet-wide, mirrors lifehacker's `_data/ai.yml`), `maxDailyRuns` (soft budget), `brandVoice`, `contentPaths`, plus the docs-review knobs `docsDir` / `itemsPerRun`, a `reviewCriteria` checklist, and `skills` — named specializations (technical-writer, tutorial-author, api-reference…) the agent adopts per item (ADR-018). Editing it changes behavior without recompiling; all of it is editable from the Content tab.
- `.factory/backlog.yml` — the content work queue: a list of `{id, kind, title, brief, priority,
status}`. `status: todo → in-progress → done`; the app flags **starved** kinds (0 `todo`) — a signal the loop-tuner watches. Parsing is total (never throws; coerces + defaults).
- `.factory/metrics/improvements.yml` + `history.jsonl` — the feedback controller's ledger + trend
  snapshots (written by the loop-tuner agent at runtime, not the app).

## 7b. Docs view — content rendered on Pages (ADR-018)

gitorio's GitHub Pages deployment *is* the Vite app (`app/dist`), not a Jekyll site — so the docs render **inside the app**. A repo-root `_docs/*.md` collection is bundled at build time via `import.meta.glob('../../../_docs/*.md', { query: '?raw' })` (dev needs `server.fs.allow: ['..']`), parsed by a dependency-free Markdown renderer (`docs/markdown.ts` → block AST → React elements, no `dangerouslySetInnerHTML`), and shown in the **Docs** tab. This closes a visible loop with the **Docs Gardener** factory (a template: cron + plan-first manual → enablement gate → rate limiter → agent → open PR): the gardener improves a doc → you merge → the next Pages deploy re-bundles → the Docs view updates. The factory that tends the docs and the site that renders them are one repo. The gardener is dogfooded from the same template + compiler the app uses (`app/scripts/gen-docs- gardener.ts`), compiled with the `blueprintPath` option so its header points at its own standalone blueprint (`.factory/docs-gardener.blueprint.json`).

## 7c. Fleet Ops — the fleet-wide cockpit (ADR-020)

Observe mode (§ROADMAP Fleet A) maps one repo's workflows as a read-only graph. **Fleet Ops** (the Fleet tab's **Command** mode) is the operational layer above it: point it at a *roster* of repos and monitor, review, analyze, align, and improve their GitHub Actions the way you would across a whole org. Same premises — static frontend, GitHub is the backend, polite polling — applied fleet-wide.

**Three pure engines** (`app/src/fleet/`, all pure + total per golden rule #3; validated against 19 verbatim real-fleet workflow fixtures in `fleet/fixtures/`):

- **`facts.ts` — `extractFacts(path, yaml) → WorkflowFacts`.** The deep per-workflow inspection report. Beyond the observe parser's triggers/sinks it resolves what a naive scan misses (proven by surveying the real fleet): the `./.github/actions/claude-run` **composite** and the **`agentic-engine`** (`agentic_validate.py` / bare `@anthropic-ai/claude-code` CLI) AI paths — both invisible to a `claude-code-action` regex, the latter being it-journey's single biggest cost center; kill switches referenced in `env:`/`run:`/`if:`, cross-repo `gh … --repo` sinks buried in prompt strings, token fallback chains (`FLEET_TOKEN || github.token`), **dormant** (commented-out) crons, action pin styles, the `⚙ GENERATED BY GITFACTORY` provenance header, the agent's `--max-turns`/**`--max-cost-usd`** ceilings, a **dynamic matrix** (`matrix: fromJSON(plan)` vs a static list), **local reusable-workflow calls** (`./.github/workflows/*.yml` intra-repo belts), a **wait-bound** signal (a `sleep`+`gh pr checks` poll loop — minutes spent waiting, not computing), and github-script/embedded-script sinks (`issues.createComment`, `--create-issue`). Detection reads *command lines only* (a `commandLines()` pass strips `#` comments + `name:` labels) so a tool named in a comment isn't mistaken for a real invocation. It classifies each workflow into one of **28 archetypes** (standard-ci-caller, mention-handler, content-factory, auto-merge-bot, self-repair, nightly-audit, cross-repo-filer, meta-loop, generated-line, plus the quest-pipeline set — agent-gatekeeper, issue-to-content, agentic-validator, perfection-loop, pr-gate, pr-editor, autonomy-loop — …) and the dash's ordered-substring **cost type**.
- **`metrics.ts` — an exact TS port of the dash's `actions_analytics.py`.** Cost = wall-clock minutes (a shadow price — there is no runner-pricing table, matching the source); effectiveness = share of minutes ending in success; waste = minutes on failed/cancelled/timed-out runs; p95 = nearest-rank; flags (`failing`/`flaky` mutually exclusive, `slow`/`cancel-heavy`/`cron-heavy`/`high-cost-low-value`) and `priority = waste + total×(1−effectiveness)` verbatim, so the cockpit reconciles with the dash's `/actions/` page. Two gitorio additions: **rework** (`run_attempt>1`, a re-run signal — a new `FactoryRun.runAttempt` field) and **queue latency** (p50 `created→started`). Fleet-wide runs/labels are keyed **`owner/name::path`** before the engine (bare paths collide — every repo has `ci.yml`) and split back for display.
- **`audit.ts` — the alignment-rules engine.** 15 rules encoding the fleet's *own* conventions (OAuth-first Claude auth, default-OFF `*_ENABLED` kill-switch gate on scheduled AI, loop-safety, concurrency/permissions/timeout hygiene, action pinning + a `pin-sha` reward, plan/apply duality, sticky-marker dedup, the standard CI+@claude+prose trio) → a 0–100 conformance score and an **S–D certification grade** with per-finding fixes. `AUDIT_RULES` is a single data-driven list (rulebook + checkers can't drift). **`loop-safety` is a true self-retrigger model** (golden rule #6): it maps each write sink to the event it emits (`comment→issue_comment`, `label→issues`, `pr→pull_request`, `merge→∅`, `commit→push` or `pull_request` only when `synchronize` is subscribed) and fails **only** when an emitted event is in the workflow's own subscribed set and no guard is present — so a PR-triggered comment (which can't retrigger `pull_request`) passes, while a `pull_request:` trigger with no `types:` (which defaults to include `synchronize`) is still correctly flagged when it writes commits. This stops the audit under-grading disciplined repos on guards it couldn't previously see (`gate-job`, `concurrency-singleton`, `synchronize` omission).

**Roster** (`manifest.ts`): `parseGitmodules` turns a monorepo hub's `.gitmodules` (e.g. `bamr87/bamr87`) into a roster of repo slugs; `parseRosterText` + `mergeRoster` handle free-text add and union. Slugs only — never tokens.

**Store** (`state/fleetops.ts`): the app's first genuinely **multi-repo** store. Persists the roster + hub slug + window (localStorage, never tokens). `scanFleet` runs on an explicit action through a **concurrency-3 worker pool** (a 40-repo sweep ≈ 4 API calls/repo — no background poller burning quota), shows per-repo progress + remaining rate budget, keeps each poll ETag-conditional, and turns a failing repo into an error card without aborting the sweep. `importFleetDeep` fetches each workflow file once and runs both the observe parser and the facts extractor.

**Cockpit** (`panels/FleetOpsPanel.tsx`) — a HUD + five game-like boards:
- **Districts** — repo cards: LED wall (one LED per workflow's latest run), S–D grade, machine/AI counts, a minute bar with a waste overlay, flag chips. The factory-floor overview; each card drills through to the Observe map.
- **Rankings** — offender (triage-priority), slowest (p95), rework, and hall-of-fame (heavy *and* effective) leaderboards.
- **Workflows** — a per-workflow table across the scanned fleet (repo · workflow · archetype · LED · runs/waste/p95 · a **cost-cap column** surfacing `--max-cost-usd` and the wait-bound signal · flags), costliest-first, each row a **Manage** button opening the drawer.
- **Audit** — certification table (worst score first) → expandable findings, each with a plain-language fix and **one-click work-order issue filing** (embeds a `<!-- gitorio-fleet-audit key=… -->` dedup marker, mirroring the dash's actions-review convention).
- **Schedule** — a 24-hour UTC cron congestion histogram + scheduled lines with **armed/disarmed** kill-switch state (read from repo variables) + a dormant-automation list.

**Workflow management** (`panels/WorkflowDrawer.tsx`) — a slide-over for one workflow showing every capability (triggers/crons; the AI engine incl. `agentic-engine`, model, turn + **dollar** caps, agents; armed/disarmed kill switches; guards; permissions; token chain; wait-bound + dynamic-matrix badges), its windowed metrics, and this workflow's audit findings — with the **maintain** actions: Run now (`dispatchWorkflow`), Re-run last failure (`rerunRun`), Cancel (`cancelRun`), **Arm/Disarm** each `*_ENABLED` gate (`setVariable` — idles a line without a redeploy, the fleet convention; distinct from Enable/Disable the file via `setWorkflowEnabled`). Every mutation is gated behind an explicit confirm naming repo + workflow + consequence; an `actionBusy` map disables in-flight buttons. Filing an audit issue (`createIssue`) remains the Audit board's write.

## 8. Security model

**Threats, in order of embarrassment:**

1. **Feedback loops.** Agent comments → `issue_comment` trigger → agent comments…
   Mitigation: compiler-enforced bot guards + per-entity concurrency + `maxTurns`.
2. **Prompt injection.** Issue/PR/comment text is attacker-controlled. Mitigations:
narrow `--allowedTools` (capability containment, not content filtering), entity numbers instead of inlined bodies in workflow files, no blanket `Bash`, prompts instruct the agent to treat fetched content as data. Residual risk is real; scope permissions as if injection succeeds.
3. **Fork PRs.** `pull_request` from forks gets no secrets → agent steps simply fail
closed. Never switch to `pull_request_target` + checkout of PR head; if fork support is ever needed it gets its own design review.
4. **Secret handling.** Sealed-box provisioning only; plaintext key lives in a form
   field, never in state, storage, blueprints, or logs.
5. **Workflow write access is code execution.** The PAT/App permission that lets the
UI deploy workflows is the crown jewel; device-flow tokens + short PAT expiries; deploy-as-PR mode for shared repos.
6. **Action supply chain.** Only `anthropics/claude-code-action@v1` and
`actions/checkout@v4` in generated output; version bumps are deliberate compiler changes, reviewed against upstream release notes (pin to SHAs in hardened mode — backlog).

## 9. Future

- Webhook worker → push telemetry (SSE), belts that light up live.
- Blueprint marketplace: shareable blueprint strings with embedded prompt packs.
- Multi-repo "train stations": `workflow_dispatch` sinks that feed factories in other
  repos.
- Belt mode as default once structured-output ergonomics are proven.
