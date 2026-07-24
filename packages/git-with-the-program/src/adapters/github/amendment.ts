// Implements: docs/spec/02-ledger.md §5 ("Reprogramming proposal — a PR against `.program/`.
// Assertion → `contested`, enforcement mutes"), docs/spec/01-core-memory.md §4.2 (the status
// lifecycle) and §4 rule 1 (no assertion without provenance), against
// .program/invariants.yaml — read only, ever.
//
// THE MACHINE PROPOSES; THE HUMAN RATIFIES.
//
// INV-001 (`precision: 1.0`, `budget: 1.0` — one breach fires immediately) says nothing writes
// to `.program/` except human-ratified PRs, machine actors excluded from the path. A
// reprogramming proposal therefore cannot BE the amendment; it can only be a patch someone
// applies under their own name. That is why this module is a pure `string -> string` function
// with no filesystem in it at all: the caller supplies the current file text, and the module
// hands back a diff. There is no code path here through which `.program/` could be written,
// which is the same trick src/core/event.ts plays on INV-002 — an invariant enforced by the
// ABSENCE of the function that would violate it.
//
// See docs/spec/OPEN-QUESTIONS.md Q-52 for what the spec does not say about this patch's
// contents, and proposals/PROPOSED-program-amendment.md for the human-authored precedent this
// output is shaped after.

import type { DeliveryPatch } from '../../core/delivery.js';
import type { InvariantAssertion } from '../../core/assertion.js';
import type { EventId } from '../../core/ids.js';
import { sha256RefHex } from '../../core/ids.js';
import { fail, ok, type Parsed } from '../../core/result.js';
import type { CommitterTime } from '../../core/time.js';

/** The one file a reprogramming proposal ever targets. */
export const INVARIANTS_PATH = '.program/invariants.yaml';

/**
 * Guard, not decoration: every path this module emits must sit under the program store, so a
 * bug that pointed an "amendment" at `src/` could not be mistaken for a constitutional change.
 */
export const PROGRAM_DIR = '.program/';

export interface AmendmentChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
  readonly why: string;
}

export interface AmendmentPatch extends DeliveryPatch {
  readonly path: string;
  readonly diff: string;
  /** Prose for the PR body. Markdown, no leading heading — the renderer owns the layout. */
  readonly rationale: string;
  /** "fired by ledger event sha256:… at <t> against INV-007". Cited in the patch AND the body. */
  readonly provenance: string;
  readonly changes: readonly AmendmentChange[];
}

/**
 * The knobs a reprogramming proposal is allowed to argue about. Deliberately NOT `status`:
 * `contested` is not a proposal, it is what spec 01 §4.2 says happens automatically when the
 * PR opens, so it is applied unconditionally rather than offered as an option.
 */
export interface ProposedKnobs {
  readonly precision?: number;
  readonly budget?: number;
  /** Source text, e.g. `180d` — `Duration.source` round-trips verbatim (src/core/time.ts). */
  readonly halfLife?: string;
}

export interface AmendmentInput {
  /**
   * `InvariantAssertion` and not `Assertion`: a `CandidateAssertion` pins `status` to the
   * literal `'inferred'` (schema allOf/0, spec 04 §4), is therefore never enforced, therefore
   * never judged, therefore never fires. The type says so.
   */
  readonly assertion: InvariantAssertion;
  /** The CURRENT text of the file, supplied by the caller. This module never reads a file. */
  readonly currentText: string;
  readonly path?: string;
  readonly triggeredBy: EventId;
  readonly firedAt: CommitterTime;
  /** The counter-proposal: what the law should say instead. Optional — Q-52. */
  readonly proposedStatement?: string;
  readonly proposedKnobs?: ProposedKnobs;
  /** Unified-diff context lines. 3 is git's default and what `git apply` expects to see. */
  readonly context?: number;
}

// ---------------------------------------------------------------------------
// Unified diff
// ---------------------------------------------------------------------------

