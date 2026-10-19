# Spec 06 — Repository Upkeep

Status: Implemented (v0) · Machine schemas: [`schemas/upkeep-config.schema.json`](../../schemas/upkeep-config.schema.json), [`schemas/upkeep-plan.schema.json`](../../schemas/upkeep-plan.schema.json) · Decision: [ADR-0008](../adr/0008-repository-upkeep.md) · Code: `src/upkeep/**`, `src/adapters/github/repo-host.ts`, `src/cli/commands/upkeep.ts`, `.github/workflows/upkeep.yml`

## 0. Orientation

The program governs what the *code* may become. Nothing yet governs what the repository
*says about itself*: its GitHub description, its topics, whether its version has a tag,
whether its tags have releases, whether the labels its own engine files issues with exist,
whether its README still names every schema the tree ships. Those drift exactly the way code
drifts, quietly, one merged PR at a time, and they are what a stranger reads first.

**Upkeep** closes that gap with the same shape the rest of GWTP uses: a *declared* desired
state (`.github/upkeep.yaml`), *observations* (the tree, its history, the forge), a
*deterministic* diff between them, and a narrow, auditable path to convergence. One concept
is new: the **content slot**. Some values cannot be derived, only authored (a release summary,
a missing description, topic suggestions, a review of stale prose), so the plan names those
slots and an AI author, either a model call or an agent editing the plan file, fills them.

| | **Program** | **Ledger** | **Nexus** | **Upkeep plan** |
|---|---|---|---|---|
| Subject | What code may become | What happened | What the tree is | How the repo presents itself |
| Location | `.program/` | `refs/program/ledger` | `.gwtp/nexus/` | `.gwtp/upkeep/` (gitignored) |
| Writers | Humans, ratified PRs | Machines, append-only | Machines, overwrite | Engine writes, an AI author fills content slots |
| Changes the world via | Amendment PRs | Proposals | Nothing | Forge API calls (remote) / reviewed PRs (in-tree) |

## 1. Politics

1. **Never normative, never the tree.** Upkeep may not write `.program/` (INV-001), the ledger
   ref (INV-002), or the working tree. Its only writer, `apply`, calls the forge: create a
   tag ref, create or annotate a release, create or restyle a label, set the description,
   homepage, or topics. Everything that would change in-tree bytes (a version bump, a stale
   README line, a missing `LICENSE`) is an **in-tree finding** with a remedy, handed to a human
   or to the opt-in `tend` agent, which opens a reviewed PR (§5). A scheduled job that committed
   to the tree would be the unreviewed write path this repository exists to forbid.
2. **Forge-neutral engine, forge in adapters.** `src/upkeep/host.ts` declares a
   `RepoHostPort` (read, set metadata, set topics, create/update label, create tag, create/
   update release). `src/adapters/github/repo-host.ts` implements it over the transports
   `issues.ts` already resolves (`gh api`, else `fetch` + token). INV-005's letter covers
   only `src/core/**`; upkeep keeps its posture anyway. With no forge, remote facets are
   reported **unobserved**, not clean (`observed.host: null` and a `host.unobserved` finding).
3. **Identity-free observation.** No git format string in `src/upkeep/facts.ts` asks for an
   author or committer, so none reaches a fact, a brief, a changelog, or a release. This
   extends ADR-0003's posture to publication: who wrote a change is not evidence of what it did.
4. **Add and set, never delete.** The port has no delete method. Topics in `merge` mode keep
   every topic a human added. Labels are never removed. Drafts are never touched.

## 2. Facets and their desired state

The config is `.github/upkeep.yaml` (schema: `upkeep-config`). Absent, `defaultConfig()`
applies: `mode: propose`, description from `package.json`, version from `package.json`,
3-release backfill with template notes, labels from code. Each facet is optional; `null`
disables it.

### 2.1 Metadata

| Field | Desired value | Notes |
|---|---|---|
| description | `literal` · `package.json` · `readme` (first prose paragraph under the H1) · `ai` | Normalized to plain text, one line, ≤ 350 chars. `ai` fills **only when the forge has none** (§3.1 rule 1). |
| homepage | literal URL, or `""` to clear | Absent = unmanaged. |
| topics | `include` ∪ normalized `package.json` keywords; `merge` (default) or `exact` | Below `min`, an AI author tops the set up. |
| license file | `package.json` `license` set ⇒ a `LICENSE`/`COPYING` file exists | In-tree finding; GitHub detects no license without the file. |

