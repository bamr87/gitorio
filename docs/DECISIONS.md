# Decisions (ADR-lite)

Append entries; never rewrite history. Format: date, decision, why, alternatives.

## 2026-07-03 — ADR-001: Blueprint lives in the target repo
`.factory/blueprint.json` in the repo it automates. Why: versioning, review,
portability, shareability for free; the UI stays stateless. Alt: app-side storage
(rejected: needs a backend, splits truth from the repo).

## 2026-07-03 — ADR-002: GitHub Actions is the runtime
Compile to workflows using anthropics/claude-code-action@v1 rather than running
agents in a service. Why: zero infrastructure, secrets stay in GitHub, output is
auditable YAML that works without GitFactory. Alt: hosted orchestrator (rejected
for v1: cost, trust surface, defeats the static-site premise).

## 2026-07-03 — ADR-003: Integrated mode first, belt mode later
Sinks downstream of an agent become prompt obligations + scoped tool grants, not
deterministic steps. Why: fewer moving parts; the action already excels at gh
operations. Belt mode (typed JSON handoff) is Phase 6 once ergonomics are proven.

## 2026-07-03 — ADR-004: Static + fine-grained PAT first, App device flow second
PAT in sessionStorage unblocks everything with zero backend; device flow (no
client secret needed) upgrades UX in Phase 7. Web-flow OAuth requires a token
exchange secret → optional worker, never a core dependency.

## 2026-07-03 — ADR-005: Pass entity numbers, not bodies, into prompts
Generated workflow prompts reference issue/PR numbers; the agent fetches content
via gh. Keeps attacker-controlled text out of workflow files; injection is then
mitigated by capability containment (--allowedTools), not content trust.

## 2026-07-03 — ADR-006: Toolchain pinned at Vite 8 / plugin-react 6
@vitejs/plugin-react@6 peer-requires vite@^8, so the pair is vite ^8.1 +
plugin-react ^6 (TS ~5.9, vitest ^4, React 19). Verified: install, 13/13 tests,
typecheck, prod build, dev-server smoke all green on Node 22.