/**
 * A REPLACEMENT-ONLY unified diff: `before` and `after` must have the same length.
 *
 * That is not a limitation being apologised for, it is a design constraint being enforced.
 * Every edit this module makes is an in-place scalar rewrite inside one assertion's block —
 * `status:`, `provenance:`, `statement:`, a knob — so a patch that inserted or deleted a LINE
 * would mean the generator had done something other than what it claims. Refusing to express
 * one keeps the blast radius of a bug inside a single line of `.program/`, and lets the hunk
 * arithmetic stay exact instead of resting on an LCS heuristic.
 *
 * `src/ledger/firing.ts` has the OTHER diff generator, `unifiedDiff`: one hunk, insertions
 * allowed, `string | null`. It is the right tool for appending a precedent and the wrong tool
 * here, precisely because it would happily express an insertion into the constitution. The two
 * are cross-referenced at both sites so a third does not appear; src/ledger cannot import this
 * file in any case (INV-005: the engine may not depend on an adapter).
 */
export function replacementDiff(
  path: string,
  before: readonly string[],
  after: readonly string[],
  context = 3,
  noFinalNewline = false,
): Parsed<string> {
  if (before.length !== after.length) {
    return fail(
      'wrong-type',
      `replacementDiff requires equal line counts, got ${before.length} and ${after.length}`,
    );
  }
  const changed: number[] = [];
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) changed.push(i);
  }
  if (changed.length === 0) return ok('');

  // Group changes whose context windows touch or overlap into one hunk.
  const ranges: { start: number; end: number }[] = [];
  for (const i of changed) {
    const start = Math.max(0, i - context);
    const end = Math.min(before.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }

  const changedSet = new Set(changed);
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  const lastIndex = before.length - 1;

  for (const r of ranges) {
    const len = r.end - r.start + 1;
    out.push(`@@ -${r.start + 1},${len} +${r.start + 1},${len} @@`);
    let i = r.start;
    while (i <= r.end) {
      if (!changedSet.has(i)) {
        out.push(` ${before[i] as string}`);
        if (i === lastIndex && noFinalNewline) out.push('\\ No newline at end of file');
        i += 1;
        continue;
      }
      // A contiguous run of replacements: all `-` lines, then all `+` lines.
      const runStart = i;
      while (i <= r.end && changedSet.has(i)) i += 1;
      for (let j = runStart; j < i; j += 1) {
        out.push(`-${before[j] as string}`);
        if (j === lastIndex && noFinalNewline) out.push('\\ No newline at end of file');
      }
      for (let j = runStart; j < i; j += 1) {
        out.push(`+${after[j] as string}`);
        if (j === lastIndex && noFinalNewline) out.push('\\ No newline at end of file');
      }
    }
  }
  return ok(`${out.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Locating and rewriting one assertion's block
// ---------------------------------------------------------------------------

const ITEM_ID = /^(\s*)-(\s+)id:\s*(\S+)\s*$/;

export interface AssertionBlock {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly indent: string;
}

/**
 * Finds `- id: <wanted>` and the extent of its mapping. Deliberately textual rather than a
 * YAML round trip: re-emitting `.program/invariants.yaml` through a serializer would rewrite
 * comments, quoting and key order across the WHOLE file, and a constitutional diff that
 * touches lines nobody proposed changing is unreviewable — which is to say unratifiable
 * (spec 01 §4 rule 1's spirit, applied to the amendment itself).
 */
export function findAssertionBlock(lines: readonly string[], wanted: string): AssertionBlock | null {
  let start = -1;
  let indent = '';
  for (let i = 0; i < lines.length; i += 1) {
    const m = ITEM_ID.exec(lines[i] as string);
    if (m === null) continue;
    if (start === -1 && m[3] === wanted) {
      start = i;
      indent = m[1] as string;
      continue;
    }
    if (start !== -1) return { start, end: i, indent };
  }
  if (start === -1) return null;
  return { start, end: lines.length, indent };
}

const SCALAR_LINE = /^(\s*)([A-Za-z_][\w-]*):([ \t]*)(.*)$/;

interface FieldLine {
  readonly index: number;
  readonly prefix: string;
  readonly value: string;
}

function findField(
  lines: readonly string[],
  block: AssertionBlock,
  field: string,
): FieldLine | null {
  for (let i = block.start; i < block.end; i += 1) {
    const m = SCALAR_LINE.exec(lines[i] as string);
    if (m === null || m[2] !== field) continue;
    return {
      index: i,
      prefix: `${m[1] as string}${m[2] as string}:${(m[3] as string) === '' ? ' ' : (m[3] as string)}`,
      value: (m[4] as string).trimEnd(),
    };
  }
  return null;
}

/**
 * Plain where plain is unambiguous, double-quoted otherwise. Kept intentionally conservative:
 * this text lands in a file whose only reader that matters is a human deciding whether to
 * ratify it, and a statement that YAML re-reads as something else is the one bug in a
 * governance tool nobody would catch by inspection.
 */
export function yamlScalar(value: string): string {
  const plainSafe =
    value.length > 0 &&
    value === value.trim() &&
    !/[:#'"\n\r\t[\]{}&*!|>%@`,]/.test(value) &&
    !/^[-?]/.test(value);
  return plainSafe ? value : JSON.stringify(value);
}