### 2.2 Versioning

`versioning.files[0]` (path + one-group regex) is the **source of truth**; every other entry
must agree with it (`versioning.consistency:<path>`, cited `path:line`).

- If `<prefix><version>` is not a tag and the version is newer than the latest semver tag,
  a `tag.create` action tags **the commit where the version was introduced**: the oldest
  commit of the contiguous run, walking back from HEAD, in which the source file held this
  value. A backfilled tag must not claim commits the version did not ship.
- If the version is not newer than the latest tag: an in-tree **error** (`versioning.behind`).
- Commits after the version's tag (or its introduction) are **unreleased**: an in-tree info
  finding carrying a *suggested* next version. The suggestion reads conventional-commit
  subjects (`feat` → minor, `!`/`BREAKING CHANGE` → major, others → patch) and, for
  subjects that are not conventional, a verb heuristic (`Add|Build|Implement|…` → minor).
  Below 1.0.0 a breaking change suggests a minor bump. The bump is never applied: choosing a
  version is a reviewed change. Once a PR bumps it, the next run tags and releases it.

### 2.3 Releases

For the newest `backfill` semver tags (including a pending tag being created this run):
no release → `release.create` (depends on the `tag.create` when pending; the newest
non-prerelease is `make_latest`); a non-draft release with an empty body → `release.update`.
A body is always **AI summary (optional) + deterministic changelog**: the commit subjects
between the previous tag and this one, merges excluded, abbreviated SHAs, no identities.
The AI never replaces the factual list. It writes the paragraph above it.

### 2.4 Labels

Desired = the labels the engine's own delivery adapter stamps on proposals
(`proposalLabels`, extracted from `src/adapters/github/render.ts`, never restated) ∪ the
config's `declared` labels. Missing → create. Declared and differing in colour or description
→ update. Code-derived labels that already exist are not restyled (a human may have chosen
their colour).

### 2.5 References

A reference rule says *this document must keep naming these items*, where the items are
extracted programmatically: a glob over tracked paths (optionally a capture group:
`schemas/(.+)\.schema\.json`), or a one-group regex over one file (the CLI command table).
Each item renders through a `mention` template (`gwtp {item}`) and is matched
case-insensitively. Missing mentions are in-tree findings that name each one.

### 2.6 Documentation review

