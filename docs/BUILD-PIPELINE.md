# Build pipeline entrypoints

> **Status: draft skeleton.** Sections marked **TODO (unverified)** were left blank
> deliberately — they need to be filled in by someone reading the actual file
> rather than guessed at. Everything else cites the file it came from. If a claim
> here and the file it cites disagree, the file wins and this page is a bug.

## Why this document exists

The determinism work — `SOURCE_DATE_EPOCH` handling, the determinism pre-check,
and the build audit — kept stalling on the same question: *what, exactly, is "the
build"?* Without an agreed list of entrypoints there is no boundary for an audit
to cover, and no way to say a determinism fix is complete.

This page is that boundary. It lists every way a build can be started, what each
one consumes, and what it emits. It is a map, not a tutorial; for the day-to-day
dev loop see [`CONTRIBUTING.md`](../CONTRIBUTING.md), and for the compiler's
output contract see [`docs/GENERATED-FILES.md`](GENERATED-FILES.md).

## Shape of the repo, in one paragraph

gitorio is a TypeScript/Vite project. Per [`README.md`](../README.md), **all
application code lives in `app/`, which is the only npm project**; Node 22 is
pinned in `.nvmrc`. There are three families of entrypoint: the npm scripts in
`app/`, the Docker Compose services that wrap them, and the GitHub Actions
workflows in `.github/workflows/`. A fourth, semi-independent pipeline — the
blueprint compiler — turns `.factory/` sources into workflow YAML.

### What this repo does *not* have

There is **no `Rakefile`, no `Makefile`, and no `_plugins/` directory** at the
repository root. If you arrived here from an issue or backlog entry that mentions
Rake tasks or Jekyll plugins, that text is describing a different repository
shape. The root contents are: `.claude/`, `.editorconfig`, `.factory/`,
`.gitattributes`, `.github/`, `.gitignore`, `.nvmrc`, `.vscode/`, `BACKLOG.md`,
`CLAUDE.md`, `CONTRIBUTING.md`, `NOTICE`, `README.md`, `SECURITY.md`, `_docs/`,
`app/`, `blog/`, `docker-compose.yml`, `docs/`, `examples/`,
`fleet.manifest.yml`, `schema/`, `seeds/`, `specs/`, `tools/`, `vendor/`.

## 1. npm scripts (`app/package.json`)

Run from inside `app/`. The names and descriptions below are taken from the
Quickstart section of [`README.md`](../README.md) and **should be confirmed
against `app/package.json`** — that file is the source of truth, this table is a
convenience copy.

| Script | Consumes | Emits |
| --- | --- | --- |
| `npm install` | `app/package.json`, lockfile | `app/node_modules/` |
| `npm run dev` | `app/src/`, Vite config | Nothing on disk — dev server with HMR on `http://localhost:5173` |
| `npm test` | test files under `app/` | Vitest results; per README, this covers the compiler invariant tests |
| `npm run typecheck` | `app/src/`, `tsconfig` | Diagnostics only (`tsc --noEmit`) |
| `npm run lint` | `app/src/`, ESLint config | Diagnostics only |
| `npm run build` | `app/src/`, Vite config | **`app/dist/`** — the production static site. README describes this as typecheck + production build |

**`npm run build` is the artifact-producing entrypoint.** For determinism
purposes it is the primary subject: everything published as the static site comes
out of `app/dist/`.

> **TODO (unverified):** transcribe the exact `scripts` block from
> `app/package.json`, including any pre/post hooks, and note the Vite version and
> whether `vite.config.*` sets an explicit `build.rollupOptions` output naming or
> hashing strategy. Hashed asset filenames are a common source of build-to-build
> diffs and an audit needs to know which scheme is in use.

## 2. Docker Compose (`docker-compose.yml`)

Compose wraps the same npm scripts in a container so no local Node is needed. The
commands below are quoted from [`README.md`](../README.md); confirm the service
and profile names against `docker-compose.yml`.

| Command | Consumes | Emits |
| --- | --- | --- |
| `docker compose up dev` | working tree, mounted into the `dev` service | Dev server on `http://localhost:5173` |
| `docker compose run --rm dev npm test` | as above | Vitest results |
| `docker compose run --rm dev npm run build` | as above | `app/dist/` on the host, via the mount |
| `docker compose --profile preview up --build` | build output | nginx serving the production build on `http://localhost:8080` |
| `docker compose down` | — | Stops everything |

README notes that the working tree is bind-mounted into `dev`, and that
`VITE_USE_POLLING=true` is set to keep HMR reliable across the macOS ↔ container
boundary.

**Determinism note:** because the tree is bind-mounted, a Compose build and a
host build write to the same `app/dist/`. Any comparison between "built in Docker"
and "built on the host" must account for the container's Node/npm versions, which
may differ from `.nvmrc` unless the image pins the same version.

> **TODO (unverified):** record the base image and pinned Node version for the
> `dev` service, the `preview` profile's build stages, and whether either sets
> `SOURCE_DATE_EPOCH` or any other reproducibility-relevant environment variable.

