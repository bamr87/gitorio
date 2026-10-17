# Nexus Forge (gitnexus)

> Nexus Forge: a static rebuild-spec workbench (PRD, architecture, 14-step playbook) for reimplementing GitNexus.

[![License](https://img.shields.io/github/license/bamr87/gitnexus)](LICENSE)

## Overview

Nexus Forge is a static rebuild-specification workbench for [GitNexus](https://github.com/abhigyanpatwari/GitNexus). It collects the PRD, architecture, feature catalog, pipeline DAG, graph schema, MCP and CLI surfaces, and a 14-milestone rebuild playbook in one browsable app, to be used as the instruction set for reimplementing the engine from scratch.

The repo was exported from Grok's App Builder, so it is an App Builder template (TanStack Start, React 19, Tailwind v4) with the workbench content layered on top. Auth and the database are off; the only persisted state is the playbook checklist in `localStorage`.

## Features

- One page per section: overview, PRD, architecture, features, pipeline, schema, models, stack, packages, languages, MCP, CLI, quality and playbook
- Content-as-data: every page renders typed constants from `src/data/*.ts`
- A ⌘K command palette that searches all sections
- A 14-milestone rebuild playbook with a checklist saved in the browser

## Quick start

```bash
npm install
npm run dev        # Vite dev server on http://localhost:8080
```

Always start Vite through the npm scripts; `scripts/with-app-env.mjs` injects `.grok/app-env.json` into the environment.

## Project structure

| Path | What it is |
|---|---|
| `src/routes/` | One TanStack file route per section |
| `src/data/` | Typed content behind every page, plus the search index |
| `src/components/` | App shell, page primitives and command palette |
| `scripts/` | Env injection, preview server, smoke and auth checks |
| `server/` | Nitro server middleware from the template |
| `AGENTS.md` | Grok App Builder sandbox contract |

## Development

```bash
npm run typecheck
npm run lint
npm run test
```

Full commands, conventions and gotchas for humans and AI agents live in [AGENTS.md](AGENTS.md).

## Contributing

Contributions are welcome via pull request. Use [Conventional Commits](https://www.conventionalcommits.org/) and keep the CI checks green. The fleet-wide workflow is described in the hub's [CONTRIBUTING.md](https://github.com/bamr87/bamr87/blob/main/CONTRIBUTING.md). AI agents should start with [AGENTS.md](AGENTS.md) (with [CLAUDE.md](CLAUDE.md) for Claude Code).

## Changelog

Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md); the full record is in the [commit history](https://github.com/bamr87/gitnexus/commits/main).

## License

Released under the [MIT License](LICENSE).

---

<!-- bamr87-portfolio-footer -->
Part of the [bamr87 portfolio](https://github.com/bamr87) — browse every project on [Amr's GitHub profile](https://github.com/bamr87).
