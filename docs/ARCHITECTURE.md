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

**Power hookup** (Claude auth): the default secret is **`CLAUDE_CODE_OAUTH_TOKEN`** (from
`claude setup-token`, a Claude Code subscription token), with **`ANTHROPIC_API_KEY`** as the
fallback — mirroring the `claude-run` convention proven in `lifehacker.dev`. The UI can
provision either directly — `GET /repos/{o}/{r}/actions/secrets/public-key`, encrypt the
value with a libsodium **sealed box** (`tweetnacl` + `tweetnacl-sealedbox-js` in the
browser), then `PUT /repos/{o}/{r}/actions/secrets/{SECRET_NAME}`. Fallback: instruct the
user to add it manually in repo settings. The plaintext is never persisted anywhere.
Compiled workflows reference the OAuth token first and pass the API key only when the OAuth
secret is unset, so exactly one auth input is ever non-empty (no action-side ambiguity).

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
- `trigger.pr_opened` → `pull_request: [opened]` (opt-in `synchronize`)
- `trigger.comment` → `issue_comment: [created]` + phrase guard + **mandatory bot guard**
- `trigger.cron` → `schedule: [{cron}]`
- `trigger.manual` → `workflow_dispatch`
- `trigger.workflow_run` → `workflow_run: {workflows:[name], types:[completed]}` + conclusion
  guard. Runs in the **trusted default-branch context** (write token + secrets, no bot-guard),
  so it can act on Dependabot/fork PRs after their checks run; entity is
  `github.event.workflow_run.pull_requests[0].number` (ADR-014).

**Processors** (steel)
- `agent.claude` — the star. Config: `promptRef`, `model`, `maxTurns`. Compiles to a
  `claude-code-action@v1` step (see §5).
- `filter.condition` — a raw Actions expression contributed to the job-level `if:`
  (AND-joined with guards).
