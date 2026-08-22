# File ownership: what the generator writes, what you write

> **Status: DRAFT — generator behaviour not yet confirmed.**
>
> The sections below marked `UNCONFIRMED` were written without access to the
> compiler's write path. Do not rely on them. See
> [Open questions](#open-questions-fill-these-in) for what has to be checked
> before this document is trustworthy, and please delete this banner (and the
> `UNCONFIRMED` markers) once it has been.

## Why this page exists

GitFactory compiles blueprints into real GitHub Actions workflows. Any tool that
writes files into a repository raises the same question for everyone who touches
that repository:

> If I edit this file, will it still be here after the next compile?

This page is meant to be the one place that answers it. The rule of thumb is:

- **Generator-owned paths** — treat as build output. Edit the blueprint or the
  prompt, re-compile, commit the result. Hand edits here are expected to be lost.
- **Hand-editable paths** — the source of truth. The generator reads these; it
  does not rewrite them.

## Repository layout

What each top-level path is for. The **Evidence** column records how confident
this document is about each row, because being wrong here is worse than being
silent.

| Path | What it is | Ownership | Evidence |
| --- | --- | --- | --- |
| `app/` | The frontend — the canvas, the palette, the compiler. Static site; `npm install && npm run dev` from here. | Hand-editable | `README.md` "Quickstart (development)" |
| `app/dist/` | Production build output (`npm run build`). | Build output — not hand-editable, and normally not committed | `README.md` "Run with Docker" |
| `.github/workflows/` | Compiled GitHub Actions workflows. | **Generator-owned (UNCONFIRMED)** — see [Open questions](#open-questions-fill-these-in) | Inferred from `README.md`: blueprints "compile into real GitHub Actions workflows". The emit path was not inspected. |
| `.factory/` | Where this repo dogfoods GitFactory on itself. | **UNCONFIRMED** — unclear whether this holds hand-authored blueprint *sources* or compiler *output* | `README.md` "Status": "dogfooding itself in `.factory/`" |
| `seeds/` | Ordered session prompts with acceptance criteria, for building this repo with Claude Code. | Hand-editable | `README.md` "Building this with Claude Code" |
| `.claude/` | Claude Code project config, including `.claude/commands/` (`/add-machine`, `/compile-check`, `/session-log`). | Hand-editable | `README.md` "Building this with Claude Code" |
| `CLAUDE.md` | Project memory: architecture, golden rules, definition of done. | Hand-editable | `README.md` "Building this with Claude Code" |
| `docs/` | Human-written documentation, e.g. `docs/ROADMAP.md`. | Hand-editable | `README.md` "Quickstart (development)" links `docs/ROADMAP.md` |
| `_docs/` | A second documentation directory. **UNCONFIRMED** — relationship to `docs/` not established. | Presumed hand-editable | Top-level listing only |
| `schema/` | **UNCONFIRMED** — presumed blueprint/machine schema definitions. | Presumed hand-editable | Top-level listing only |
| `specs/` | **UNCONFIRMED** — presumed written specifications. | Presumed hand-editable | Top-level listing only |
| `tools/` | **UNCONFIRMED** — presumed repo tooling/scripts. | Presumed hand-editable | Top-level listing only |
| `examples/` | **UNCONFIRMED** — presumed example blueprints. | Presumed hand-editable | Top-level listing only |
| `blog/` | **UNCONFIRMED**. | Presumed hand-editable | Top-level listing only |
| `fleet.manifest.yml` | **UNCONFIRMED** — contents not inspected. | Presumed hand-editable | Top-level listing only |
| `docker-compose.yml`, `.vscode/`, `.editorconfig`, `.nvmrc`, `.gitattributes`, `.gitignore` | Local development and editor setup. | Hand-editable | `README.md` "Run with Docker" and "Debugging in VS Code" |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `BACKLOG.md` | Repo documentation. | Hand-editable | Top-level listing |

## The rule that actually matters: pruning

Overwriting is only half the question. The other half is whether the generator
**deletes files it did not emit** in the directories it owns. The two behaviours
lead to very different habits:

- **Overwrite-only.** A file you add by hand to a generator-owned directory
  survives, as long as its name does not collide with an emitted file. Risk:
  orphaned workflows linger after you delete a machine from the blueprint.
- **Prune-unknown.** The directory is fully reconciled to the blueprint on every
  run; anything not emitted is removed. Risk: a hand-written workflow dropped
  next to the generated ones disappears without warning.

**This repository's behaviour is UNCONFIRMED.** Until it is written down here,
assume the destructive case — put hand-written workflows somewhere the generator
does not own, and keep generator-owned directories free of anything you care
about.

## Working with generator-owned files

When the table above is settled, the workflow for a generator-owned path is:

1. Change the blueprint (or the prompt the machine runs), not the emitted file.
2. Re-compile.
3. Commit the emitted diff alongside the blueprint change, so review sees both
   the intent and the result. The README makes the point that emitted YAML is
   meant to be "readable, auditable, and works without GitFactory existing" —
   which only holds if it is committed and reviewed like any other file.

If you find yourself wanting to hand-edit an emitted file, that is a signal the
blueprint or the machine definition is missing an option. Raise it rather than
patching downstream.

## Open questions (fill these in)

Answering these turns this page from a draft into documentation. The compiler
lives under `app/`; the answers should come from its emit/write code, not from
observing one run.

1. **Output root.** Which exact directory does a compile write to? Is it fixed,
   or configurable per blueprint?
2. **Filename convention.** Is there a prefix, suffix, or naming scheme that
   identifies an emitted file (e.g. `gitfactory-*.yml`)? Quote it literally so
   people can grep for it.
3. **Marker header.** Do emitted files carry a `DO NOT EDIT` banner, a source
   blueprint reference, or a content hash? Quote the exact string.
4. **Pruning.** Does the compiler delete files in the output directory that it
   did not emit this run? If yes: does it prune everything, or only files
   matching the naming convention / carrying the marker header?
5. **Collision.** What happens if an emitted filename collides with a
   hand-written file — overwrite silently, refuse, or warn?
6. **`.factory/`.** Source, output, or both? If both, which subpaths are which?
7. **Escape hatch.** Is there a supported way to keep a hand-written workflow in
   a generator-owned directory (an ignore list, a marker comment), or is the
   answer simply "don't"?

When you answer these, please also update the ownership table above and remove
the `UNCONFIRMED` markers for the rows you settled.
