// Implements: docs/spec/03-judge.md §6 ("The bar exam and judge drift" — "Any new judge — a
// change to model id OR prompt hash — must re-decide the settled cases in precedents.yaml and
// match the rulings before it may sit"; "Golden-sample drift checks … the observer is
// observed"; "Seating is constitutional") against schemas/precedent.schema.json,
// schemas/verdict.schema.json and .program/invariants.yaml INV-001.
//
// THE BAR EXAM. A candidate judge — identified by its `JudgeSeat` (id, model, prompt hash), so
// any change to model OR prompt is a NEW candidate that must re-sit — replays a corpus of
// settled cases and must match every ruling before it may be seated. A golden-sample drift
// check re-judges a frozen sample and reports whether the verdict distribution moved while the
// code did not. And seating a passing judge produces a PROPOSED `.program/manifest.yaml` diff
// for a human ratification PR — never a machine write to `.program/` (INV-001).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). This file sits under `src/judge/**`. It ADJUDICATES over sealed
//  evidence and NEVER assembles it: a `BarExamCase` arrives with its `SealedEvidence` already
//  minted (by a non-blind caller — the CLI, a test, a corpus loader), exactly as the judges it
//  examines receive theirs. So, like `src/judge/deterministic/imports.ts`, this file
//  type-only-imports `SealedEvidence`/`Judge` (erased) and deep-imports only sentencing-clean
//  core modules — verdict, severity, program, ids, result — never the `src/core` barrel (which
//  value-re-exports the accumulator) and never a declassifier. Its runtime value-closure is
//  provably free of `core/{sentencing,accumulator,dispersion}.ts` under both readings of
//  docs/spec/OPEN-QUESTIONS.md Q-60.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml';

import type { Judge, SealedEvidence } from '../core/evidence.js';
import type { PrecedentId } from '../core/ids.js';
import { type Sha256Ref } from '../core/ids.js';
import type { Precedent } from '../core/precedent.js';
import {
  type JudgeSeat,
  type Manifest,
  decodeManifest,
  encodeManifest,
  judgeSeatHash,
  seatedJudge,
} from '../core/program.js';
import { type Parsed, fail, ok, unwrap } from '../core/result.js';
import type { SeverityOrdinal } from '../core/severity.js';
import {
  type Verdict,
  type VerdictKind,
  VERDICT_KINDS,
  isViolation,
  isViolationKind,
} from '../core/verdict.js';

// ---------------------------------------------------------------------------
// A settled case and the ruling it was settled at
// ---------------------------------------------------------------------------

/**
 * What a faithful judge must return for a settled case. A ruling is a verdict KIND plus, on a
 * violation, its anchored severity (ADR-0005: severity is part of the ruling, not decoration),
 * plus, on a regression, the PRE-id it turns on (spec 03 §7: "case law works by citation").
 * Confidence, rationale prose and exact citation spans are deliberately NOT part of a ruling
 * match: they are judge-specific, and two faithful judges may word the same call differently
 * and cite overlapping-but-not-identical spans.
 */
export interface ExpectedRuling {
  readonly verdict: VerdictKind;
  readonly severity?: SeverityOrdinal;
  readonly precedent?: PrecedentId;
}

/** One bar-exam case: sealed evidence to re-judge, and the ruling it was settled at. */
export interface BarExamCase {
  readonly id: string;
  readonly evidence: SealedEvidence;
  readonly expected: ExpectedRuling;
  /** Optional human label, e.g. the precedent's `pattern`. */
  readonly note?: string;
}

/**
 * A settled case sourced from case law. `precedents.yaml` is the persistent home of the bar
 * exam (spec 03 §6: "Precedents moonlight as the bar exam"); a precedent supplies the case id
 * and pattern, while the sealed diff and the ruling it was settled at are supplied alongside —
 * a precedent record carries neither a `Verdict` nor a severity, so they cannot be derived
 * from it (schemas/precedent.schema.json).
 */
