# Normalization policy for non-deterministic build outputs

> Status: policy. Applies to every byte-for-byte comparison of build output —
> both the same-run determinism guard and the cross-image manifest diff.

## Why this document exists

Some build outputs legitimately differ between two runs of the same source tree: embedded build timestamps, mtimes stored in compression headers, and absolute workspace paths that leak into sourcemaps. Until now the handling of those cases was implicit, which creates a bad failure mode: a determinism check goes red, and the cheapest way to make it green again is to add one more pattern to an exclusion list — regardless of whether the difference was a known-benign class or a genuine regression.

This document fixes the answer once, so that the response to a red check is a diagnosis rather than a suppression.

## The rule

**Prefer making the build deterministic over excluding its output from the check.** An exclusion hides a difference; it does not explain it. Every class of variance below has a known fix at the producing step, and that fix is the expected remedy.

## Known classes of variance and their required handling

### 1. Embedded build timestamps — honour `SOURCE_DATE_EPOCH`

Any step that embeds a build time into its output MUST read the time from the `SOURCE_DATE_EPOCH` environment variable rather than from the system clock.

- The build sets `SOURCE_DATE_EPOCH` once, from a reproducible source (for
example the timestamp of the commit being built), and exports it to every child process.
- Consumers interpret it as a UTC Unix timestamp, per the
  [reproducible-builds specification](https://reproducible-builds.org/docs/source-date-epoch/).
- If `SOURCE_DATE_EPOCH` is unset, a step MAY fall back to wall-clock time, but
the determinism checks are then expected to fail — that is the intended signal, not a bug in the check.
- Do not "solve" a timestamp difference by excluding the file that contains it.
The timestamp is usually one field in an otherwise meaningful artifact, and excluding the whole file blinds the check to everything else in it.

### 2. Compression headers — `gzip -n`, pinned levels

The gzip format can store the original filename and modification time in its header, which makes two compressions of identical bytes differ.

- Invoke gzip with `-n` (equivalently `--no-name`) so neither the name nor the
  mtime is written.
- Pin the compression level explicitly. A level change is a real output change
  and should be visible in the diff.
- Brotli has no mtime field, so it needs no equivalent flag — but its quality and
  window parameters must still be pinned for the same reason.
- Where a tool compresses internally and exposes no such flag, prefer
  recompressing from the uncompressed artifact over adding an exclusion.

### 3. Sourcemaps — relative `sources`, consistent `sourcesContent`

Absolute paths from the build machine's checkout directory must never appear in shipped artifacts.

- `sources` entries MUST be relative to a stable root (the repository or package
root), so that building in `/home/alice/gitorio` and in `/build` produces identical maps.
- `sourceRoot` MUST be empty or a fixed, path-independent string.
- `sourcesContent` MUST be consistently either present or absent across builds;
  it must not depend on which files happened to be resolvable on disk.
- Prefer configuring the bundler or compiler to emit relative paths over
post-processing the emitted map, and strongly prefer either over excluding `*.map` from comparison — sourcemaps are exactly the kind of artifact where a silent content change matters.

### 4. Ordering, locale, and archive metadata

These are not "legitimate variance" so much as ambient nondeterminism, but they surface in the same checks and have the same required fix:

- Sort file lists explicitly, under `LC_ALL=C`, so collation does not depend on
  the ambient locale.
- Do not rely on filesystem readdir order.
- When producing tar archives, pin the entry order and metadata, e.g.
  `--sort=name --owner=0 --group=0 --numeric-owner --mtime=@$SOURCE_DATE_EPOCH`.
- Pin any hash seed or randomized iteration order the toolchain exposes.

## When an exclusion is genuinely unavoidable

Sometimes a third-party tool emits nondeterministic bytes and offers no knob. An exclusion is then acceptable, subject to all of the following:

1. **It is narrow.** Exclude the smallest unit that works — a specific field or a
specific file, never a directory or a glob that will silently swallow future artifacts.
2. **It is central.** All exclusions live in one list, not scattered across the
   scripts that consume them, so the total blast radius is readable at a glance.
3. **It is annotated.** Each entry carries a one-line reason naming the tool and
   the field, plus a link to the upstream issue or an internal tracking item.
4. **It is revisited.** An exclusion without a path to removal is technical debt
   with no interest schedule; note what would let us delete it.

An exclusion added without a reason is indistinguishable from a suppressed regression, which is precisely the outcome this policy exists to prevent.

## Triage checklist for a red determinism check

When the same-run guard or the cross-image manifest diff reports a difference, work down this list before touching any exclusion configuration:

1. **Read the diff.** Identify the differing bytes, not just the differing file.
2. **Classify it.** Is it a timestamp (§1), a compression header (§2), a leaked
   absolute path (§3), or an ordering/locale artifact (§4)?
3. **If it matches a known class**, apply that section's fix at the producing
   step and re-run.
4. **If it matches no known class**, treat it as a real regression until proven
otherwise. A novel difference is information about the build, and the default assumption is that the check is right.
5. **Only then**, if the source is a third-party tool with no available fix,
consider an exclusion under the conditions above — and extend this document with the new class so the next person does not have to rediscover it.

## Cross-image comparisons

The cross-image manifest diff compares outputs built in different environments, so it additionally surfaces differences caused by the environment itself: toolchain versions, base image contents, and locale. Those are *not* covered by the classes above and MUST NOT be normalized away — a toolchain version difference producing different bytes is a true and useful finding. Pin the environment instead.
