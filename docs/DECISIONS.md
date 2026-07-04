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