export interface SettledCase {
  readonly precedent: Precedent;
  readonly evidence: SealedEvidence;
  readonly expected: ExpectedRuling;
}

/** Lift a case-law entry into a bar-exam case, keyed by its PRE-id. */
export function toBarExamCase(c: SettledCase): BarExamCase {
  return {
    id: c.precedent.id,
    evidence: c.evidence,
    expected: c.expected,
    ...(c.precedent.pattern.length > 0 ? { note: c.precedent.pattern } : {}),
  };
}

/**
 * A well-formed expectation. A violation ruling without a severity, or a regression without a
 * PRE-id, is a malformed CORPUS, not a judge failure — it is rejected loudly with the same
 * error vocabulary the verdict decoder uses, so a broken bar-exam fixture cannot silently pass
 * a judge that happens to agree with an underspecified ruling.
 */
export function validateExpectedRuling(e: ExpectedRuling): Parsed<ExpectedRuling> {
  if (isViolationKind(e.verdict) && e.severity === undefined) {
    return fail('invalid-severity', `an expected ${e.verdict} ruling needs an anchored severity`);
  }
  if (e.verdict === 'regression' && e.precedent === undefined) {
    return fail('missing-precedent', 'an expected regression ruling needs a PRE-id (spec 03 §7)');
  }
  if (!isViolationKind(e.verdict) && e.severity !== undefined) {
    return fail('strictness', `an expected ${e.verdict} ruling carries no severity (spec 03 §4)`);
  }
  return ok(e);
}

// ---------------------------------------------------------------------------
// Ruling comparison
// ---------------------------------------------------------------------------

export interface RulingMismatch {
  readonly field: 'verdict' | 'severity' | 'precedent';
  readonly expected: string;
  readonly actual: string;
}

/**
 * `null` when the judge's ruling matches the settled one. The comparison is exactly the three
 * load-bearing components — kind, then (on a violation) anchored severity, then (on a
 * regression) the PRE-id — and stops at the first that differs, so the report names ONE reason
 * a case failed rather than a cascade.
 */