/** `[a, b]` -> `[a, b, <entry>]`; `null` when the sequence is not in flow style. */
export function appendFlowSequence(value: string, entry: string): string | null {
  const v = value.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) return null;
  const inner = v.slice(1, -1).trim();
  if (inner.includes(entry)) return v;
  return inner.length === 0 ? `[${entry}]` : `[${inner}, ${entry}]`;
}

/**
 * The provenance token a firing contributes. `pr#41` / `adr-0003` / `commit abc123` is the
 * house spelling (spec 01 §3's example), so this reads the same way; it is quoted because a
 * bare `ledger-event:sha256:…` inside a YAML flow sequence is asking for trouble.
 */
export function firingProvenanceRef(triggeredBy: EventId): string {
  return JSON.stringify(`ledger-event:${sha256RefHex(triggeredBy)}`);
}

// ---------------------------------------------------------------------------
// The amendment
// ---------------------------------------------------------------------------

/**
 * Produces the `.program/` patch a reprogramming proposal ships. Pure, total, and incapable of
 * writing anything.
 *
 * Always applied: `status: <whatever> -> contested` (spec 01 §4.2 — set automatically when a
 * reprogramming PR opens; enforcement mutes) and a provenance entry citing the firing event
 * (spec 01 §4 rule 1 — an amendment nobody can trace back to evidence is unreviewable).
 * Optionally applied: the counter-statement and the knobs the proposal argues for.
 */
