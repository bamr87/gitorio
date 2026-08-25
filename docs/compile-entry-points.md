# Compile entry points and the equivalence contract

> **Status:** normative for contributors. Some identifiers below are marked
> `TODO(verify)` — they were drafted from the repository overview and need a
> maintainer to confirm the exact paths, command names, and current behaviour.

A blueprint can be compiled into GitHub Actions workflows from more than one
place. This document names those places, states the contract they share, and
records the exceptions to it.

The short version:

> **Every supported compile entry point must produce byte-identical output for
> the same input.** There is one compiler; the entry points are thin shells
> around it. A difference in emitted bytes between two entry points is a bug,
> not a preference.

## Why the contract exists

The emitted YAML is the product. The README's promise is that "the emitted YAML
is readable, auditable, and works without GitFactory existing" — that promise
only holds if the YAML you reviewed in the canvas is the YAML that lands in
`.github/workflows/`. If the CLI and the in-app compiler drift, then:

- a diff reviewed in one surface no longer describes what the other surface
  writes;
- CI checks that compile from the command line stop being evidence about what
  users see;
- "it compiles clean locally" and "it compiles clean in the app" become two
  different claims.

The contract also exists to answer a design question in advance: *should I add a
new way to compile?* Usually no — and if yes, it must delegate (see
[Adding a new entry point](#adding-a-new-entry-point)).

## Supported entry points

| # | Entry point | Invoked by | Notes |
|---|-------------|-----------|-------|
| 1 | Programmatic compile API | The canvas **Compile** button in the app (`app/`) | `TODO(verify)` module path and exported symbol. The README documents the button: "press **Compile** to see the generated workflows". |
| 2 | CLI `compile` subcommand | Humans and CI at the shell | `TODO(verify)` binary name, subcommand name, and flags. |

Anything not in this table is **not** a supported entry point. If you find code
elsewhere in the repository that constructs workflow YAML directly — for example
under `tools/` or in a dogfooding script for `.factory/` — that is either an
omission from this table (fix the table, and make the code delegate) or a
duplicate implementation (delete it).

### Shared core

Both entry points are expected to call the same compiler core, which owns:

- parsing and validating the blueprint,
- applying **all** defaults,
- serialising the resulting workflow files.

Defaults live in the core, never in an entry point. An entry point may translate
its own surface's arguments (argv, or a UI state object) into the core's input
type, and may format errors for its own audience — nothing else.

## The equivalence contract

Given the **same blueprint input** and the **same explicit options**, every entry
point in the table above MUST produce:

1. the **same set of output file paths**, and
2. **byte-identical content** for each of those files.

"Byte-identical" is deliberate and stronger than "semantically equivalent". It
includes:

- YAML key ordering,
- indentation and quoting style,
- line endings (normalise to `\n`),
- presence or absence of a trailing newline,
- comment text and placement,
- key ordering derived from map/dictionary iteration.

The same input compiled twice through the *same* entry point must also be
byte-identical — determinism is a precondition for cross-entry-point equivalence.

### Common sources of accidental divergence

When the contract breaks, it is usually one of these. Treat each as something the
core must control, not something an entry point gets to decide:

- **Timestamps or "generated at" banners.** Non-deterministic across runs, so
  they break self-equivalence before they break entry-point equivalence.
- **Version, host, user, or CWD strings** interpolated into a header comment.
- **Unordered iteration** over a map/set when emitting jobs, steps, or triggers.
  Sort by a stable key.
- **Path separators and absolute paths** leaking into output on different
  platforms or inside vs. outside Docker.
- **Serialiser configuration** (line width, flow vs. block style, quoting) set
  per call site instead of once in the core.
- **Locale-sensitive formatting or sorting.**
- **Defaults applied in the shell.** If the CLI defaults a flag to `true` and the
  UI leaves it unset, the two are no longer "the same explicit options".

## Deliberate exceptions

**None recorded.** The contract currently admits no exceptions.

If an exception becomes necessary, it must be recorded here before it is
implemented, using this shape:

```
### <short name>

- **Entry points affected:** ...
- **What differs:** exactly which bytes, in which files.
- **Why it cannot be unified:** ...
- **How tests handle it:** the normalisation the differential test applies.
- **Recorded:** <date> — <PR link>
```

An exception that is not written down here is a bug. The differential test
should normalise **only** the differences named in this section, so that an
undocumented divergence still fails the build.

## Adding a new entry point

Default answer: don't. Two shells over one core is already the maximum that pays
for itself. Before adding a third, check whether the need is met by adding an
option to the core, or by a caller of the existing programmatic API.

If a new entry point is genuinely warranted, it must:

1. call the shared compiler core — no second implementation, no second
   serialiser configuration;
2. define **no defaults of its own**; anything not supplied by the user is
   resolved by the core;
3. be added to the table in [Supported entry points](#supported-entry-points) in
   the same PR;
4. be added to the differential test in the same PR, so it is covered by the
   contract from its first commit.

A new entry point that needs its own defaults is a signal that the core's input
type is wrong. Fix the core.

## Testing the contract

The contract is enforced by a differential test: for a corpus of blueprint
fixtures, compile through every entry point in the table and assert byte
equality of the resulting file sets. That test should link back to this
document, and this document is the authority on what counts as an allowed
difference.

When the test fails, the fix is one of exactly three things:

- make the diverging entry point delegate correctly (usual case);
- make the core deterministic (if the same entry point disagrees with itself);
- record a deliberate exception above, with review.

"Update the expected fixture until it passes" is not one of the three.

---

Related reading: `CLAUDE.md` (architecture and golden rules),
`CONTRIBUTING.md`, `docs/ROADMAP.md`.