## 3. GitHub Actions

`.github/workflows/` contains two distinct populations, per
[`README.md`](../README.md):

1. **Hand-written workflows** — CI, GitHub Pages, and the `evolve` loop. These
   are authored and edited normally.
2. **Compiled `factory--*.yml` workflows** — emitted by the gitorio compiler from
   `.factory/blueprint.json`. README states these carry a
   `GENERATED BY GITFACTORY` header and must never be hand-edited; see
   [`docs/GENERATED-FILES.md`](GENERATED-FILES.md) for the regeneration procedure
   and the determinism / action-pinning guarantees claimed there.

Only the first population is part of *this* build pipeline. The second is
*output* of the compiler pipeline described in §4.

> **TODO (unverified) — the highest-value gap on this page.** Fill in, by reading
> the workflow files:
>
> - the filename of the CI workflow and of the Pages/deploy workflow;
> - their triggers (push branches, `pull_request`, `workflow_dispatch`, schedule);
> - runner image and how Node is installed (`actions/setup-node`? which version
>   input — does it read `.nvmrc`?);
> - whether dependency caching is enabled and what the cache key is;
> - the exact command sequence of the build job, in order;
> - what the deploy job uploads, and whether it consumes `app/dist/` directly or
>   an intermediate artifact;
> - whether any step sets `SOURCE_DATE_EPOCH`, `TZ`, or `LC_ALL`.
>
> Until this is filled in, the audit boundary is incomplete: CI is the only place
> where the build runs unattended, so it is where non-determinism actually costs
> something.

## 4. The blueprint compiler (a second, separate pipeline)

Distinct from building the frontend, gitorio compiles blueprints into workflow
YAML. Per README:

| Input | Producer | Output |
| --- | --- | --- |
| `.factory/blueprint.json`, `.factory/prompts/*.md`, `.factory/config.yml` | the compiler in `app/src/compiler/` | `.github/workflows/factory--*.yml` |
| `examples/*` blueprints | same compiler | `examples/compiled/` — reference output "the compiler converges to" |
| — | `schema/blueprint.schema.json` | the blueprint contract, described as drift-guarded against the machine registry |

README also mentions a `/compile-check` slash command under `.claude/commands/`.

**This is where determinism bites hardest.** `examples/compiled/` is committed
reference output: if the compiler is not deterministic, that directory drifts and
the check that compares against it becomes noise. An audit that covers only
`npm run build` and skips the compiler covers the less important half.

> **TODO (unverified):** name the concrete command that regenerates
> `.github/workflows/factory--*.yml` and `examples/compiled/` (an npm script? a
> CI step? only the in-app Deploy button?), and state whether any workflow
> verifies committed output matches a fresh compile.
> [`docs/GENERATED-FILES.md`](GENERATED-FILES.md) is the natural home for the
> detail; this page only needs the entrypoint name.

## 5. Repository gates (`tools/`)

README describes `tools/` as "stdlib gates": `spec_validator`, `backlog_lint`,
`pick_backlog_item`, `next_backlog_id`, `evolve_audit`, `unwrap-prose`. One is
shown in README invoked as `python3 tools/pick_backlog_item.py`.

These validate repository *content* rather than producing build artifacts, so
they sit outside the determinism boundary — but they are entrypoints, and if CI
runs them they belong in the CI job description above.

> **TODO (unverified):** list each tool's actual filename, interpreter,
> arguments and exit-code contract, and mark which ones CI invokes.

## The determinism audit boundary

For the determinism items, "the build" means:

**In scope**

1. `npm run build` in `app/` → `app/dist/`.
2. The same build as executed by the GitHub Actions build job (§3).
3. The blueprint compiler's output: `.github/workflows/factory--*.yml` and
   `examples/compiled/` (§4).

**Out of scope**

- `npm run dev` and the Compose `dev` service (no committed artifact).
- `npm test`, `npm run typecheck`, `npm run lint` (diagnostics only).
- `tools/` gates (validate content, emit no artifact).
- Everything under `_docs/`, `docs/`, `specs/`, `seeds/`, `blog/`, `vendor/`.

An audit is complete when, for each of the three in-scope outputs, two builds
from the same commit produce byte-identical results — and where they don't, the
cause is recorded against the entrypoint above that produced the difference.

### Open questions this document does not answer

- Is `SOURCE_DATE_EPOCH` read anywhere today? Nothing in the evidence available
  when this page was drafted showed it being set or consumed.
- Does the Vite build embed a timestamp, git SHA, or build ID into `app/dist/`?
- Are compiled workflow files timestamp-stamped in their
  `GENERATED BY GITFACTORY` header? If so, that header is a guaranteed diff on
  every regeneration and needs an explicit decision.

## Keeping this page true

This is a map of entrypoints, so it goes stale whenever one is added, renamed or
removed. If you add an npm script that writes to disk, a Compose service, or a
workflow job that builds anything, add a row here in the same change. If a
`TODO (unverified)` block above is still present, treat it as a known gap rather
than as "nothing to document".
