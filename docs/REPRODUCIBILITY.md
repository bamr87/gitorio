# Reproducibility contract for generated artifacts

> **Status:** normative for anything the compiler writes. If a change would break a
> rule below, the change is wrong unless this document is amended in the same PR.
>
> Some repo-specific names (the exact sidecar filename, the exact test file) are left
> as TODOs in [Open items](#open-items-for-maintainers) — fill them in and delete the
> TODO markers so this page becomes fully authoritative.

## Why this exists

GitFactory compiles a blueprint into real GitHub Actions workflows that get committed
to the target repository (see the README: *"the emitted YAML is readable, auditable, and
works without GitFactory existing"*). That only holds if regeneration is boring:

- **Reviewable diffs.** When a blueprint changes by one machine, the workflow diff
  should show that one change — not a churned header on every file.
- **Trustworthy audit.** "Re-run the compiler and confirm the checked-in YAML matches"
  is only a meaningful check if a matching run produces identical bytes.
- **No merge noise.** Two contributors regenerating from the same blueprint must not
  produce conflicting files just because they ran on different machines at different
  times.

The moment a generated file contains a wall-clock timestamp, the second and third
properties are gone, and the first is degraded. Hence the contract.

## The guarantee

> **Given the same inputs, the compiler produces byte-for-byte identical output files.**

"The same inputs" means, exhaustively:

1. the blueprint source (its serialized content, not its file mtime or path on disk);
2. the compiler version (this repository at a given commit);
3. any schema/template assets the compiler reads from `schema/` and its own templates;
4. explicitly declared injectable values (see [Pinning](#pinning-injectable-values)).

"Byte-for-byte identical" includes line endings, trailing newline, key ordering, list
ordering, indentation, and quoting style. Not "semantically equivalent YAML" — the same
bytes.

The output must **not** vary with any of the following:

| Ambient input | Why it is banned |
| --- | --- |
| Wall-clock time / date | Two runs of an unchanged blueprint would differ |
| Hostname, username, CI runner ID | Machine-dependent diffs, leaks environment details |
| Absolute paths (`/Users/...`, `/home/runner/work/...`) | Machine-dependent, and leaks local layout into a committed file |
| Random values, UUIDs, unseeded shuffles | Non-deterministic by construction |
| Filesystem iteration order | Varies by OS/filesystem; sort explicitly before emitting |
| Locale, timezone, `Intl` default formatting | Number/date/collation output differs per environment |
| Node.js version, OS, arch | Output must not encode the toolchain that produced it |
| Environment variables not in the declared input set | Invisible inputs are the same problem as timestamps |

If you need one of these values recorded, it belongs in the sidecar, not in the artifact.

## What is covered

- Compiled GitHub Actions workflow YAML.
- Any other file the compiler writes into the repository as a *derived* artifact
  (generated prompt files, generated config, generated docs fragments), unless it is
  listed under [Exclusions](#exclusions).

Hand-authored files are out of scope: this contract is about generated output only.

## Exclusions

### The provenance sidecar

Exactly one generated file is excluded from the byte-for-byte guarantee: the
**provenance sidecar** — the machine-readable metadata file the compiler writes
alongside the artifacts.

*Why it is excluded:* provenance is by nature environment-dependent. It answers "who
ran the compiler, when, from which commit, with which tool version" — every one of
those is a value that would destroy determinism if it were inlined into a workflow
header. Isolating all such values into a single, clearly-marked file keeps the
interesting artifacts stable while preserving the audit trail.

Rules for the sidecar:

1. **It is the only excluded file.** Do not introduce a second one. If you want to
   record something varying, add a field to the sidecar.
2. **It is never a compiler input.** The compiler must not read the sidecar back to
   produce artifacts; if it did, output would depend on the previous run, and
   reproducibility would become path-dependent.
3. **It is not required for the workflows to run.** Deleting it must not break the
   emitted GitHub Actions workflows — they stand alone.
4. **It is skipped by the idempotency check.** See [Enforcement](#enforcement).
5. **Its stable fields still matter.** Fields derived purely from the inputs (blueprint
   identifier, content hash, compiler version) should be identical across runs even
   though the file as a whole is not compared byte-for-byte. Only the environment-
   derived fields may differ.

### What a generated header may contain

A "do not edit" header on a generated file is expected and useful. It may contain only
values derived from the declared inputs, for example:

- a "generated by GitFactory — do not edit" notice and a pointer to the source blueprint
  (as a **repo-relative** path, never absolute);
- the blueprint name/identifier;
- the compiler and/or schema version;
- a content hash of the inputs.

It may **not** contain a generation timestamp, hostname, username, absolute path, run
ID, or anything else from the banned list above.

## Pinning injectable values

Some values legitimately need to be injected at compile time (versions to pin, target
repository names, secret *names* — never secret values). To keep the guarantee intact:

1. **Declare them.** Every injectable value is part of the declared input set — sourced
   from the blueprint or from an explicit compiler argument, never sniffed from the
   ambient environment with a silent fallback.
2. **No implicit defaults that vary.** A default may be a constant. A default may not
   be `Date.now()`, `os.hostname()`, `process.cwd()`, `crypto.randomUUID()`, or
   `process.env.SOMETHING` read opportunistically.
3. **Pin them when reproducing.** To reproduce a build exactly, restore all four inputs:
   - check out the compiler at the recorded commit (from the sidecar);
   - check out the blueprint at the recorded revision;
   - use the recorded schema/template version;
   - pass the recorded injectable values verbatim.
   Anything the sidecar does not record cannot be reproduced — which is the reason the
   sidecar must record every injectable it was given.
4. **Recording ≠ inlining.** Record the injected values in the sidecar; inline into the
   artifact only what the artifact needs to function.

## Enforcement

The contract is enforced by an **idempotency test**: compile a fixture blueprint twice
and assert the outputs are identical bytes, with the provenance sidecar excluded from
the comparison.

Run the suite the same way you run any other test in this repo:

```bash
cd app && npm test
```

or, without a local Node install (per the README):

```bash
docker compose run --rm dev npm test
```

A useful second-line check is regenerating the dogfooded factory in `.factory/` and
confirming `git status` reports no changes: if regeneration from an unchanged blueprint
dirties the tree, determinism has been lost.

**If the idempotency test fails after your change, the fix is almost never "loosen the
test."** It is "remove the varying value from the artifact, and put it in the sidecar if
it is worth keeping."

## Note for contributors

> **Adding a timestamp, hostname, absolute path, username, run ID, or random value to a
> generated header will break the idempotency test — on purpose.**

The common request is a `# Generated at 2026-08-26T12:00:00Z` line. It feels harmless and
it is not: it makes every regeneration produce a diff, turns "does the checked-in YAML
match the blueprint?" into an unanswerable question, and creates conflicts between two
people who changed nothing. That information already lives in the provenance sidecar and
in `git log` for the commit that wrote the file.

Before adding anything to a generated file, ask:

- [ ] Is this value a pure function of the declared inputs? If yes, it may go in the artifact.
- [ ] Does it come from the clock, the machine, the environment, or a random source? If yes, it goes in the sidecar.
- [ ] Does the emitted workflow *need* it to run? If no, it almost certainly goes in the sidecar.
- [ ] Does the idempotency test still pass? If no, one of the answers above was wrong.

## Changing this contract

The contract is deliberately hard to change. If a real requirement cannot be met within
it:

1. Open an issue describing the requirement and why the sidecar is insufficient.
2. Amend this document in the same PR as the code change, so the rule and the behaviour
   never disagree.
3. Regenerate all checked-in artifacts in that PR, so the diff shows the full blast radius.

## Open items for maintainers

These are repo-specific details a maintainer should fill in so this page is fully
concrete. They were deliberately left generic rather than guessed:

- [ ] **Sidecar filename and location** — replace "the provenance sidecar" with the actual
      path (e.g. under `.factory/`) and link its schema if one exists in `schema/`.
- [ ] **Idempotency test path** — link the test file that performs the compile-twice
      comparison, and confirm the exact command that runs it in isolation.
- [ ] **Declared injectable values** — enumerate the injectables the compiler currently
      accepts, so the "pin these to reproduce" list is checkable.
- [ ] **CI gate** — if a workflow in `.github/workflows/` runs the idempotency check or a
      "regenerate and diff" check, link it here.
- [ ] **Cross-links** — link this page from `README.md`, `CONTRIBUTING.md`, and `CLAUDE.md`
      so it is found before someone writes the `generated at` line.