export function buildAmendment(input: AmendmentInput): Parsed<AmendmentPatch> {
  const path = input.path ?? INVARIANTS_PATH;
  if (!path.startsWith(PROGRAM_DIR)) {
    return fail(
      'invalid-path',
      `a reprogramming amendment targets ${PROGRAM_DIR}, got ${JSON.stringify(path)}`,
    );
  }

  const noFinalNewline = !input.currentText.endsWith('\n') && input.currentText.length > 0;
  const raw = input.currentText.split('\n');
  const before = noFinalNewline ? raw : raw.slice(0, Math.max(raw.length - 1, 0));
  const after = [...before];

  const block = findAssertionBlock(before, input.assertion.id);
  if (block === null) {
    return fail(
      'missing-field',
      `no \`- id: ${input.assertion.id}\` entry in ${path}; the amendment cannot be located`,
    );
  }

  const changes: AmendmentChange[] = [];

  // 1. status -> contested. Not optional, and not a proposal: spec 01 §4.2 makes it automatic.
  const status = findField(before, block, 'status');
  if (status === null) {
    return fail('missing-field', `${input.assertion.id} has no \`status\` field to contest`);
  }
  if (status.value !== 'contested') {
    after[status.index] = `${status.prefix}contested`;
    changes.push({
      field: 'status',
      before: status.value,
      after: 'contested',
      why: 'spec 01 §4.2 — set automatically when a reprogramming PR opens; enforcement mutes while contested',
    });
  }

  // 2. provenance += the firing. "No assertion without provenance" applies to the amendment too.
  const provenance = findField(before, block, 'provenance');
  if (provenance === null) {
    return fail(
      'missing-field',
      `${input.assertion.id} has no \`provenance\` field; spec 01 §4 rule 1 makes it mandatory`,
    );
  }
  const ref = firingProvenanceRef(input.triggeredBy);
  const appended = appendFlowSequence(provenance.value, ref);
  if (appended === null) {
    return fail(
      'wrong-type',
      `${input.assertion.id}'s provenance is not a flow sequence ([a, b]); this generator ` +
        'only edits in place, so a block sequence needs a human',
    );
  }
  if (appended !== provenance.value.trim()) {
    after[provenance.index] = `${provenance.prefix}${appended}`;
    changes.push({
      field: 'provenance',
      before: provenance.value,
      after: appended,
      why: `spec 01 §4 rule 1 — the amendment cites the firing that motivated it (\`${sha256RefHex(input.triggeredBy).slice(0, 12)}\`)`,
    });
  }

  // 3. the counter-proposal, when the proposal has one.
  if (input.proposedStatement !== undefined) {
    const statement = findField(before, block, 'statement');
    if (statement === null) {
      return fail('missing-field', `${input.assertion.id} has no \`statement\` field to amend`);
    }
    const next = yamlScalar(input.proposedStatement);
    if (next !== statement.value) {
      after[statement.index] = `${statement.prefix}${next}`;
      changes.push({
        field: 'statement',
        before: statement.value,
        after: next,
        why: 'the proposal argues the law says the wrong thing, not that the code does',
      });
    }
  }

  const knobs = input.proposedKnobs;
  if (knobs !== undefined) {
    const knobEdits: readonly { field: string; value: string | undefined; why: string }[] = [
      {
        field: 'precision',
        value: knobs.precision === undefined ? undefined : String(knobs.precision),
        why: 'surprise weight per violation — how much each breach should cost (spec 01 §3)',
      },
      {
        field: 'budget',
        value: knobs.budget === undefined ? undefined : String(knobs.budget),
        why: 'accumulated surprise before a proposal fires (spec 01 §3)',
      },
      {
        field: 'half_life',
        value: knobs.halfLife,
        why: 'decay constant — how fast the repo is forgiven (spec 02 §4, ADR-0004)',
      },
    ];
    for (const edit of knobEdits) {
      if (edit.value === undefined) continue;
      const field = findField(before, block, edit.field);
      if (field === null) {
        return fail('missing-field', `${input.assertion.id} has no \`${edit.field}\` field`);
      }
      const next = yamlScalar(edit.value);
      if (next === field.value) continue;
      after[field.index] = `${field.prefix}${next}`;
      changes.push({ field: edit.field, before: field.value, after: next, why: edit.why });
    }
  }

  const diff = replacementDiff(path, before, after, input.context ?? 3, noFinalNewline);
  if (!diff.ok) return diff;

  const provenanceLine =
    `fired by ledger event \`${input.triggeredBy}\` at \`${input.firedAt}\`, ` +
    `accumulating against \`${input.assertion.id}\``;

  return ok({
    path,
    diff: diff.value,
    changes,
    provenance: provenanceLine,
    rationale: renderAmendmentRationale(path, changes, provenanceLine),
  });
}

/**
 * The prose half of the patch. Says three things a reviewer needs and a diff cannot: what
 * changes, why each line changes, and that the thing in front of them is a patch precisely
 * because a machine may not apply it.
 */
export function renderAmendmentRationale(
  path: string,
  changes: readonly AmendmentChange[],
  provenance: string,
): string {
  const lines: string[] = [];
  lines.push(`This amendment touches \`${path}\` and nothing else.`);
  lines.push('');
  if (changes.length === 0) {
    lines.push(
      'No edit is required: the assertion is already `contested` and already cites this firing.',
    );
  } else {
    lines.push('| field | current | proposed | why |');
    lines.push('|---|---|---|---|');
    for (const c of changes) {
      lines.push(
        `| \`${c.field}\` | \`${c.before}\` | \`${c.after}\` | ${c.why} |`,
      );
    }
  }
  lines.push('');
  lines.push(`**Provenance.** ${provenance}`);
  lines.push('');
  lines.push(
    'INV-001 — *"nothing writes to `.program/` except human-ratified PRs; machine actors are ' +
      'excluded from the path"* — is `enforcement: deterministic`, `precision: 1.0`, ' +
      '`budget: 1.0`, so a single machine write to the program store fires immediately. This ' +
      'is therefore a **patch, not a commit**. A human applies it under their own name, in a ' +
      'reviewed PR, or rejects it — and a rejection is itself evidence: spec 02 §6 says a ' +
      "proposal rejected under fire writes an `affirmed` precedent and *raises* the " +
      'assertion’s precision. A law ratified under fire is a stronger prior.',
  );
  return lines.join('\n');
}

/** `git apply -p1 < patch` / `patch -p1 < patch`, spelled out for the issue body. */
export function applyInstructions(): string {
  return ['```bash', 'git apply path/to/amendment.patch   # from the repo root', '```'].join('\n');
}
