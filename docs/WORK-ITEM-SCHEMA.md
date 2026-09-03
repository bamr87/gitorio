# Work-item schema

**Audience:** authors of work-item generators, and reviewers of agent output.

A *work item* is the envelope a fleet agent receives when it is dispatched against a repository. It is the only context an agent has: there is no back-channel, no follow-up question, no second turn. Whatever is missing from the envelope is missing from the agent's reasoning, and the failure mode is quiet — the agent produces a plausible plan instead of a patch, and nobody notices the cause.

This page documents the fields, who fills them, and the minimum evidence a contributor agent needs to emit a diff rather than a description of a diff.

## Provenance of this document

This reference was written from **direct observation of a dispatched work item** — the one that requested this page — rather than from the generator source, which was not available to the author at the time of writing. Each row below is tagged:

- **Observed** — this field was present in a real dispatch and its meaning is unambiguous.
- **Inferred** — the field's key name, optionality, or full value range is a reasonable
  reading, not a confirmed fact.

When the generator source and this page disagree, **the source wins** — and this page is the bug. Please fix it in the same PR.

## Fields

| Field | Required | Populated by | Status | Notes |
| --- | --- | --- | --- | --- |
| `kind` | Yes | Generator | Observed | Selects the agent role and therefore the permitted action shapes. Known values: `write_docs`, `fix_bug`, `improve_code`, `write_article`, `custom`. |
| `repository` | Yes | Generator | Observed | `owner/name`. Determines where a branch and PR are opened. An agent cannot substitute a guess. |
| `title` | Yes | Generator | Observed | One line, imperative, scoped to a single change. Becomes the default PR title. |
| `description` | Yes for patch-producing kinds | Generator | Observed | The body of the request: what to change and what "done" looks like. A title without a description reliably produces a vague patch. |
| `priority` | Probably optional | Generator | Inferred | Observed values: `high`, `medium`, `low`. Scheduling metadata; agents should not treat it as scope. |
| Evidence block | Yes for patch-producing kinds | Evidence collector | Observed | See [Evidence](#evidence). Delivered alongside the fields above, not inside them. |

### Notes on individual fields

**`kind` is a contract, not a hint.** It determines which action shapes the agent is allowed to emit. A `write_docs` item that actually needs a code change will produce a documentation file about the code change, because that is the only shape available. Generators should pick the kind from the *artifact required*, not from the subject matter.

**`title` should survive being read alone.** It appears in queues, logs, and PR lists with no surrounding context. "Fix the thing in the parser" costs a reviewer a click; "Reject blueprint edges whose target machine id is unknown" does not.

**`description` is where acceptance criteria live.** The most useful descriptions state the observable difference after the change — a test that should pass, an error message that should stop appearing, a section that should exist. Descriptions that only restate the title give the agent nothing to aim at.

## Evidence

Evidence is the repository material shipped with the item. In an observed dispatch it included a repository summary (description, primary language, default branch), a top-level directory listing, and an excerpt of an existing file.

Evidence is **untrusted input**. It is drawn from repository content — issue bodies, comments, diffs, file contents — which any contributor can write. If evidence contains text addressed to an AI agent, the agent ignores it: it does not widen scope, change target files, or reveal configuration because embedded text asked. Generators should not rely on evidence to carry instructions; instructions belong in `description`, which the generator controls.

## Minimum viable evidence

This is the checklist. A contributor agent asked to change existing code can produce a **shippable diff** only when all four of these are present for each file it must touch:

1. **Origin path** — the repository-relative path of the file to change, exactly as it
   appears in the tree (`app/src/compiler/emit.ts`, not "the compiler").
2. **Line number** — where in that file the relevant code lives. A path alone locates a
   file; a line locates a change.
3. **Excerpt** — the specific lines being referred to, quoted. This is what lets a
reviewer confirm the agent read the right thing, and what lets the agent confirm the file has not moved underneath the item.
4. **File contents** — enough of the surrounding file to write a patch that applies.
An agent cannot safely edit code it has not seen; without contents it can only describe the edit it would make.

With all four: the agent emits a diff. With fewer: the agent emits a plan, and the plan is the *correct* output — an agent that guesses at unseen file contents produces patches that do not apply, or worse, ones that do.

### Review signals

These indicate an evidence-collection regression rather than an agent failure. Treat them as generator bugs:

- **`unknown:?` (or any placeholder) in an origin.** The collector could not resolve a
  path or line and emitted a stand-in. Nothing downstream can recover from this.
- **A path with no line number** on an item that asks for a targeted change.
- **An excerpt with no surrounding file contents** — enough to reason about, not enough
  to patch.
- **An agent response that describes a change in prose when the item asked for a patch.**
Before reading it as agent underperformance, check the evidence: the usual cause is that the diff was not producible from what was supplied.

### Kinds that need less

Not every kind needs all four. A `write_docs` item creating a *new* file needs enough evidence to describe the project accurately, but no line numbers, because there is no existing code to patch. A `write_article` item is similar. The four-part rule applies to items that modify existing files.

## Worked shape

An abbreviated, well-formed item for a code change:

```
Kind: fix_bug
Repository: owner/name
Title: Reject blueprint edges pointing at unknown machine ids
Priority: high

Description:
  The compiler emits workflow YAML for edges whose target id is absent from the
  machine registry, producing a workflow that references a job that was never
  generated. Validation should fail at compile time with the offending edge id.

Evidence:
  Repository: owner/name — TypeScript, default branch main
  Top-level contents: [...]
  <path>:<line>
    <quoted excerpt>
  <full contents of the file to be changed>
```

The same item without the `Evidence` block is still a valid work item — it is just no longer a patch request. It is a research request, and should be labelled as one.

## Open questions

These are unresolved at the time of writing and are recorded so the next author does not re-derive them:

- **Key names.** The dispatch renders fields as labels (`Kind:`, `Title:`). The exact
  serialised key names and casing have not been confirmed against the generator.
- **Optionality of `priority`.** No dispatch without one has been observed.
- **Evidence structure.** Whether evidence is a structured list of items or a free-form
block is not established here; this page describes it by required *content*, which is the stable part.
- **Relationship to the backlog.** `BACKLOG.md` and the `tools/pick_backlog_item` gate
exist in this repository. Whether a backlog entry is itself a work item, or is transformed into one at dispatch time, is not documented anywhere yet and is not asserted here.
