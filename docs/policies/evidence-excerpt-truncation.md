# Source excerpt size and truncation policy

**Status:** Accepted (policy decided; enforcement in the bundle builder is not yet implemented — see "Implementation checklist" below).

**Applies to:** any process that attaches source file contents to an agent evidence bundle, and any agent that consumes such a bundle.

## 1. Why this exists

Once file contents are attached to evidence bundles, large files compete with the rest of the prompt for context. Capping them is obviously an efficiency concern. It is also, less obviously, a **correctness** concern:

> A truncated view of a file, combined with a response format that requires
> full-file replacement content, is a data-loss trap. An agent that dutifully
> emits "the full new content" after seeing only the first 200 lines of a
> 900-line file has just proposed deleting 700 lines it never read.

This document fixes the caps, the excerpt selection rule, how truncation is signalled, and — most importantly — what an agent must do when those two conditions collide.

## 2. Size caps

Per attached file:

| Limit | Value |
| --- | --- |
| Maximum excerpt lines | 400 |
| Maximum excerpt bytes | 32 KiB |

Whichever limit binds first wins. A file that fits under **both** limits is attached in full and reported as `truncated: false`.

Per bundle:

| Limit | Value |
| --- | --- |
| Total excerpt budget across all files | 96 KiB |
| Maximum number of attached files | 8 |

When the bundle budget would be exceeded, files are dropped whole rather than shrunk below the per-file window — a file present at half a window is worse than a file listed as "available but not attached", because the former invites the agent to act on it. Dropped files MUST still be listed by path with their `total_lines` / `total_bytes`, so the agent knows they exist and can ask for them.

These numbers are a starting point tuned for readability, not a law of physics. If they are changed, change them here first; the rest of the policy is independent of the exact values.

## 3. Which lines to attach

**Prefer an anchor-centred window over head truncation.**

- If the task has an anchor line (typically the line number of the TODO/FIXME
that generated the work item), the excerpt MUST be a window centred on that anchor: `[anchor - 150, anchor + 250]`, clamped to the file bounds and then to the byte cap. The window is deliberately asymmetric — the code a TODO talks about usually follows it.
- If the anchor sits near the start or end of the file, the window slides rather
  than shrinks: keep the full line budget by extending in the other direction.
- If there is **no** anchor, fall back to head truncation from line 1. Record
`truncation_reason: "no_anchor_head_truncated"` so the agent knows it is looking at a prefix chosen by default rather than a window chosen for relevance.
- Never stitch together non-contiguous ranges into something that reads like a
contiguous file. If multiple regions matter, attach them as separate excerpt entries for the same path, each with its own line range.

Excerpts are always cut on line boundaries. Never emit a partial final line.

## 4. How truncation is signalled

Truncation must be *impossible to miss and impossible to infer wrongly*. Every attached excerpt carries an envelope with at least these fields:

```json
{
  "path": "src/bundle/builder.ts",
  "total_lines": 912,
  "total_bytes": 41233,
  "excerpt_start_line": 121,
  "excerpt_end_line": 520,
  "truncated": true,
  "truncation_reason": "line_cap",
  "sha256": "<digest of the FULL file, not the excerpt>"
}
```

`truncation_reason` is one of: `line_cap`, `byte_cap`, `no_anchor_head_truncated`, `binary`, `bundle_budget`.

In the rendered prompt text, the excerpt body is additionally wrapped with inline markers so the signal survives any flattening of the structure:

```
----- BEGIN EXCERPT src/bundle/builder.ts (lines 121-520 of 912) TRUNCATED -----
[... 120 lines omitted before ...]
<excerpt lines>
[... 392 lines omitted after ...]
----- END EXCERPT src/bundle/builder.ts -----
```

A file attached in full uses the same framing with `(lines 1-N of N) COMPLETE` and no omission markers. Consistent framing in both cases means the *absence* of the word `TRUNCATED` is meaningful rather than ambiguous.

The `sha256` of the full file is included so a downstream step can detect that the file changed between bundle construction and patch application.

## 5. Agent behaviour when a file is truncated

This section is normative for agents, and it is the reason this policy exists.

1. **An agent MUST NOT emit full-file replacement content for a file it received
truncated.** Not "should avoid" — must not. The omitted region is unknown, and a full-file response asserts that it is empty.
2. When the task requires a full-file response and the target file is truncated,
the agent falls back to a **plan-only response**: describe the intended change precisely (which lines, which behaviour, why), state explicitly that the file was truncated and therefore no file content is being proposed, and stop.
3. If the mechanism to request more context exists, requesting an expanded or
re-anchored excerpt is preferred over the plan-only fallback. Plan-only is the floor, not the goal.
4. Creating a **new** file is always safe, truncation notwithstanding — there is
no prior content to destroy. A truncated view of file A does not block proposing a complete new file B.
5. Editing a *different*, fully-attached file in the same bundle remains fine.
   Truncation is a per-file property, not a bundle-wide veto.
6. The agent should say which files were truncated in its response body. A
reviewer seeing "I only got lines 121-520 of builder.ts, so here is a plan instead of a patch" can fix the bundle; a reviewer seeing a confident wrong patch cannot.

### Anti-pattern

> "I was shown lines 1-200 of a 900-line file. I'll output those 200 lines with
> my fix applied as the full new content, since that's the required format."

This silently deletes 700 lines. If the required format cannot be satisfied honestly, the correct move is to not satisfy it and explain why.

## 6. Special cases

- **Binary or non-UTF-8 files** are never excerpted. Attach the envelope only,
  with `truncation_reason: "binary"` and an empty body.
- **Minified or generated files** (single lines of many KiB, lockfiles, build
output) hit the byte cap immediately and would produce a useless window. Prefer to list them as available-but-not-attached rather than burning budget on a fragment of one line.
- **Files that may contain secrets** are out of scope for this document, but note
that a windowing rule is not a redaction rule: excerpting is not a security control and must not be relied on as one.
- **Multi-file tasks** where several files exceed the cap should prefer attaching
fewer files completely over attaching many files partially. Complete views enable patches; partial views only enable plans.

## 7. Implementation checklist

When the bundle builder enforces this policy, its tests should assert:

- [ ] A file under both caps is attached whole with `truncated: false` and no
      omission markers.
- [ ] A file over the line cap with an anchor yields a window containing the
      anchor line, with `excerpt_start_line <= anchor <= excerpt_end_line`.
- [ ] An anchor near line 1 or near EOF still yields a full-length window
      (slides, does not shrink).
- [ ] A file over the cap with no anchor yields a head excerpt with
      `truncation_reason: "no_anchor_head_truncated"`.
- [ ] Excerpts never end mid-line.
- [ ] `sha256` is computed over the full file, not the excerpt.
- [ ] Exceeding the bundle budget drops whole files and still lists their paths.
- [ ] Every truncated excerpt renders the literal token `TRUNCATED` in its
      framing.
