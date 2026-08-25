# Generated files

> **If you landed here from a comment at the top of a file: that file is
> compiler output. Do not edit it by hand. Edit the blueprint it was compiled
> from, then recompile.**

This page is the canonical explanation of which files in this repository are
written by a human and which are written by the GitFactory compiler.

## The short version

GitFactory is a factory builder: you design automation as a **blueprint**, and
the compiler turns that blueprint into **real GitHub Actions workflows**. Both
the blueprint and its output live in the repository, which is what makes the
automation reviewable — but it also means two kinds of file sit next to each
other in your diff.

| | Source (edit this) | Output (don't) |
| --- | --- | --- |
| Lives in | `.factory/` | `.github/workflows/` |
| Written by | you, or an agent on your behalf | the compiler |
| Changed by | editing it | editing the blueprint and recompiling |
| Reviewed for | intent — is this the automation we want? | fidelity — does it match the blueprint? |

This repository dogfoods itself: the blueprints under `.factory/` describe the
automation that runs on *this* repo, and the workflows they emit are committed
alongside them.

## Why generated files are committed at all

It would be simpler to generate workflows at run time and never store them. The
project deliberately doesn't do that, for two reasons stated in the README:

1. **The emitted YAML is readable and auditable.** A reviewer can see exactly
   what will run, with what permissions, on what trigger — without simulating a
   compiler in their head.
2. **It works without GitFactory existing.** The output is ordinary GitHub
   Actions YAML. If you stop using the builder tomorrow, your automation keeps
   running. Nothing is load-bearing except GitHub itself.

The cost of that choice is this page: the output is real, so it *looks*
editable, and it isn't. Any hand-edit you make survives exactly until the next
compile, then vanishes without a warning.

## Which blueprint produced which file

Rather than maintaining a mapping table here that can drift out of date, each
generated artifact carries its own provenance header naming the blueprint it was
compiled from. **Open the generated file and read the top few lines** — that
header is the authoritative answer for that file, and it is the one thing
guaranteed to be regenerated in lockstep with the content below it.

If you find a generated file with no provenance header, that's a bug worth
reporting: the header is what makes this page reachable in the first place.

## Regenerating

Compilation is driven from the app.

With local Node:

```bash
cd app && npm install && npm run dev
```

Or in Docker, with no local Node:

```bash
docker compose up dev    # → http://localhost:5173
```

Open the canvas, load the blueprint you changed, and press **Compile** to
produce the workflows. Commit the blueprint change and the regenerated output
**in the same commit** — a blueprint and its output that disagree are worse than
either one alone, because reviewers can no longer tell which is the truth.

If you are working with Claude Code in this repo, `.claude/commands/` provides a
`/compile-check` command for verifying that the committed output still matches
the blueprints.

> **Maintainers:** if a headless / CLI compile script exists (an `npm run`
> target in `app/`), add it here. This section currently documents only the two
> paths described in the README, and a one-line command would be a much better
> answer for CI and for contributors who never open the canvas.

## "But I need to change this generated file"

You almost certainly need to change the blueprint. Work through these in order:

1. **The change is a different trigger, step, label, schedule, or prompt.**
   That's blueprint content. Edit the blueprint in `.factory/`, recompile,
   commit both.
2. **The change is something the blueprint can't express.** Then the gap is in
   the compiler or the machine catalogue, not in the output. Open an issue
   describing the workflow you need and why no combination of machines produces
   it. Patching the YAML instead hides the gap and guarantees the patch is lost.
3. **The output is wrong for the blueprint you wrote.** That's a compiler bug.
   Please report it with the blueprint and the emitted YAML attached — that pair
   is a near-perfect reproduction case.

In all three cases the fix lands upstream of the file you were about to edit,
which is the whole point: the blueprint stays the single source of truth, and
every deployed factory that shares that blueprint gets the fix too.

## Reviewing a PR that touches generated files

- A diff to `.github/workflows/` **without** a corresponding `.factory/` change
  is a red flag. Ask where it came from.
- A `.factory/` change **without** regenerated output means the automation
  described in the PR isn't actually live yet.
- Review the blueprint for intent and the output for fidelity. You do not need
  to read every generated line; you do need to be satisfied it follows from the
  blueprint.

## See also

- [`../README.md`](../README.md) — what GitFactory is and how to run it
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — contribution workflow
- [`../CLAUDE.md`](../CLAUDE.md) — project memory: architecture and golden rules
- [`ROADMAP.md`](ROADMAP.md) — where the compiler is heading
