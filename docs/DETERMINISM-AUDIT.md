# Determinism audit record

> **Status: no runs recorded yet.**
> This file is the durable home for the results of the compiler determinism
> audit. As of this file's creation it contains **no observed results** — only
> the record's shape and the procedure for filling it. Do not read the template
> below as findings.

## Why this file exists

The determinism audit runs as a manually triggered (`workflow_dispatch`) job that compiles the same blueprint on more than one operating system and compares the output. Its evidence lands in GitHub Actions **artifacts**, and artifacts expire.

This file turns that expiring evidence into a permanent record, so that:

- a reader six months from now can see **which OSes** were actually exercised,
  **at which commit**, and **what the diffs showed** — without a live artifact;
- any future determinism fix has a concrete **before / after** to point at;
- a regression can be checked against a dated baseline rather than a memory.

Related reading: [`GENERATED-FILES.md`](GENERATED-FILES.md) — which files the compiler writes, how to regenerate them, and the determinism and action-pinning guarantees the audit is testing.

## Scope of the audit

The audit is concerned with **byte-for-byte reproducibility of compiler output**: given the same blueprint at the same commit, does the compiler emit identical workflow YAML regardless of the host OS?

Things that legitimately differ (timestamps, absolute paths, line endings) are worth calling out **explicitly in each entry** rather than silently normalising — a line-ending-only diff is a different bug from a reordered-keys diff, and the record should preserve that distinction.

> Line endings deserve particular attention on this repo: a top-level
> `.gitattributes` and `.editorconfig` exist, so checkout normalisation may mask
> or manufacture cross-OS differences. Note in each entry whether the comparison
> was made on raw bytes or on normalised text.

## How to run the audit and fill in an entry

1. Trigger the determinism workflow from the **Actions** tab via **Run workflow**
(`workflow_dispatch`). Record the exact workflow file path and any inputs you supplied — do not assume a later reader knows them.
   <!-- TODO(human): replace with the real workflow path, e.g.
        `.github/workflows/<name>.yml`, and the input names it accepts. -->
2. Wait for **every** job in the OS matrix to complete. A partial matrix is a
   partial audit — say so in the entry rather than presenting it as full coverage.
3. Download the diff artifacts **before the retention window closes**.
4. Copy the template below to the top of [Recorded runs](#recorded-runs), fill
every field, and paste the *actual* diff text (or, if very large, a representative excerpt plus the full byte count and file list).
5. Open a PR with the filled entry. Entries are **append-only**: correct a past
   entry with a follow-up note, do not silently rewrite it.

### Entry template

```markdown
### YYYY-MM-DD — <one-line verdict: identical / diffs observed / partial>

| Field | Value |
| --- | --- |
| Commit audited | `<full 40-char SHA>` |
| Branch / ref | `<ref>` |
| Workflow run | `<URL of the Actions run>` |
| Triggered by | `<who / why>` |
| Artifact retention expires | `<date, if known>` |
| Comparison basis | raw bytes / normalised text (say which) |

**OS matrix exercised**

| Runner | Job result | Notes |
| --- | --- | --- |
| `<runner label>` | pass / fail / skipped | |

(List every job in the matrix, including any that did not run. If an OS in the
intended matrix was not exercised, say so here explicitly.)

**Observed diffs**

- Files differing: `<count>` of `<total>`
- Nature of the differences: `<e.g. ordering, whitespace, line endings, content>`

<details>
<summary>Diff excerpt</summary>

```diff
<paste the actual diff, or a representative excerpt>
```

</details>

**Interpretation**

<What this means for the determinism guarantee. Is it a real non-determinism, an
environment artefact, or a normalisation artefact? Link the backlog item or issue
that tracks the fix, if one was opened.>
```

## Recorded runs

_None yet._

The first entry should be added by whoever triggers the first full-matrix run. Until then, this repository has **no verified cross-OS determinism evidence**, and any claim of byte-identical output across operating systems should be treated as unproven.

## Baseline for future comparison

Once the first full-matrix run is recorded above, mark it as the **baseline** and reference it from any subsequent entry that reports a change. A fix for observed non-determinism should add an entry that names the baseline it improves on, so the before/after pair is legible without opening Actions.
