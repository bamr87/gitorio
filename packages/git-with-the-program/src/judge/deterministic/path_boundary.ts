// Implements: docs/spec/03-judge.md §1 (the judgment ladder — the DETERMINISTIC rung, "every
// push", zero variance, zero cost), §3 (evidence assembly: "the diff hunks intersecting the
// assertion's scope"), §4 (the output contract), docs/adr/0005-anchored-severity.md, and the
// `class: boundary` shape of .program/invariants.yaml INV-001 ("Nothing writes to .program/
// except human-ratified PRs; machine actors are excluded from the path", scope `.program/**`,
// `enforcement: deterministic`, budget 1.0 — one write of the constitution's store fires
// immediately). Output conforms to schemas/verdict.schema.json via `Verdict`, which expresses
// that schema's allOf/if/then conditionals as union membership, so an uncited violation or an
// off-anchor severity is unconstructable rather than merely invalid (INV-004).
//
// SCOPE OF THIS FILE. The path-boundary magistrate is ONE narrow judge on the bench (spec 03
// §1: "not one omniscient reviewer"). It rules the deterministic slice of a boundary assertion:
// did this change WRITE into a protected subtree? The author-blind, hunk-only view means it
// cannot decide whether the write was human-ratified — that is INV-001's git-range check
// (scripts/check-inv001.ts) and the firing-time actor/dispersion walk (spec 02 §5), which run
// on the sentencing branch this judge may never see. This judge rules on CONDUCT ("a write into
// the protected store happened here, at these lines"); whether the conduct was sanctioned is
// decided elsewhere. Verdict and sentencing are separate branches (spec 03 §2).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). It sits under `src/judge/**`, so `scripts/check-inv003.ts` forbids
//  it from value-importing `core/{sentencing,accumulator,dispersion}`, and
//  `tests/ledger/blindness-boundary.test.ts` forbids it from REACHING them through any chain of
//  value imports. Like src/judge/deterministic/imports.ts, every value import below leads only
//  to sentencing-clean core (`brand`/`result`/`ids`/`paths`/`change`/`severity`/`verdict`) or
//  to imports.ts itself (a sibling blind module with a provably clean closure); `SealedEvidence`,
//  `Judge`, `AssertionView` and `JudgeRef` are ERASED type-only imports. A VALUE import of
//  evidence.ts would reach `core/blindness.ts` → `SENTENCING_TAG` in `core/sentencing.ts` and
//  fail the reachability rule — see imports.ts's header and docs/spec/OPEN-QUESTIONS.md Q-60.
//  There is no second parameter through which authorship or a running total could arrive: the
//  only input is `SealedEvidence`, which only `sealEvidence()` mints.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { isNonEmpty, type NonEmptyReadonlyArray } from '../../core/brand.js';
import { scopedHunks, type Hunk } from '../../core/change.js';
// TYPE-ONLY, and load-bearing that it stays that way — see the header.
import type { AssertionView, Judge, SealedEvidence } from '../../core/evidence.js';
import type { JudgeRef } from '../../core/event.js';
import type { AccumulatorKey } from '../../core/ids.js';
import { parseJudgeId } from '../../core/ids.js';
import { type PathGlob, type RepoPath, matchesScope, parsePathGlob } from '../../core/paths.js';
import { type Parsed, unwrap } from '../../core/result.js';
import { compareSeverity, type SeverityOrdinal } from '../../core/severity.js';
import { parseCitation, parseConfidence } from '../../core/verdict.js';
import type {
  AbstainVerdict,
  AlignedVerdict,
  Citation,
  Confidence,
  DriftVerdict,
  Verdict,
} from '../../core/verdict.js';
import { postImageLines } from './imports.js';

// ---------------------------------------------------------------------------
// Judge identity (spec 03 §6: changing the id is seating a new judge)
// ---------------------------------------------------------------------------

