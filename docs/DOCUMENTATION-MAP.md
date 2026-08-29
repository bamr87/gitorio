# Documentation map

This repository has four root-level directories that all contain prose:
`docs/`, `_docs/`, `specs/`, and `blog/`. They are not redundant — each has a
different audience, a different lifecycle, and a different destination. This
page is the single place that says which is which, so that "where does this
writing go?" has one answer instead of four plausible ones.

> **Status.** This page was written from the repository layout table in
> [`README.md`](../README.md) rather than from a maintainer's design note.
> Sections marked **Unverified** need a maintainer's confirmation; correct them
> in place rather than opening a new page.

## The split at a glance

| Directory | Audience | Authored or generated | Published where | Lifecycle |
| --- | --- | --- | --- | --- |
| `docs/` | Contributors and maintainers of *this* repo | Authored by hand | Read on GitHub, in-repo | Long-lived; edited in place as the design changes |
| `_docs/` | End users of the GitFactory app | Authored, then tended by an agent | Rendered in the app's **Docs** tab | Long-lived; maintained by the Docs Gardener line |
| `specs/` | Whoever is implementing one backlog item | Authored per work item, via AO-SDLC | Not published; in-repo only | Per-item; written once, superseded by the code |
| `blog/` | Readers of an external publication | Authored per session | Destined for another repo ("it-journey") | Transient here; leaves once promoted |

## Where does this writing go?

Work down the list and stop at the first match.

1. **Is it a narrative account of a working session — what you tried, what broke,
   what you learned?** → `blog/drafts/`.
2. **Is it the plan for one specific backlog item you are about to build?** →
   `specs/NNN-slug/`.
3. **Is it something a *user of the deployed app* needs, and should show up in
   the app's Docs tab?** → `_docs/`.
4. **Is it something a *contributor to this repo* needs — architecture, process,
   a decision record, an explanation of a generated artefact?** → `docs/`.
5. **Is it "how do I get started" or "what is this project"?** → the root
   [`README.md`](../README.md), or one of the root files it links to
   (`CLAUDE.md`, `CONTRIBUTING.md`, `BACKLOG.md`, `SECURITY.md`).

If two of these seem to fit, the writing is probably two documents.

---

## `docs/` — design documentation for contributors

**Audience.** People changing this repository: contributors, maintainers, and
Claude Code sessions reading for context.

**Authored or generated.** Authored by hand. Nothing here is compiler output.

**Contents.** Per the README layout table, this directory holds
`ARCHITECTURE.md` (the full design: auth phases, compiler spec, security model,
machine catalog), `ROADMAP.md` (phases and acceptance history), `DECISIONS.md`
(the ADR log), `AO-SDLC.md` (the spec-driven session workflow), and
`GENERATED-FILES.md` (which files the compiler writes and how to regenerate
them) — plus this page.

**Lifecycle.** Long-lived. Edit in place when the design changes; the git
history is the archive. New *decisions* get appended to `DECISIONS.md` rather
than becoming new files.

**Rule of thumb.** If it explains how the system is built or why it is built
that way, it belongs here.

## `_docs/` — the app's docs collection

**Audience.** Users of the GitFactory app, reading inside the app itself.

**Authored or generated.** Authored — and then *tended* by the Docs Gardener
line defined in `.factory/`. The leading underscore marks it as a collection
consumed by the app rather than a directory you browse on GitHub.

**Published where.** Rendered in the application's **Docs** tab. This is the
only one of the four directories whose contents are user-facing at runtime,
which makes it the one where wording, ordering, and staleness actually matter
to someone who has never seen the repo.

**Lifecycle.** Long-lived, and actively maintained: the Docs Gardener line is a
machine in this repo's own blueprint (`.factory/blueprint.json`, with its prompt
in `.factory/prompts/`), so pages here can be revisited by an agent rather than
only by a human.

**Unverified.** Three things a maintainer should nail down and add here:

