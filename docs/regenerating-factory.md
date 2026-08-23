# Regenerating `.factory/`

> **TL;DR** — `.factory/` is compiler output. Never edit it by hand. If a
> `--check` job fails, [run the regenerate command](#regenerate) and commit the
> result in the same pull request.

## What `.factory/` is

This repository dogfoods itself: the automation that runs on `bamr87/gitorio` is
designed as a blueprint and then **compiled** into the artifacts under
`.factory/`, the same way the app compiles a user's blueprint into GitHub
Actions workflows. The README describes the project as "dogfooding itself in
`.factory/`".

That makes `.factory/` a **generated directory**. It stands in the same
relationship to its blueprint as `app/dist` does to `app/src`:

- The blueprint is the source of truth.
- `.factory/` is a derived artifact that happens to be committed, so that the
  emitted YAML stays readable, reviewable, and diffable in pull requests — and
  so the workflows keep working without GitFactory needing to exist at runtime.

Because it is committed, it can drift. That is what the `--check` job guards
against.

## Do not hand-edit `.factory/`

Any change you make directly to a file under `.factory/` will be silently
reverted the next time someone regenerates — and, in the meantime, the `--check`
job will fail because the committed output no longer matches what the compiler
produces from the blueprint.

If you want different compiled output, change one of these instead:

| You want to change… | Edit… |
| --- | --- |
| Which machines run, or how they are wired | the blueprint that produces `.factory/` |
| What an agent is told to do | the prompt that machine references |
| The shape of the emitted YAML for *every* blueprint | the compiler in `app/` |

Then regenerate.

## What a red `--check` job means

The `--check` job runs the compiler in a read-only mode and compares its output
against what is committed under `.factory/`. It fails when the two disagree.
There are three usual causes:

1. **You changed a blueprint or prompt and did not regenerate.** Most common.
   The fix is below.
2. **You hand-edited `.factory/`.** Revert your edit, make the equivalent change
   at the source, and regenerate.
3. **You changed the compiler.** Every committed `.factory/` output in the repo
   now needs regenerating — the diff *is* the point of your PR, and reviewers
   should read it as the primary evidence of what your compiler change does.

In all three cases the recovery path is identical.

<a id="regenerate"></a>

## Regenerate

Run, from the repository root:

<!--
  MAINTAINER: replace the command below with the real headless compile command
  once it lands, and make the `--check` failure message quote this block
  BYTE-FOR-BYTE. This fenced block is the single source of truth for the
  command string; the failure message should point at
  docs/regenerating-factory.md#regenerate rather than restating the workflow.
-->

```bash
# TODO(maintainer): exact headless compile command goes here — see the
# maintainer checklist at the bottom of this file.
```

If you do not have Node installed locally, the repository is set up to run
everything in a container (see the README's "Run with Docker" section); the same
command can be run through `docker compose run --rm dev …`.

The command rewrites `.factory/` in place. It is idempotent: running it twice in
a row produces no second diff.

## Commit the regenerated output in the same PR

After regenerating:

```bash
git status                 # expect changes under .factory/
git add .factory
git commit -m "chore: regenerate .factory"
```

**The regenerated files belong in the same pull request as the change that
caused them.** This is not a style preference — it is what keeps the repository
honest:

- A blueprint change whose compiled output lands in a later PR leaves `main`
  in a state where the running automation does not match its design.
- Reviewers judge a blueprint change largely by reading the YAML it produces.
  Splitting them apart removes the evidence from the review.
- The `--check` job on your branch stays red until the output is committed, so
  the PR cannot merge anyway.

A separate `chore: regenerate .factory` commit inside the same PR is fine and
often easier to review than folding the generated diff into the source commit.

## If regenerating produces an unexpected diff

- **Diff touches files you did not expect.** Someone likely landed a change
  without regenerating, or landed a compiler change with stale outputs. Rebase
  on the latest default branch and regenerate again; if the extra diff persists,
  it belongs in its own PR so the two changes stay separable.
- **Diff is empty but `--check` is still red.** Confirm you ran the command from
  the repository root, and that you are on the same branch CI is testing.
- **Diff is enormous after a compiler change.** Expected — that is the blast
  radius of your change. Call it out in the PR description so reviewers know to
  skim rather than read line-by-line.

## Keeping this doc and the failure message in sync

The `--check` job's failure message and this page describe one workflow, so they
must not drift:

- The failure message **links here** (`docs/regenerating-factory.md#regenerate`)
  rather than restating the recovery steps.
- The failure message quotes **the same command string** as the fenced block
  above.

If you change the command, change it in both places in the same commit.

---

## Maintainer checklist (remove once done)

- [ ] Replace the placeholder in [Regenerate](#regenerate) with the real
      headless compile command.
- [ ] Make the `--check` failure message quote that exact string and link to
      `docs/regenerating-factory.md#regenerate`.
- [ ] Confirm the wording about where blueprints live matches the actual layout
      (this page deliberately avoids naming a path).
- [ ] Link this page from `CONTRIBUTING.md` and/or the README's development
      section.