## 2026-07-04 — ADR-014: Granular components — workflow_run trigger, merge_pr sink, dependabot_meta processor
Added three machines so flows like "auto-merge low-risk Dependabot updates" and "act on a
workflow's pass/fail" are expressible. Three decisions, each verified against GitHub's live
behaviour (golden rule #4 — confirmed via the Dependabot-automation docs before templating):
(1) **`trigger.workflow_run`** is the trusted keystone. It runs on the default branch with a
write token + secrets and is not attacker-loopy, so it carries no bot-guard — the secure way
to act on a PR's CI result (incl. Dependabot/forks). Entity =
`github.event.workflow_run.pull_requests[0].number`.
(2) **`sink.merge_pr`** (`gh pr merge --<method> [--auto]`) is a **terminal** sink — merging
emits no new comment/issue/PR event, so it can't retrigger its line. Terminal-only lines
therefore drop the mandatory bot loop-guard (ADR-009 stays intact for content-writing lines),
which is the ONLY way a `pull_request`-triggered line can act on Dependabot's bot-authored PRs.
Grants `contents`+`pull-requests: write`; the compiler errors if there's no PR-bearing trigger
and warns on an unscoped `pull_request` merge.
(3) **`processor.dependabot_meta`** wraps `dependabot/fetch-metadata@v2`. Because
fetch-metadata reads the `pull_request` event, this path is `pull_request`-triggered (NOT
workflow_run), and its update-type gate must be a **step-level** `if:` on the merge step —
job-level guards evaluate before any step runs, so `steps.*.outputs` aren't available there.
The processor auto-scopes the line to `pull_request.user.login == 'dependabot[bot]'` (fetch-
metadata is Dependabot-only). Verified: Dependabot `pull_request` runs DO honour the
`permissions:` block for the GITHUB_TOKEN, so no `pull_request_target` (and its checkout-of-
untrusted-code risk) is needed. Alt: route auto-merge through workflow_run too (rejected —
fetch-metadata has no PR event there); a `pull_request_target` machine (rejected — security-
sensitive, deferred). 10 invariant tests; both example flows compile clean (100 tests total).

## 2026-07-04 — ADR-013: Scheduled/manual agent lines get "survey mode" PR-discovery grants
A Dependency Warden (review the open Dependabot PRs, comment a verdict, label the safe ones)
exposed a real gap: a `pull_request`-triggered line is the wrong tool for Dependabot, because
(1) the compiler's mandatory bot loop-guard (`github.event.sender.type != 'Bot'`, ADR-009)
correctly refuses to fire for a bot actor, and (2) GitHub gives Dependabot `pull_request`
runs a **read-only token with no secrets**, so `CLAUDE_CODE_OAUTH_TOKEN` wouldn't even be
present. The right shape is a **cron + manual** line that runs in the base-repo context (full
secrets, writable token, no bot-guard) — the same OODA-warden pattern `lifehacker.dev` uses.
But such a line has no triggering entity, so it must *discover* its own work, and the existing
cron grants (`gh issue list`, `gh search issues`) **cannot see PRs** — verified empirically:
`gh search issues` forces `type:issue` and `gh issue list` excludes PRs. So the compiler now
recognises **survey mode** (an agent line fired only by cron/manual — `!hasIssueish && !hasPr
&& !hasComment`) and grants read-only PR discovery/inspection (`gh pr list/view/diff`) plus,
when a comment/label sink is downstream, the PR-scoped write tools (`gh pr comment`, `gh pr
edit`) and `pull-requests: write` (PR comments/labels are governed by the pull-requests scope,
not issues, even though gh routes through the shared number space). Still least-privilege: no
`gh pr merge/create/close`, contents stays `read`. Consequence (accepted): the compiler can't
read prompts, so *any* cron/manual comment/label agent (e.g. the nightly gardener) gets the
issue+PR survey+write ceiling — the prompt narrows actual behaviour, the grant is a ceiling.
Alt: a `pull_request_target` machine (rejected — security-sensitive trigger, later phase);
Dependabot secrets scope (rejected — doesn't help the read-only `GITHUB_TOKEN` comment/label).

## 2026-07-04 — ADR-012: Agent auth defaults to Claude Code OAuth token, ANTHROPIC_API_KEY fallback
GitFactory's generated workflows (and the power hookup) now default to
**`CLAUDE_CODE_OAUTH_TOKEN`** (from `claude setup-token` — a Claude Code subscription token)
with **`ANTHROPIC_API_KEY`** as the fallback, matching the `claude-run` convention proven in
`lifehacker.dev`. Verified against the live `claude-code-action@v1` `action.yml` (golden rule
#4): both `claude_code_oauth_token` and `anthropic_api_key` are optional inputs; the former
is "an alternative to" the latter. The compiler emits BOTH, but the API key uses the
expression `${{ secrets.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets.ANTHROPIC_API_KEY || '' }}`
so it is non-empty ONLY when the OAuth secret is unset — exactly one auth input is ever
populated, avoiding any action-side precedence ambiguity and never sending both. The
power-hookup UI provisions either secret (OAuth default), the power LED lights when either
exists, and dev `.env` gains `VITE_CLAUDE_CODE_OAUTH_TOKEN` (build-guarded like the other
secrets). Alt: pass only the OAuth token (rejected — breaks API-key users); pass both
unconditionally (rejected — relies on unverified action precedence).

## 2026-07-04 — ADR-011: Observe mode reverse-imports workflows as a fleet map, not authoring machines
To make GitFactory plug-and-play against ANY repo (starting with the real, hand-built
`lifehacker.dev`), added a read-only **Observe mode** that reverse-imports
`.github/workflows/*.yml`. Key decision: do NOT decompose arbitrary workflows into the 13
authoring machine types — they use `workflow_run` chains, matrix fan-out, gate jobs, and a
custom `claude-run` runner that don't fit and would misrepresent. Instead render **one node
per workflow** with belts for `workflow_run` chains (intra-repo) and `--repo` issue-filing
(cross-repo to external-repo "station" nodes). Why: faithful to how a real fleet actually
works (event-driven between workflows), and it generalizes to any repo. The parser
(`fleet/parse.ts`) is pure and total (never throws) and mixes YAML-structure reads with
raw-text regex scans (robust across the shapes real workflows take); it correctly recovered
lifehacker's `pipeline → auto-*` hub and cross-repo edges to `zer0-mistakes`/`it-journey`.
Telemetry run-polling was generalized with a `pathPrefix` param (authored `factory--*`
default; observe passes `.github/workflows/`). Each canvas now owns its own
`ReactFlowProvider` (the shared one bled `machine` nodes into the fleet flow). A DEV-only
`__fleetStore` window hook (tree-shaken from prod) enables tokenless UI smoke tests.
Read-only per the user's "decide writes per-action later"; write paths (multi-repo, cross-
repo authoring) are Phases B/C. Alt: shoehorn into authoring types (rejected: lossy).

## 2026-07-04 — ADR-010: Telemetry is ETag-polled and follows the open panel (MVP / seed 04)
Built the Phase-4 telemetry MVP. Shape decisions: (1) **Poll, don't push.** No webhook
worker — `client.listFactoryRuns` does a conditional GET on `/actions/runs` with
`If-None-Match`; a 304 is free, so a 15s interval stays cheap. (2) **Poll only the open
factory.** Polling starts when the telemetry panel opens and stops when it closes or the
repo disconnects (ARCHITECTURE §6 rate-hygiene) — no background polling. (3) **Pure
mapping split from I/O.** `github/telemetry.ts` (LED/stats, 11 tests) is pure; the store
just wires runs → `assemblyLines(blueprint)` → per-node LEDs. To map a `factory--<slug>`
run back onto its machines, refactored the compiler to export `assemblyLines()` — one
partition helper now shared by `compile()` and telemetry so filenames line up exactly.
Scope: run *list* (conclusion/duration/link) shipped; jobs drill-down + log-zip viewing
(fflate) and per-line stat rows deferred to backlog. Alt: webhook→SSE push (rejected for
MVP — needs the optional worker, breaks the zero-backend premise).

## 2026-07-04 — ADR-009: Loop guards check the event actor (sender), not the entity author
Fixed the flagged `issue_labeled` loop-guard bug by making the compiler's bot guard
actor-based: one `github.event.sender.type != 'Bot'` clause per loopy line, replacing the
three entity-author checks (`issue.user` / `pull_request.user` / `comment.user`). Why: the
author is only incidentally the actor for `issues.opened`; on `issues.labeled` the actor is
the labeller and on `pull_request.synchronize` the actor is the pusher, so an agent's own
label/push would pass an author check and retrigger the line (golden rule #6). `sender` is
the account that caused the event, so `sender.type == 'Bot'` blocks every agent-authored
write; the three cases collapse to one clause (equivalent for opened/comment, strictly
correct for labeled/synchronize). For non-event runs (merged cron) `github.event.sender` is
null and `null != 'Bot'` is true, so those runs still proceed. Regression tests cover
labeled + synchronize; the reference output in `examples/compiled/` was updated. Alt:
patch only the labeled path (rejected — leaves the identical PR-synchronize hole and makes
the guard logic non-uniform).

## 2026-07-03 — ADR-008: GitHub I/O via a thin fetch client + tweetnacl sealed box (MVP / seed 03)
Implemented the Phase-3 MVP (connect → load/deploy → power). Two shape decisions:
(1) **fetch, not Octokit.** The transport client (`app/src/github/client.ts`) is a thin
typed wrapper over `fetch` against `api.github.com`, not `@octokit/rest`. Why: keeps the
static bundle lean, avoids Octokit's browser/ESM friction, and makes the whole client
trivially mockable via an injected `fetchImpl` (17 unit tests, zero network). Cost: we
hand-roll pagination/retries if ever needed (backlog).
(2) **tweetnacl sealed box** (`tweetnacl` + `tweetnacl-sealedbox-js`) for the power hookup,
per ARCHITECTURE §2 — encrypt `ANTHROPIC_API_KEY` in-browser against the repo public key
and PUT it; plaintext is read from an uncontrolled input and never enters React state or
storage. Architecture: a fixed contract (`github/types.ts`) let the client/crypto/deploy
modules be built in parallel by separate agents; the pure planner (`deploy.ts`) is split
from the I/O executor (`execute.ts`). Preflight approximates Workflows-write as equal to
Contents-write (REST can't cheaply distinguish them); a failed deploy surfaces the real
gap. Prompt-file *writing* is deferred to Prompt Studio (Phase 5) — deploy only warns on
missing prompt refs. Alt considered: Octokit + libsodium-wrappers (rejected: heavier,
wasm, harder to mock for a zero-backend static app).

## 2026-07-03 — ADR-007: Repo root is `gitorio/`; scaffold flattened up one level
The starter unpacked into `gitorio/gitfactory/`, leaving a duplicate `CLAUDE.md`,
the session-0 blog post, and `gitfactory-starter.zip` stranded in the outer folder.
Flattened `gitfactory/*` up so the git root is `gitorio/` with `app/`, `docs/`,
`seeds/` as direct children. Why: the CI and Pages workflows hard-assume
`working-directory: app` / `cache-dependency-path: app/package-lock.json`, the
CLAUDE.md repo map lists everything at root, and "Gitorio" (Git + Factorio) *is* the
product name. Removed the duplicate `CLAUDE.md` (byte-identical) and the starter zip;
routed the `draft: true` blog post into `blog/drafts/`. Alt: `git init` inside the
nested `gitfactory/` (rejected: leaves a stray parent folder and forces every CI path
to carry a `gitfactory/` prefix). Then `git init` (branch `main`) — the scaffold had
never been under version control.
