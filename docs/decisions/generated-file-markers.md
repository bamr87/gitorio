# Decision: generated-file markers for formats without comment syntax

Status: accepted Scope: all files written by the generator/build pipeline

## Context

The generated-file header work assumes every compiled output has a native comment syntax that can carry a "this file is generated, do not edit" banner plus provenance (which blueprint produced it, and how to regenerate it).

That assumption does not hold for every output format we emit. JSON has no comment syntax at all; several data and lock formats are consumed by third party tools that reject unknown leading bytes; some outputs are not text.

Without an explicit decision, a header builder written against the "just prepend a comment" assumption grows an undocumented silent-skip branch, and those files ship with no warning at all — which is exactly the gap the header work exists to close.

This document settles the question *before* the header builder is written.

## Decision

Every generated file MUST carry a provenance marker, or MUST appear in a checked-in exemption list with a written reason. There is no third state. The builder MUST NOT silently skip a file.

The marker strategy is chosen by format capability, in this order:

### 1. Comment-capable formats — comment header (preferred)

Formats with a native comment syntax (Markdown/HTML, YAML, TOML, shell, Ruby, Python, JS/TS, CSS, SCSS, Liquid, ...) get the standard header comment as the header task already specifies. Nothing in this decision changes that path.

### 2. Comment-less formats with a keyed root — reserved `_generated` key

Formats that cannot express a comment but *can* carry an extra key at the top level of a mapping/object (JSON objects being the primary case) get a reserved top-level key named `_generated`.

The value is an object with these fields:

| field       | required | meaning                                                        |
| ----------- | -------- | -------------------------------------------------------------- |
| `doNotEdit` | yes      | Always `true`. Human- and grep-readable warning.                 |
| `source`    | yes      | Repo-relative path of the blueprint/source that produced this.   |
| `command`   | yes      | The exact command that regenerates this file.                    |
| `generator` | yes      | Name of the tool that wrote the file.                            |

Example:

```json
{
  "_generated": {
    "doNotEdit": true,
    "generator": "gitorio",
    "source": "blueprints/site.yml",
    "command": "gitorio build blueprints/site.yml"
  },
  "name": "example",
  "version": "1.0.0"
}
```

Rules for this path:

- The key is exactly `_generated`. The leading underscore keeps it out of the
  way of schema-significant names and sorts predictably.
- It is written first so it is visible in the first lines of a diff, but
  consumers MUST NOT depend on key order.
- It carries **no timestamp and no content hash**. Regenerating an unchanged
input must produce a byte-identical file so that "is this file stale?" is a real, reviewable diff rather than permanent churn.
- If the output already contains a top-level `_generated` key from user data,
  that is a hard error, not an overwrite.

### 3. Everything else — recorded exemption

A file is exempt only when neither of the above is possible. Typical causes:

- the root of the document is not a mapping (e.g. a top-level JSON array),
- the file is consumed by a third-party tool with a strict schema that
  rejects unknown keys,
- the format is binary or otherwise not safely annotatable.

Every exemption MUST be recorded in a checked-in exemption list next to the builder configuration, with:

- the path or glob,
- the reason the file cannot be marked,
- where a reader should look instead for provenance.

Suggested shape:

```yaml
# generated-exemptions.yml
exemptions:
  - path: "data/search-index.json"
    reason: "top-level JSON array; consumer requires an array root"
    provenance: "docs/decisions/generated-file-markers.md"
```

Where the consumer tolerates it, an exempt file SHOULD be accompanied by a sidecar `<file>.generated.json` containing the same `_generated` object, so provenance still exists somewhere adjacent to the artifact.

### 4. Unknown formats fail loudly

If the builder encounters an output whose format it cannot classify into one of the three cases above, it MUST fail with an error naming the file and pointing at this document. "Wrote the file with no marker" is never a valid outcome.

## Consequences

- The header builder has exactly three documented branches and no silent
  fallthrough.
- `_generated` becomes a reserved top-level key in generated JSON output;
  blueprints must not produce it themselves.
- Adding a new output format is a deliberate act: pick a branch, or add an
  exemption with a reason. Both are reviewable in a diff.
- Excluding timestamps keeps generated output reproducible, at the cost of
not being able to answer "when was this generated?" from the file alone. That question is answered by version control, which is the better source.

## Alternatives considered

- **Sidecar files for everything.** Uniform, but the warning is not where the
person editing the file is looking, which defeats the purpose. Kept only as the fallback for genuinely un-markable formats.
- **`//`-style comments in JSON (JSON5/JSONC).** Works for editors, breaks
  strict parsers. Not acceptable for files consumed by third-party tooling.
- **A `$schema`-style key or a `_comment` string.** A plain string cannot
  carry structured provenance (source + command) without parsing prose.
- **Silently skipping comment-less formats.** This is the status quo the
header work exists to fix; rejected explicitly so it does not reappear as an implementation detail.