/**
 * A deterministic check has no model and no prompt, so its identity is the NAME OF THE
 * PROCEDURE. `JudgeRef.prompt` is deliberately absent: there is no prompt file to hash, and
 * inventing one would make `judgeHash` claim a provenance that does not exist. Matches the
 * IMPORT_BOUNDARY_JUDGE / judgeImportBoundary split in imports.ts.
 */
export const PATH_BOUNDARY_JUDGE_ID = 'path-boundary';

export const PATH_BOUNDARY_JUDGE: JudgeRef = {
  kind: 'deterministic',
  id: unwrap(parseJudgeId(PATH_BOUNDARY_JUDGE_ID)),
};

/**
 * A deterministic procedure either saw the offending line or it did not. `confidence: 1` is the
 * honest reading, and it is what makes this rung cheap enough to run on every push (spec 03 §1).
 */
const CERTAIN: Confidence = unwrap(parseConfidence(1));

/**
 * spec 01 §3 gives every assertion a `class`, and this procedure can only rule on ONE of them.
 * A `boundary` assertion is the one whose statement is "these paths are a protected subtree".
 * An assertion of another class handed to this judge gets an `abstain` — "honest insufficiency"
 * (spec 03 §4) — rather than a fabricated `aligned`, which would be a compliance the ledger
 * counts and ships as evidence quality (spec 02 §4). Out of jurisdiction is insufficiency, not
 * innocence. See docs/spec/OPEN-QUESTIONS.md Q-59.
 */
const JUDGED_CLASS = 'boundary' as const;

// ---------------------------------------------------------------------------
// What counts as a protected subtree
// ---------------------------------------------------------------------------

/**
 * A stable id, the glob it protects, and why it is protected. Reviewed as LAW, not as code —
 * the same shape `imports.ts` gives `FORGE_MODULE_PATTERNS` and `scripts/check-inv001.ts` gives
 * `MACHINE_ACTOR_PATTERNS`, and for the same reason: adding an entry widens what this engine
 * treats as a no-write zone, and a reviewer should be able to read that off the diff.
 */
export interface ProtectedSubtree {
  readonly id: string;
  /** A supported glob (docs/spec/OPEN-QUESTIONS.md Q-12), matched against a hunk's path. */
  readonly glob: PathGlob;
  readonly why: string;
}

const g = (raw: string): PathGlob => unwrap(parsePathGlob(raw));

/**
 * The no-write zones this deterministic rung knows how to defend. This is ENGINE JUDGEMENT, not
 * spec text: an `Assertion` carries a `scope` but no "forbidden subtree" field, so which subtree
 * a `boundary` assertion protects is not derivable from the record alone. The least-committal,
 * reviewable choice — mirroring imports.ts's fixed forge list — is an explicit list here, keyed
 * on the one boundary the constitution states outright: the program store (INV-001). The
 * assertion's `scope` still decides which hunks are examined (spec 03 §3); this list decides
 * which of those paths are a write into protected ground.
 *
 * STATED RECALL GAP, rather than papered over: a boundary assertion protecting some OTHER subtree
 * (a vendored tree, a generated directory) is invisible to this rung until its glob is added
 * here — exactly as imports.ts sees only the forges on its list. Widening the enforced set is a
 * reviewable edit to this constant, and the finer question of whether the forbidden subtree
 * should become a first-class assertion field is a `.program/`/schema amendment, not a code
 * change (cf. docs/spec/OPEN-QUESTIONS.md Q-58, Q-12).
 */
export const FORBIDDEN_WRITE_SUBTREES: readonly ProtectedSubtree[] = [
  {
    id: 'program-store',
    glob: g('.program/**'),
    why:
      "INV-001: the program store is the constitution, and its budget is 1.0 — a single write " +
      'to `.program/` that is not a human-ratified PR fires a proposal immediately (spec 01 §4, ' +
      'ADR-0001). A diff that adds content under `.program/` is a write into that store; whether ' +
      'it was ratified is the ledger\'s question at firing time, never this judge\'s (spec 03 §2).',
  },
];

