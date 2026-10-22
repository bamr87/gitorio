# Documentation map

> Which of the four prose directories — `docs/`, `_docs/`, `specs/` and `blog/` — a piece of writing belongs in, who reads each one, and how long it lives.

This repository has four root-level directories that all contain prose. They are not redundant — each has a different audience, a different lifecycle, and a different destination. This page is the single place that says which is which, so that "where does this writing go?" has one answer instead of four plausible ones.

## The split at a glance

| Directory | Audience | Authored or generated | Published where | Lifecycle |
| --- | --- | --- | --- | --- |
| `docs/` | Contributors and maintainers of *this* repo | Authored by hand, except the generated `docs/reference/` and the index span in `docs/README.md` | Read on GitHub, in-repo | Long-lived; edited in place as the design changes |
| `_docs/` | End users of the GitFactory app | Authored, then tended by an agent | Rendered in the app's **Docs** tab | Long-lived; maintained by the Docs Gardener line |
| `specs/` | Whoever is implementing one backlog item | Authored per work item, via AO-SDLC | Not published; in-repo only | Per-item; written once, superseded by the code |
| `blog/` | Readers of an external publication | Authored per session | Destined for another repo ("it-journey") | Transient here; leaves once promoted |

## Where does this writing go?

Work down the list and stop at the first match.

1. **Is it a narrative account of a working session — what you tried, what broke, what you learned?** → `blog/drafts/`.
2. **Is it the plan for one specific backlog item you are about to build?** → `specs/NNN-slug/`.
3. **Is it something a *user of the deployed app* needs, and should show up in the app's Docs tab?** → `_docs/`.
4. **Is it something a *contributor to this repo* needs — architecture, process, a decision record, an explanation of a generated artefact?** → `docs/`.
5. **Is it "how do I get started" or "what is this project"?** → the root [`README.md`](../README.md), or one of the root files it links to (`AGENTS.md`, `CONTRIBUTING.md`, `BACKLOG.md`, `SECURITY.md`).

If two of these seem to fit, the writing is probably two documents.

## `docs/` — design documentation for contributors

**Audience.** People changing this repository: contributors, maintainers, and Claude Code sessions reading for context.

**Contents.** [`README.md`](README.md) indexes every file here, one line each, generated from each document's summary line. `reference/` holds reference generated from source (today the machine reference, from the registry); everything else is written by hand.

**Lifecycle.** Long-lived. Edit in place when the design changes; the git history is the archive. New *decisions* get appended to `DECISIONS.md` rather than becoming new files. Every document opens with one H1 and a one-sentence `>` summary, which is what the index shows.

**Rule of thumb.** If it explains how the system is built or why it is built that way, it belongs here.

## `_docs/` — the app's docs collection

**Audience.** Users of the GitFactory app, reading inside the app itself.

**Published where.** The Docs tab bundles every `_docs/*.md` at build time (`app/src/docs/load.ts`, `import.meta.glob`, flat — no subdirectories) and renders it with the app's own Markdown renderer, so a merged change ships with the next Pages deploy. This is the only one of the four directories whose contents are user-facing at runtime.

**Shape.** One page per file; the file name is the slug. Front matter carries `title` (falls back to the title-cased slug), `description`, and a numeric `order` that sorts pages before the alphabetical rest. A `::map <slug> [caption]` line embeds a delivered map (`app/public/maps/manifest.json` lists the slugs). The page keeps its front matter rather than a `>` summary line, because the app renders the body as written.

**Maintained by.** Humans and the **Docs Gardener** line (`.factory/docs-gardener.blueprint.json`, prompt in `.factory/prompts/docs-gardener.md`): each run it improves up to `itemsPerRun` existing pages in place against the `reviewCriteria` in `.factory/config.yml`, keeps their front matter, and opens one pull request for a human to merge — it never merges and does not author new pages. The line is default-OFF until the `DOCS_GARDENER_ENABLED` repo variable is `true`. Nothing in `_docs/` is generated; see [`GENERATED-FILES.md`](GENERATED-FILES.md) for what is.

**Rule of thumb.** If a user of the deployed factory would search for it, it belongs here. If only someone editing the compiler would search for it, it belongs in `docs/`.

## `specs/` — AO-SDLC spec packages

**Audience.** Whoever — human or agent — is implementing one particular backlog item, during the session in which they implement it.

**Authored through a fixed chain.** Work enters via `BACKLOG.md`, an item is picked (`python3 tools/pick_backlog_item.py`), and `/specify` → `/clarify` → `/plan` → `/tasks` → `/implement` produces and consumes the package `specs/NNN-slug/{spec,plan,tasks}.md` (`NNN` is the next free number). `tools/spec_validator.py` gates it; [`specs/README.md`](../specs/README.md) has the workflow.

**Lifecycle.** Per work item. A spec package is written before the code and is superseded by the code; it is a record of intent at a moment, not a description of the current system. Shipped packages stay in place, and a merged spec is never edited — a change of intent is an amendment spec. **Do not** treat a spec as documentation of how something works today — that is what `docs/ARCHITECTURE.md` is for. If a spec package taught you something durable, promote that paragraph into `docs/` (or `DECISIONS.md`).

**Related but distinct.** `seeds/` also looks like a spec archive but is not: it holds the closed, historical bootstrap-era session prompts (00–07), explicitly *not* an intake path. Nothing new goes there.

## `blog/` — session logs bound for elsewhere

**Audience.** Readers of an external publication, not of this repository.

**Authored per session** by `/session-log` (golden rule #10): a `blog/drafts/YYYY-MM-DD-<slug>.md` post with `draft: true` front matter and a *Working-with-AI tip* section. Drafts are reviewed and moved to the it-journey repo — no workflow here automates the move; [`blog/README.md`](../blog/README.md) describes the hand-off.

**Lifecycle.** Transient. A draft's purpose is to leave. Because it is a holding pen, do not link to `blog/` from `docs/` or `_docs/`: the target may move out from under the link.

## Things that are deliberately *not* in any of these

- **Root files.** `README.md` (front door), `AGENTS.md` (commands, conventions and golden rules for agents and contributors; `CLAUDE.md` only imports it), `CONTRIBUTING.md` (the contribution workflow), `BACKLOG.md` (the append-only `BL-*` work register, where all non-trivial work enters), `SECURITY.md`, `PRD.md`, `CHANGELOG.md` (written by release-please).
- **`.factory/prompts/*.md`.** These are *source* for the compiler — the prompt contracts for this repo's own agent lines — not documentation. See [`GENERATED-FILES.md`](GENERATED-FILES.md).
- **`examples/`.** Example blueprints and reference compiler output; the prose in there exists to explain the examples, not the project.
- **`packages/*/`.** The two imported repositories keep their own docs, governed inside each package.

When you add a fifth prose directory, or move one of these four, update this page and the project-structure table in [`README.md`](../README.md) in the same change.