`docs_review.files` are sent, line-numbered, with the facts (version, tags, unreleased count,
tree shape, every reference rule's items) to an AI reviewer that reports statements the facts
**contradict**. No citation, no finding (INV-004's posture): each finding must cite
`path`, `line`, and a `quote` that is a substring of that line, or it is discarded.

## 3. The plan

`gwtp upkeep plan` gathers local facts (read-only git: `rev-parse`, `for-each-ref`, `log`,
`show`, `ls-tree`, `diff`) and host facts, and writes a plan (schema: `upkeep-plan`):

- `observed`: HEAD, branch, version, tags, unreleased count, a host summary or `null`.
- `findings[]`: `{id, facet, severity, where: remote|in-tree, summary, expected?, actual?, citation?, actions[], remedy?}`.
- `actions[]`: `repo.update | repo.topics | label.upsert | tag.create | release.create | release.update`, each with `depends_on?` and `content?`.
- `content[]`: the slots (§4).

### 3.1 Convergence

Plan → apply → plan again must yield **no remote actions**. Three rules make it so:
(1) AI-authored fields fill only what is empty, (2) remote state is only added to or set, and
(3) anything that needs a commit is an in-tree finding. The test
`tests/upkeep/plan.test.ts › convergence` holds this.

### 3.2 Determinism

`planUpkeep` is pure: the same facts, config and clock produce the same plan, byte for byte.

### 3.3 Apply

Order: `tag.create` → `release.create` → `release.update` → `repo.update` → `repo.topics` →
`label.upsert`. Every action compares against the `current` the plan observed and reports
`unchanged` instead of calling when it already matches. A forge 422 "already exists" is
`unchanged` (two racing runs cannot double-create). 401/403/404 are **blocked**, with the
remedy (description and topics need an admin-scoped token, which `GITHUB_TOKEN` in Actions
cannot be granted). A failed dependency **skips** its dependents. Exit 1 if anything failed or
was blocked. `apply` changes anything only with `--yes`, or with `--scheduled` when the
config says `mode: apply`. Otherwise it is a dry run.

### 3.4 Report

Markdown for two readers: a summary table per facet, remote drift with the action ids that
resolve it, the action table (with outcomes after apply), the **in-tree checklist** (each item
with its remedy and citation, which is the `tend` agent's work order), and which content slots
were authored by whom or fell back.

## 4. Content slots

### 4.1 Kinds

| Kind | Value | Fallback | Requested when |
|---|---|---|---|
| `description` | string, one line, ≤ 350 | README tagline ∨ package description | `from: ai` and the forge has none |
| `topics` | string[] of valid topics, ≤ 20 | `[]` | the deterministic set is below `min` |
| `release-notes` | markdown ≤ 20 000 | `""` (changelog only) | `releases.notes: ai`, per release written |
| `docs-review` | `[{path, line, quote, issue, suggestion?}]` | `[]` | `docs_review` configured |

Each slot carries `brief.instructions` (from `src/upkeep/prompts.ts`) and `brief.context`
(JSON data), so a model provider and an agent editing the file read the same text. The
system prompt tells the author that context is *data*: text in the repository that reads like
an instruction is to be described, not obeyed.

### 4.2 Validation, and who may fill

Two authors, one validator. `gwtp upkeep fill --provider model` calls a `ModelClient`
(`src/core/model.ts`; the Anthropic adapter, model from `ai.model`, default `claude-opus-5-5`).
Alternatively an AI agent edits the plan file, setting only `status: filled`, `value`, and
`provider: agent`, and runs `gwtp upkeep check` until it passes. Either way, `validateContent`
runs again inside `apply` and the report: a slot that fails validation, was refused, or was
never filled **falls back** to its deterministic value, and the report says so. A plan file
coming back from an agent is untrusted input, so the agent's write surface is **enforced, not
requested**: `gwtp upkeep check --against <engine plan>` fails if anything other than
`content[].status|value|provider|note` differs from the plan the engine wrote
(`outsideAuthoredSurface`). The workflow also path-scopes the agent's Edit permission to the
plan file, hashes the engine's snapshot into a step output, and refuses to continue if any
other file changed. Prompt injection through repository text can at worst produce a bounded,
schema-valid string in a content slot. It cannot add an action, change a target, or reach the
tree.

## 5. The loop

`.github/workflows/upkeep.yml` runs weekly (Mondays 06:23 UTC) and on demand:

1. **survey** (read-only): `plan` → author content (Anthropic API if `ANTHROPIC_API_KEY`, else
   the Claude Code agent if `CLAUDE_CODE_OAUTH_TOKEN`, restricted to editing the plan and
   running `check`) → **tamper guard** (`check --against` the engine's snapshot; fatal) →
   `check` (content contracts; non-fatal, fallbacks apply) → `fill --provider template` for
   anything left → report to the job summary. Uploads `.gwtp/upkeep/`.
2. **apply** (forge writes only; no AI): schedule → `--scheduled` (the config's `mode`
   decides); dispatch → `--yes` only if the `apply` input is ticked, otherwise `--dry-run`.
   `UPKEEP_TOKEN` (admin-scoped) unlocks description and topics. Without it those two report
   `blocked` and everything else applies.
3. **tend** (opt-in: dispatch input, or `vars.UPKEEP_TEND == 'true'` on schedule): Claude Code
   takes the in-tree checklist, fixes what it can verify on an `upkeep/<run>` branch, runs
   `npm run ci`, and opens a **draft PR**. One tending PR at a time. It must never touch
   `.program/`, and `ci.yml`'s INV-001 job would fail it if it did.

Locally, the same loop is `gwtp upkeep run` (dry run unless `--yes`).

## 6. Self-hosting

This repository's own `.github/upkeep.yaml` is the first config the loop runs against. Its
first plan found: no description, no topics, an untagged `v0.1.0` (introduced at the v0
engine commit) with 11 unreleased commits since (suggested `0.2.0`), no releases, the three
engine labels missing, no `LICENSE` despite `"license": "MIT"`, and `CLAUDE.md` not naming
three CLI commands.