export function compareRuling(expected: ExpectedRuling, actual: Verdict): RulingMismatch | null {
  if (actual.verdict !== expected.verdict) {
    return { field: 'verdict', expected: expected.verdict, actual: actual.verdict };
  }
  if (isViolationKind(expected.verdict)) {
    const actualSeverity = isViolation(actual) ? actual.severity : undefined;
    if (actualSeverity !== expected.severity) {
      return {
        field: 'severity',
        expected: String(expected.severity),
        actual: String(actualSeverity),
      };
    }
    if (expected.verdict === 'regression') {
      const actualPrecedent = actual.verdict === 'regression' ? actual.precedent : undefined;
      if (actualPrecedent !== expected.precedent) {
        return {
          field: 'precedent',
          expected: String(expected.precedent),
          actual: String(actualPrecedent),
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The bar exam
// ---------------------------------------------------------------------------

export interface CaseResult {
  readonly caseId: string;
  readonly expected: ExpectedRuling;
  readonly actual: Verdict;
  readonly agrees: boolean;
  readonly mismatch: RulingMismatch | null;
}

export interface BarExamReport {
  /** The candidate whose right to sit this run decides (spec 03 §6). */
  readonly candidate: JudgeSeat;
  /** `judgeSeatHash(candidate)` — the identity a passing run authorizes, model AND prompt. */
  readonly seatHash: Sha256Ref;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly CaseResult[];
  /** True iff the corpus was non-empty and EVERY case matched (spec 03 §6: any mismatch blocks). */
  readonly seatingAllowed: boolean;
}

/**
 * Replay every settled case against the candidate and report. Blocks seating on ANY mismatch,
 * and on an EMPTY corpus — a bar exam that examined nothing has not passed, it has failed to
 * look (the same posture `scripts/check-inv003.ts` takes on an empty scan). The candidate is a
 * `JudgeSeat`, so the passing run is bound to one (id, model, prompt) identity: change the
 * model or the prompt and `seatHash` changes, which is precisely what spec 03 §6 calls seating
 * a new judge and re-gates on a fresh bar exam.
 *
 * Pure over its inputs apart from the judge itself: the judge may be async (the LLM rung is),
 * so cases run in sequence and the report is deterministic in case order.
 */
export async function runBarExam(
  candidate: JudgeSeat,
  judge: Judge,
  corpus: readonly BarExamCase[],
): Promise<BarExamReport> {
  const results: CaseResult[] = [];
  for (const c of corpus) {
    unwrap(validateExpectedRuling(c.expected));
    const actual = await judge(c.evidence);
    const mismatch = compareRuling(c.expected, actual);
    results.push({
      caseId: c.id,
      expected: c.expected,
      actual,
      agrees: mismatch === null,
      mismatch,
    });
  }
  const failed = results.filter((r) => !r.agrees).length;
  const seatHash = unwrap(judgeSeatHash(candidate));
  return {
    candidate,
    seatHash,
    total: results.length,
    passed: results.length - failed,
    failed,
    results,
    seatingAllowed: corpus.length > 0 && failed === 0,
  };
}

// ---------------------------------------------------------------------------
// Golden-sample drift ("the observer is observed", spec 03 §6)
// ---------------------------------------------------------------------------

/** One frozen sample: sealed evidence plus the verdict a reference run recorded for it. */
export interface GoldenCase {
  readonly id: string;
  readonly evidence: SealedEvidence;
  readonly recorded: VerdictKind;
}

export interface GoldenSample {
  readonly id: string;
  readonly cases: readonly GoldenCase[];
}

/** How many of each verdict kind — the DISTRIBUTION spec 03 §6 watches for a shift in. */
export type VerdictDistribution = Readonly<Record<VerdictKind, number>>;

export function emptyDistribution(): VerdictDistribution {
  const d: Record<VerdictKind, number> = {
    aligned: 0,
    drift: 0,
    regression: 0,
    'stale-claim': 0,
    abstain: 0,
  };
  return d;
}

export function tallyVerdicts(kinds: readonly VerdictKind[]): VerdictDistribution {
  const d = { ...emptyDistribution() } as Record<VerdictKind, number>;
  for (const k of kinds) d[k] += 1;
  return d;
}

/** A case whose verdict kind changed between the frozen baseline and the current run. */
export interface CaseFlip {
  readonly id: string;
  readonly recorded: VerdictKind;
  readonly current: VerdictKind;
}

export interface DriftReport {
  readonly sampleId: string;
  readonly baseline: VerdictDistribution;
  readonly current: VerdictDistribution;
  /** spec 03 §6's headline signal: the verdict distribution moved. */
  readonly distributionShifted: boolean;
  readonly shiftedKinds: readonly VerdictKind[];
  /** Per-case changes — surfaced so a distribution-PRESERVING swap is still visible to a human. */
  readonly caseFlips: readonly CaseFlip[];
  /** Either signal is drift. */
  readonly drifted: boolean;
}

/**
 * Re-judge a frozen sample and compare to what a reference run recorded. spec 03 §6: "If
 * verdict distributions shift while the code didn't, the judge drifted. The observer is
 * observed, with the same machinery" — so this uses the very `Judge` interface it examines, and
 * reports the distribution move as the headline. Per-case flips are also surfaced, because a
 * judge that swaps two cases' verdicts leaves the distribution untouched yet has plainly
 * changed its mind; either counts as `drifted`.
 *
 * The "while the code didn't" clause is the caller's to supply (a code-revision marker
 * alongside the sample): identical deterministic code re-judging the same sealed evidence
 * reproduces the recorded verdicts exactly, so a shift observed under unchanged code is drift
 * in the model, not in the harness.
 */
export async function checkGoldenDrift(sample: GoldenSample, judge: Judge): Promise<DriftReport> {
  const baseline = tallyVerdicts(sample.cases.map((c) => c.recorded));
  const currentKinds: VerdictKind[] = [];
  const flips: CaseFlip[] = [];
  for (const c of sample.cases) {
    const v = await judge(c.evidence);
    currentKinds.push(v.verdict);
    if (v.verdict !== c.recorded) {
      flips.push({ id: c.id, recorded: c.recorded, current: v.verdict });
    }
  }
  const current = tallyVerdicts(currentKinds);
  const shiftedKinds = VERDICT_KINDS.filter((k) => baseline[k] !== current[k]);
  const distributionShifted = shiftedKinds.length > 0;
  return {
    sampleId: sample.id,
    baseline,
    current,
    distributionShifted,
    shiftedKinds,
    caseFlips: flips,
    drifted: distributionShifted || flips.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Seating: a PROPOSED manifest diff, never a machine write to .program/ (INV-001)
// ---------------------------------------------------------------------------

/** Raised when seating is refused. The report travels with it so a caller can show why. */
export class SeatingBlockedError extends Error {
  readonly report: BarExamReport;

  constructor(report: BarExamReport, reason: string) {
    super(`seating blocked: ${reason}`);
    this.name = 'SeatingBlockedError';
    this.report = report;
  }
}

export interface SeatingProposal {
  /** Copy-pasteable unified diff against `.program/manifest.yaml`, adding the candidate seat. */
  readonly diff: string;
  /** The human-readable case for the seating PR (spec 03 §6: seating is constitutional). */
  readonly rationale: string;
  readonly seat: JudgeSeat;
  readonly seatHash: Sha256Ref;
}

const MANIFEST_PATH = '.program/manifest.yaml';

/**
 * Round-trip the candidate's identity through the manifest representation (spec 03 §6: "judge
 * definitions (model + prompt hash) live in `.program/manifest.yaml`"). Applies the seat to a
 * decoded manifest, re-encodes and re-decodes, and confirms `judgeSeatHash` is preserved —
 * proof that seating the judge and reading it back names the SAME (id, model, prompt). Uses
 * the structural encoder/decoder, so it is independent of YAML formatting and comments.
 */
export function seatingRoundTrips(currentManifestYaml: string, candidate: JudgeSeat): boolean {
  const manifest = unwrap(decodeManifest(parseYaml(currentManifestYaml)));
  const next: Manifest = { ...manifest, judges: [...manifest.judges, candidate] };
  const reparsed = unwrap(decodeManifest(parseYaml(rawStringify(encodeManifest(next)))));
  const seat = seatedJudge(reparsed, candidate.id);
  if (seat === null) return false;
  return unwrap(judgeSeatHash(seat)) === unwrap(judgeSeatHash(candidate));
}

/**
 * The seating gate. Produces the proposed `.program/manifest.yaml` diff for a ratification PR —
 * and REFUSES unless the bar exam passed for this exact candidate. Three refusals, all
 * `SeatingBlockedError`:
 *   1. the bar exam did not pass (any mismatch, or an empty corpus);
 *   2. the report is for a different identity than the seat being proposed (seat-hash mismatch)
 *      — a passing run for judge A cannot be spent seating judge B;
 *   3. a judge already sits under this id (re-seating is a supersession a human authors).
 *
 * NEVER writes `.program/` (INV-001, budget 1.0): the return value is a string a human pastes
 * into a PR. The diff is produced with the `yaml` Document API so the existing file's comments
 * and formatting survive and the change stays reviewable as a minimal hunk.
 */
export function proposeSeating(
  currentManifestYaml: string,
  candidate: JudgeSeat,
  report: BarExamReport,
): SeatingProposal {
  if (!report.seatingAllowed) {
    throw new SeatingBlockedError(
      report,
      report.total === 0
        ? 'the bar-exam corpus was empty — a run that examined nothing has not passed (spec 03 §6)'
        : `${report.failed} of ${report.total} settled case(s) did not match the candidate's ruling`,
    );
  }
  const candidateHash = unwrap(judgeSeatHash(candidate));
  if (report.seatHash !== candidateHash) {
    throw new SeatingBlockedError(
      report,
      'the examined judge is not the one being seated (seat-hash mismatch): a passing bar exam ' +
        'authorizes exactly the (id, model, prompt) it was run against (spec 03 §6)',
    );
  }

  const manifest = unwrap(decodeManifest(parseYaml(currentManifestYaml)));
  if (seatedJudge(manifest, candidate.id) !== null) {
    throw new SeatingBlockedError(
      report,
      `a judge is already seated under id \`${candidate.id}\`; re-seating supersedes an existing ` +
        'judge and is a human-authored amendment',
    );
  }

  const doc = parseDocument(currentManifestYaml);
  const seatNode = doc.createNode({
    id: candidate.id,
    model: candidate.model,
    prompt: candidate.prompt,
  });
  const seq = doc.get('judges') as { flow?: boolean; add?: (n: unknown) => void } | undefined;
  if (seq !== undefined && seq !== null && typeof seq.add === 'function') {
    seq.flow = false;
    seq.add(seatNode);
  } else {
    doc.set('judges', doc.createNode([{ id: candidate.id, model: candidate.model, prompt: candidate.prompt }]));
  }
  const nextYaml = doc.toString();

  return {
    diff: unifiedDiff(MANIFEST_PATH, currentManifestYaml, nextYaml),
    rationale: renderSeatingRationale(candidate, report),
    seat: candidate,
    seatHash: candidateHash,
  };
}

function renderSeatingRationale(candidate: JudgeSeat, report: BarExamReport): string {
  return [
    `Seat judge \`${candidate.id}\` (model \`${candidate.model}\`, prompt \`${candidate.prompt}\`).`,
    '',
    `Bar exam: ${report.passed}/${report.total} settled cases matched; 0 mismatches. ` +
      'Any change to the model id or the prompt hash is a new judge that must re-sit before it ' +
      'may be seated (spec 03 §6).',
    `Seat hash: ${report.seatHash}`,
    '',
    'Seating is constitutional: this diff is applied only by a human-ratified PR (INV-001). ' +
      'The machine proposes; it does not write to `.program/`.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// A minimal, deterministic unified diff (prefix/suffix trim, single hunk + context)
// ---------------------------------------------------------------------------

/**
 * A single-hunk unified diff between two texts, with up to `context` shared lines on each side.
 * Enough to render a clean, `git apply`-able seating proposal; not a general Myers diff. Pure
 * and deterministic, which is what makes the same seating produce the same proposal.
 */
export function unifiedDiff(
  path: string,
  oldText: string,
  newText: string,
  context = 3,
): string {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  if (start === endA && start === endB) return ''; // identical

  const ctxStart = Math.max(0, start - context);
  const ctxEndA = Math.min(a.length, endA + context);

  const pre = a.slice(ctxStart, start); // shared before-context (identical in a and b)
  const post = a.slice(endA, ctxEndA); // shared after-context
  const oldMid = a.slice(start, endA);
  const newMid = b.slice(start, endB);

  const oldLen = pre.length + oldMid.length + post.length;
  const newLen = pre.length + newMid.length + post.length;
  const oldStartLine = ctxStart + 1;
  const newStartLine = ctxStart + 1; // shared prefix keeps the two hunks aligned at the same line

  const body = [
    ...pre.map((l) => ` ${l}`),
    ...oldMid.map((l) => `-${l}`),
    ...newMid.map((l) => `+${l}`),
    ...post.map((l) => ` ${l}`),
  ];

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStartLine},${oldLen} +${newStartLine},${newLen} @@`,
    ...body,
  ].join('\n');
}

/**
 * Structural YAML for the round-trip check. Kept tiny and local rather than pulling the `yaml`
 * stringifier's options in: `encodeManifest` already produces a plain object, and the
 * round-trip only needs bytes `decodeManifest` can read back, not pretty output.
 */
function rawStringify(value: unknown): string {
  return stringifyYaml(value);
}