/** The first protected subtree whose glob matches, or `null`. Pure and total. */
export function protectedSubtreeOf(path: RepoPath): ProtectedSubtree | null {
  for (const s of FORBIDDEN_WRITE_SUBTREES) {
    if (matchesScope([s.glob], path)) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The severity ladder (ADR-0005: four anchors, never a bare float)
// ---------------------------------------------------------------------------

/**
 * `modify`   — the change adds lines to an EXISTING file inside a protected subtree. It plainly
 *              writes into ground the boundary declares off-limits: a **breach**.
 * `new-file` — the change CREATES a new file inside a protected subtree (the hunk's pre-image is
 *              empty: `@@ -0,0 +1,N @@`). A wholly new artifact of law/state — new surface that
 *              future changes will depend on and that is hardest to walk back. It **entrenches**.
 *
 * This ladder is engine judgement, NOT spec text: ADR-0005 fixes the four anchors and their
 * numeric mapping and says nothing about which write form sits on which rung. This rung emits
 * only `breach` and `entrenches`: distinguishing `grazes`/`bends` ("touches or tests the
 * boundary" vs "crosses in an arguably-scoped way") is a judgement call a specifier-free line
 * count cannot make honestly, so it is left to the LLM rung. Named as a const, so it is arguable
 * and a reprogramming proposal has something concrete to argue with. See OPEN-QUESTIONS Q-58.
 */
export const WRITE_FORM_SEVERITY = {
  modify: 'breach',
  'new-file': 'entrenches',
} as const satisfies Record<WriteForm, SeverityOrdinal>;

export type WriteForm = 'modify' | 'new-file';

// ---------------------------------------------------------------------------
// Reading a protected write out of a hunk
// ---------------------------------------------------------------------------

export interface WriteOffence {
  readonly path: RepoPath;
  readonly subtree: ProtectedSubtree;
  readonly form: WriteForm;
  readonly severity: SeverityOrdinal;
  /**
   * The 1-based post-image span of the ADDED lines, or `null` when the hunk touched the
   * protected file but introduced no added line (a pure deletion, whose post-image has nothing
   * to cite). A null span is what turns "no citation, no verdict" (INV-004) into an `abstain`
   * rather than a fabricated `path:0` — the removal is real, but this rung cannot cite it.
   */
  readonly addedSpan: { readonly start: number; readonly end: number } | null;
  /** Count of added lines, for the rationale. */
  readonly addedCount: number;
}

/**
 * `true` for `@@ -0,0 +1,N @@`: an empty pre-image, i.e. a newly created file. `oldStart === 0`
 * distinguishes creation from a pure insertion into an existing file (`@@ -5,0 +6,N @@`, where
 * `oldStart` is 5). See docs/spec/OPEN-QUESTIONS.md Q-12 for the diff shapes the engine reads.
 */
function isNewFileHunk(hunk: Hunk): boolean {
  return hunk.oldStart === 0 && hunk.oldLines === 0;
}

/**
 * Every write this diff INTRODUCED into a protected subtree, one offence per offending hunk.
 *
 * A judge rules on the change it was shown (spec 03 §3): a hunk that merely rode along as
 * context is the state of the repository, not something this diff did. Only hunks whose PATH
 * lands in a protected subtree are offences; the added-line span is what a `Citation` points at,
 * and a hunk that only removed lines yields a `null` span (uncitable), never a false one.
 *
 * Pure: no fs, no clock, no randomness. Same hunks, same offences, forever — which is what makes
 * the rationale (and therefore the ledger event's content hash) stable across runs.
 */
export function findProtectedWrites(hunks: readonly Hunk[]): readonly WriteOffence[] {
  const offences: WriteOffence[] = [];

  for (const hunk of hunks) {
    const subtree = protectedSubtreeOf(hunk.path);
    if (subtree === null) continue;

    const added = postImageLines(hunk)
      .filter((l) => l.added)
      .map((l) => l.n);
    const form: WriteForm = isNewFileHunk(hunk) ? 'new-file' : 'modify';
    const addedSpan =
      added.length === 0
        ? null
        : { start: Math.min(...added), end: Math.max(...added) };

    offences.push({
      path: hunk.path,
      subtree,
      form,
      severity: WRITE_FORM_SEVERITY[form],
      addedSpan,
      addedCount: added.length,
    });
  }

  return offences.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      (a.addedSpan?.start ?? 0) - (b.addedSpan?.start ?? 0),
  );
}

// ---------------------------------------------------------------------------
// The verdict (spec 03 §4, schemas/verdict.schema.json)
// ---------------------------------------------------------------------------

/**
 * A citation goes through the CONTRACT's own parser, never around it — the same discipline
 * imports.ts uses. Building a `Citation` struct directly would let a hunk with `newStart: 0`
 * mint a `path:0` citation, a string `parseCitation` rejects as not 1-based; i.e. a `drift`
 * verdict that satisfies "no citation, no verdict" only nominally (INV-004). `parseCitation` is
 * the one gate; an offence it rejects cannot ground a violation, and the caller abstains instead.
 */
function citationOf(offence: WriteOffence): Parsed<Citation> | null {
  if (offence.addedSpan === null) return null;
  const { start, end } = offence.addedSpan;
  const raw = start === end ? `${offence.path}:${start}` : `${offence.path}:${start}-${end}`;
  return parseCitation(raw);
}

function abstention(assertion: AccumulatorKey, rationale: string): AbstainVerdict {
  return { assertion, verdict: 'abstain', confidence: CERTAIN, rationale };
}

/**
 * "Aligned verdicts stay terse: verdict + confidence only" (spec 03 §4). The type has nowhere to
 * put anything else.
 */
function alignment(assertion: AccumulatorKey): AlignedVerdict {
  return { assertion, verdict: 'aligned', confidence: CERTAIN };
}

/**
 * Deterministic prose, and it has to be: this string is hashed into the ledger event's
 * `rationale` blob ref, which is part of the hashed event body, which is the event's id and its
 * idempotency key (spec 02 §1). A rationale that varied between runs would make the same
 * observation land at two content addresses and defeat the append-only design.
 */
export function renderPathBoundaryRationale(
  view: AssertionView,
  offences: NonEmptyReadonlyArray<WriteOffence>,
  severity: SeverityOrdinal,
): string {
  const lines: string[] = [
    `${view.id} — ${view.statement}`,
    '',
    `This change writes into ${offences.length} protected path(s) inside the assertion's scope ` +
      `(${view.scope.join(', ')}). Anchored severity \`${severity}\` is the worst rung among ` +
      'them (ADR-0005: four anchors, never a bare float).',
    '',
  ];
  for (const o of offences) {
    const span =
      o.addedSpan === null
        ? `${o.path} (no citable post-image span)`
        : o.addedSpan.start === o.addedSpan.end
          ? `${o.path}:${o.addedSpan.start}`
          : `${o.path}:${o.addedSpan.start}-${o.addedSpan.end}`;
    lines.push(
      `- ${span} — ${o.form} write into the \`${o.subtree.id}\` subtree ` +
        `(${o.addedCount} line(s) added) → \`${o.severity}\`\n    ${o.subtree.why}`,
    );
  }
  lines.push(
    '',
    'This judge rules on conduct, not on authorisation: whether the write arrived through a ' +
      'human-ratified PR is decided by the machine-actor check (scripts/check-inv001.ts) and by ' +
      'the firing-time dispersion walk (spec 02 §5), on the sentencing branch this judge is blind ' +
      'to (spec 03 §2). If the write was ratified, that branch will not fire on it.',
  );
  return lines.join('\n');
}

/**
 * THE JUDGE. `SealedEvidence` in, `Verdict` out — the one signature every rung of the ladder
 * implements (src/core/evidence.ts), so this rung is drop-in substitutable for the model rung.
 * Because `sealEvidence` is the only minter of the parameter type, there is no second argument
 * through which authorship or a running total could arrive (INV-003); because the return type is
 * the `Verdict` union, an uncited violation or an off-anchor severity is unconstructable rather
 * than merely invalid (INV-004).
 *
 * Total. Four outcomes, and each says something different:
 *   abstain  — wrong assertion class, nothing in scope, or a write with no citable span: honest
 *              insufficiency (spec 03 §4, OPEN-QUESTIONS Q-59). Never accumulates.
 *   aligned  — in-scope hunks, none of them a write into a protected subtree. Counted, subtracts
 *              nothing (spec 02 §4).
 *   drift    — a write into a protected subtree was introduced, and it could be cited.
 * `regression` is deliberately never emitted: it requires a `PRE-id` (spec 03 §7), and case law
 * is not something a path glob can read.
 */
export function judgePathBoundary(sealed: SealedEvidence): Verdict {
  const view = sealed.bundle.assertion;
  const key: AccumulatorKey = view.id;

  if (view.class !== JUDGED_CLASS) {
    return abstention(
      key,
      `the path-boundary check rules on \`class: ${JUDGED_CLASS}\` assertions; ` +
        `${view.id} is \`class: ${view.class}\`. Escalate rather than assume compliance ` +
        '(spec 03 §4).',
    );
  }

  const hunks = scopedHunks(view.scope, sealed.bundle.hunks);
  if (hunks.length === 0) {
    return abstention(
      key,
      `no hunk in this change intersects ${view.id}'s scope (${view.scope.join(', ')}), so there ` +
        'is nothing to rule on. An `aligned` here would be a compliance the ledger counts and ' +
        'ships as evidence quality (spec 02 §4) on the strength of having looked at nothing ' +
        '(docs/spec/OPEN-QUESTIONS.md Q-59).',
    );
  }

  const offences = findProtectedWrites(hunks);
  // In-scope hunks, but none of them writes into a protected subtree: honest compliance.
  if (!isNonEmpty(offences)) return alignment(key);

  // One citation per offending write, deduplicated and ordered — "no citation, no verdict"
  // (ADR-0005, INV-004). Each is minted through `parseCitation`, so a pure-deletion offence (a
  // null span) simply produces no citation.
  const seen = new Set<string>();
  const evidence: Citation[] = [];
  const citable: WriteOffence[] = [];
  for (const o of offences) {
    const c = citationOf(o);
    if (c === null || !c.ok) continue; // uncitable: it cannot ground a violation (INV-004)
    if (!seen.has(c.value.source)) {
      seen.add(c.value.source);
      evidence.push(c.value);
    }
    citable.push(o);
  }

  // Writes existed but none could be cited: the honest ruling is abstain — the absence of a
  // citable span is insufficiency, never a silent pass and never a fabricated `path:0`
  // (spec 03 §4, INV-004). The escalated rung sees a wider context ring.
  if (!isNonEmpty(evidence) || !isNonEmpty(citable)) {
    return abstention(
      key,
      `a change touches ${view.id}'s protected subtree, but on a hunk whose post-image carries ` +
        'no line the citation contract can express (a 1-based span) — a pure deletion, typically. ' +
        'A violation without a citable span is honest insufficiency, not a pass (INV-004, ' +
        'spec 03 §4).',
    );
  }

  const severity = citable
    .map((o) => o.severity)
    .reduce((worst, s) => (compareSeverity(s, worst) > 0 ? s : worst));

  const drift: DriftVerdict = {
    assertion: key,
    verdict: 'drift',
    severity,
    evidence,
    rationale: renderPathBoundaryRationale(view, citable, severity),
    confidence: CERTAIN,
  };
  return drift;
}

/** The `Judge` shape, so this rung is substitutable for the model rung SEED-03 seats. */
export const pathBoundaryJudge: Judge = judgePathBoundary;