- The file naming convention and whether pages need front matter (title, order,
  slug). Until that is written down, copy the shape of an existing page — the
  loader behind the app's Docs tab in `app/src/` is the authority.
- Exactly what the Docs Gardener does to this directory: whether it authors new
  pages, only edits existing ones, or opens PRs for review.
- Whether any part of `_docs/` is generated. This page assumes **not** —
  "tended", not "compiled". If that is wrong, fix this section first, because
  the practical consequence (never hand-edit) is the opposite of what is written
  above. Cross-check against
  [`GENERATED-FILES.md`](GENERATED-FILES.md), which is the canonical list of
  compiler outputs.

**Rule of thumb.** If a user of the deployed factory would search for it, it
belongs here. If only someone editing the compiler would search for it, it
belongs in `docs/`.

## `specs/` — AO-SDLC spec packages

**Audience.** Whoever — human or agent — is implementing one particular backlog
item, during the session in which they implement it.

**Authored or generated.** Authored, but through a fixed command chain rather
than freehand. Per the README, work enters via `BACKLOG.md`, an item is picked
(`python3 tools/pick_backlog_item.py`), and then `/specify` → `/clarify` →
`/plan` → `/tasks` → `/implement` produces and consumes the package. The
structure is `specs/NNN-slug/{spec,plan,tasks}.md`, and `tools/spec_validator`
gates it.

**Published where.** Nowhere. These are working documents, read in-repo.

**Lifecycle.** Per work item. A spec package is written before the code and is
superseded by the code; it is a record of intent at a moment, not a description
of the current system. **Do not** treat a spec as documentation of how something
works today — that is what `docs/ARCHITECTURE.md` is for. If a spec package
taught you something durable, promote that paragraph into `docs/` (or
`DECISIONS.md`) rather than leaving readers to excavate it.

**Unverified.** Whether completed spec packages are archived, deleted, or left
in place indefinitely, and whether the numbering is ever reused. A maintainer
should state the retention policy here.

**Related but distinct.** `seeds/` also looks like a spec archive but is not:
the README describes it as the closed, historical bootstrap-era session prompts
(00–07), explicitly *not* an intake path. Nothing new goes there.

## `blog/` — session logs bound for elsewhere

**Audience.** Readers of an external publication, not of this repository.

**Authored or generated.** Authored per session, with `/session-log` among the
slash commands in `.claude/commands/`.

**Published where.** Not here. Per the README, `blog/drafts/` holds "session
logs headed for the it-journey repo" — this directory is a staging area, and the
finished writing lives in another repository.

**Lifecycle.** Transient. A draft's purpose is to leave. Because it is a
holding pen, do not link to `blog/` from `docs/` or `_docs/`: the target may
move out from under the link.

**Unverified.** How and when drafts are promoted to the it-journey repo (manual
copy? an automated line? a submodule?), whether the draft is deleted or kept
after promotion, and whether anything besides `drafts/` lives under `blog/`.

---

## Things that are deliberately *not* in any of these

For completeness, the other places prose lives in this repo:

- **Root files.** `README.md` (front door), `CLAUDE.md` (project memory for
  Claude Code — the golden rules and current state), `CONTRIBUTING.md` (the dev
  loop and session workflow), `BACKLOG.md` (the append-only `BL-*` work
  register, where all non-trivial work enters), `SECURITY.md`.
- **`.factory/prompts/*.md`.** These are *source* for the compiler — the prompt
  contracts for this repo's own agent lines — not documentation. See
  [`GENERATED-FILES.md`](GENERATED-FILES.md).
- **`examples/`.** Example blueprints and reference compiler output; the prose
  in there exists to explain the examples, not the project.

## Keeping this page honest

When you add a fifth prose directory, or move one of these four, update this
page and the layout table in [`README.md`](../README.md) in the same change.
Two places is already one too many; the README table is the pointer, this page
is the explanation.