- `processor.dependabot_meta` — a `dependabot/fetch-metadata@v2` step; scopes the line to
  Dependabot and gates downstream sinks by semver update type via a **step-level** `if:`
  (steps outputs aren't available at job-guard time). Needs a `pull_request` trigger (ADR-014).
- `gate.approval` — runs the job in a GitHub **Environment** (`environment: <name>`) whose
  protection rules pause the run for a human reviewer. Env + reviewers are set in repo
  Settings (compiler can't) (ADR-016).
- `rate.limiter` — a first guard step counting today's runs of the workflow, failing past
  `maxPerDay` (needs `actions: read`). Runaway-loop + cost insurance (ADR-016).

**Sinks** (signal green)
- `sink.comment`, `sink.label`, `sink.create_issue`, `sink.open_pr`, `sink.commit_files`
- `sink.merge_pr` — `gh pr merge --<method> [--auto]` (grants `contents`+`pull-requests: write`).
  A **terminal** sink: it emits no new comment/issue/PR event, so a line whose only action is
  merge carries no bot loop-guard — the one way to auto-merge Dependabot's own (bot) PRs. Scope
  it with a Filter or Dependabot-metadata; the compiler warns on an unscoped `pull_request` merge.
- `sink.cross_repo_issue` — files an issue in ANOTHER repo via a scoped token secret (default
  `FLEET_TOKEN`); the `GITHUB_TOKEN` can't cross repos. Kept out of `WRITING_SINKS` — writing
  to another repo can't retrigger this line (Fleet C, ADR-016).

Adding a machine type = registry entry + emitter + invariant test + catalog line here
(`/add-machine` walks the checklist).

## 5. Compiler specification

`compile(blueprint) → { workflows: [{filename, yaml, diagnostics}], diagnostics }` — a
**pure function**, tested by invariants.

**Partitioning.** Each connected component containing ≥1 trigger becomes one workflow:
`factory--<kebab(component name)>.yml`. All triggers in the component merge into one
`on:` block. Components with no trigger yield a diagnostic, not a workflow.

**Two execution modes.**

1. **Integrated mode (v0 default).** Sinks downstream of an `agent.claude` are not
   emitted as steps. Instead they become the agent's **obligations** — an appended,
   numbered contract in the prompt ("Post exactly one comment that…", "Apply labels
   using gh…") — plus matching `--allowedTools` grants
   (`Bash(gh issue comment:*)`, `Bash(gh issue edit:*)`, `Bash(gh label list:*)`, …).
   Fewer moving parts; the agent verifies its own work.
2. **Belt mode (Phase 6).** The agent writes structured JSON to a well-known path /
   `$GITHUB_OUTPUT`; downstream sinks are deterministic steps consuming it via
   `fromJSON()`. Typed payloads on belts — more Factorio, more auditable, more YAML.
   The blueprint's edge `port`s are reserved for this.

Trigger→sink chains with **no agent in between** always compile deterministically
(`gh` CLI steps with `GH_TOKEN: ${{ github.token }}`).

**Prompt wiring.** The generated step's `prompt:` is a short bootstrap, not the whole
prompt:

```
REPO: ${{ github.repository }}
ISSUE_NUMBER: ${{ github.event.issue.number }}

Read and follow the operating instructions in .factory/prompts/triage.md.
[obligations appended here]
```

The operating prompt stays in the repo → editing it changes behavior **without
recompiling**. We pass entity *numbers*, not titles/bodies: the agent fetches content
itself with `gh`, which keeps attacker-controlled text out of the workflow file (it is
still untrusted input once fetched — see §8).

**Computed job metadata.**
- `permissions:` = union of sink needs (+ `contents: read` for checkout, `id-token:
  write` when an agent step is present, matching the action's canonical examples).
- `concurrency:` group `factory--<slug>-${{ github.event.issue.number ||
  github.event.pull_request.number || github.run_id }}` — one line per entity.
- Guards: comment/issue triggers get `github.event.<entity>.user.type != 'Bot'` (or
  actor checks) AND-joined with filters. **The compiler refuses** to emit a component
  where a comment-ish trigger and a comment/issue-writing sink coexist without a guard.

**Generated-file contract.** Every emitted YAML starts with:

```yaml
# ⚙ GENERATED BY GITFACTORY — edit the blueprint, not this file.
# blueprint: .factory/blueprint.json  hash: <fnv1a>
```

The UI compares the hash on load; mismatch ⇒ "manual edits detected" drift warning.

**Agent auth (default OAuth, API fallback).** The emitted step passes
`claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` plus
`anthropic_api_key: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets.ANTHROPIC_API_KEY || '' }}`
— the API key is supplied only when the OAuth secret is unset, so exactly one auth input is
ever non-empty. Both are optional inputs on `claude-code-action@v1`
(`claude_code_oauth_token` is documented as "alternative to anthropic_api_key").

**Verify before templating.** The action's inputs changed at v1 (`direct_prompt`,
`allowed_tools`, `model`, `max_turns` are deprecated in favor of `prompt` and
`claude_args`). Any compiler change touching the step shape must re-check
`anthropics/claude-code-action`'s current `action.yml` and `docs/usage.md`.

## 6. Telemetry & monitoring ("the circuit network")

Poll, cheaply:

- `GET /repos/{o}/{r}/actions/runs?created=>YYYY-MM-DD` filtered to `factory--*`
  workflow files → map run status onto machines of that component. LED semantics:
  green = last run success, amber = in progress, red = failure, grey = never ran /
  no power.
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
  `model_hint`, `inputs`, `obligations_note`). Frontmatter is documentation; the
  *compiled* `claude_args` is what actually grants tools/model.
- Prompt Studio (Phase 5): list, edit, diff; writes go through a PR by default
  (checkbox for direct commit). Lint rules: has frontmatter, states inputs, states
  output obligations, no secrets, no "ignore previous instructions"-style suffix traps.
- Scheduling = `trigger.cron` machines. The UI shows a schedule overview (next runs
  computed client-side from cron strings) so factory shifts are visible at a glance.

## 8. Security model

**Threats, in order of embarrassment:**

1. **Feedback loops.** Agent comments → `issue_comment` trigger → agent comments…
   Mitigation: compiler-enforced bot guards + per-entity concurrency + `maxTurns`.
2. **Prompt injection.** Issue/PR/comment text is attacker-controlled. Mitigations:
   narrow `--allowedTools` (capability containment, not content filtering), entity
   numbers instead of inlined bodies in workflow files, no blanket `Bash`, prompts
   instruct the agent to treat fetched content as data. Residual risk is real; scope
   permissions as if injection succeeds.
3. **Fork PRs.** `pull_request` from forks gets no secrets → agent steps simply fail
   closed. Never switch to `pull_request_target` + checkout of PR head; if fork
   support is ever needed it gets its own design review.
4. **Secret handling.** Sealed-box provisioning only; plaintext key lives in a form
   field, never in state, storage, blueprints, or logs.
5. **Workflow write access is code execution.** The PAT/App permission that lets the
   UI deploy workflows is the crown jewel; device-flow tokens + short PAT expiries;
   deploy-as-PR mode for shared repos.
6. **Action supply chain.** Only `anthropics/claude-code-action@v1` and
   `actions/checkout@v4` in generated output; version bumps are deliberate compiler
   changes, reviewed against upstream release notes (pin to SHAs in hardened mode —
   backlog).

## 9. Future

- Webhook worker → push telemetry (SSE), belts that light up live.
- Blueprint marketplace: shareable blueprint strings with embedded prompt packs.
- Multi-repo "train stations": `workflow_dispatch` sinks that feed factories in other
  repos.
- Belt mode as default once structured-output ergonomics are proven.
