// Implements: docs/spec/03-judge.md §1 (the judgment ladder — the DETERMINISTIC rung, "every
// push", zero variance), §3 (evidence assembly: "the diff hunks intersecting the assertion's
// scope"), §4 (the output contract), docs/adr/0005-anchored-severity.md, and the
// `class: convention` shape of .program/invariants.yaml INV-006 ("All program and ledger
// artifacts validate against schemas/ in CI", scope `.program/** schemas/**`,
// `enforcement: deterministic`). Output conforms to schemas/verdict.schema.json via `Verdict`,
// which expresses that schema's allOf/if/then conditionals as union membership, so an uncited
// violation or an off-anchor severity is unconstructable rather than merely invalid (INV-004).
//
// SCOPE OF THIS FILE. The schema-conformance magistrate is ONE narrow judge on the bench (spec
// 03 §1). It rules the deterministic, zero-variance slice of INV-006: given a diff that CREATES
// a schema-governed artifact, is the new artifact well-formed and structurally valid against its
// schema? A malformed artifact cannot validate against ANY schema, so catching malformation is a
// sound (if incomplete) deterministic check. This is NOT a re-implementation of `gwtp validate`
// — that command runs ajv over the whole tree in CI and is INV-006's authoritative enforcement
// (src/cli/commands/validate.ts). This judge is the LADDER RUNG that returns a Verdict on a diff,
// using the engine's own hand-written decoders (which mirror the schemas) rather than ajv, so it
// carries no schema files and stays pure.
//
// STATED RECALL GAP, rather than papered over (cf. src/judge/deterministic/imports.ts): a judge
// sees hunks, not whole files (spec 03 §3), and a partial edit to an existing artifact cannot be
// validated from a slice without inventing the rest. This rung therefore rules DECISIVELY only on
// artifacts it can see in full — newly CREATED files, whose post-image is the entire artifact —
// and `abstain`s on partial edits, handing them up the ladder (to a wider context ring, then to
// `gwtp validate` over the full tree). Deep conformance of an EDITED artifact is out of this
// rung's honest reach; that is what makes it deterministic. See docs/spec/OPEN-QUESTIONS.md Q-59.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). Under `src/judge/**`: every value import below leads only to
//  sentencing-clean core (`brand`/`result`/`ids`/`paths`/`change`/`severity`/`verdict`/
//  `assertion`/`precedent`), to imports.ts (a sibling blind module with a provably clean
//  closure), or to the external `yaml` package (which reaches no `src/core` module at all).
//  `SealedEvidence`, `Judge`, `AssertionView` and `JudgeRef` are ERASED type-only imports — a
//  value import of evidence.ts would reach `core/blindness.ts` → `SENTENCING_TAG` and fail the
//  reachability rule (docs/spec/OPEN-QUESTIONS.md Q-60). `scripts/check-inv003.ts` and
//  `tests/ledger/blindness-boundary.test.ts` both stay green: the decoders are contract code,
//  not declassifiers, and none of them names the sentencing branch.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { parse as parseYaml } from 'yaml';

import { decodeInvariantsFile } from '../../core/assertion.js';
import { isNonEmpty, type NonEmptyReadonlyArray } from '../../core/brand.js';
import { scopedHunks, type Hunk } from '../../core/change.js';
// TYPE-ONLY, and load-bearing that it stays that way — see the header.
import type { AssertionView, Judge, SealedEvidence } from '../../core/evidence.js';
import type { JudgeRef } from '../../core/event.js';
import type { AccumulatorKey } from '../../core/ids.js';
import { parseJudgeId } from '../../core/ids.js';
import { type PathGlob, type RepoPath, matchesScope, parsePathGlob } from '../../core/paths.js';
import { decodePrecedentsFile } from '../../core/precedent.js';
import { type ContractError, type Decoded, type Parsed, unwrap } from '../../core/result.js';
import type { SeverityOrdinal } from '../../core/severity.js';
import { parseCitation, parseConfidence } from '../../core/verdict.js';
import type {
  AbstainVerdict,
  AlignedVerdict,
  Citation,
  Confidence,
  DriftVerdict,
  Verdict,
} from '../../core/verdict.js';
import { postImageLines, type PostImageLine } from './imports.js';

// ---------------------------------------------------------------------------
// Judge identity (spec 03 §6: changing the id is seating a new judge)
// ---------------------------------------------------------------------------

/**
 * A deterministic check has no model and no prompt, so its identity is the NAME OF THE
 * PROCEDURE. `JudgeRef.prompt` is deliberately absent (see imports.ts / path_boundary.ts).
 */
export const SCHEMA_CONFORMANCE_JUDGE_ID = 'schema-conformance';

export const SCHEMA_CONFORMANCE_JUDGE: JudgeRef = {
  kind: 'deterministic',
  id: unwrap(parseJudgeId(SCHEMA_CONFORMANCE_JUDGE_ID)),
};

/** A deterministic decoder either accepted the artifact or it did not (spec 03 §1). */
const CERTAIN: Confidence = unwrap(parseConfidence(1));

/**
 * The one class this procedure rules on. Another class handed here gets `abstain` — out of
 * jurisdiction is insufficiency, not innocence (spec 03 §4, OPEN-QUESTIONS Q-59).
 */
const JUDGED_CLASS = 'convention' as const;

/**
 * A malformed or schema-invalid artifact plainly fails "validates against its schema": a
 * **breach**. This rung emits a single anchor rather than pretending to grade well-formedness on
 * a four-rung scale a decoder cannot honestly distinguish (a document either parses or it does
 * not); grazes/bends/entrenches are left to the LLM rung. ADR-0005 fixes the anchors and their
 * numerics and says nothing about which failure sits on which rung, so this is engine judgement,
 * named as a const so a reprogramming proposal has something concrete to argue with (Q-58).
 */
export const MALFORMATION_SEVERITY: SeverityOrdinal = 'breach';

// ---------------------------------------------------------------------------
// What counts as a schema-governed artifact
// ---------------------------------------------------------------------------

/** A structural decoder mirroring a `schemas/*.schema.json` contract (Q-29: hand-written, not ajv). */
export type ArtifactDecoder = (raw: unknown, at?: string) => Decoded<unknown>;

/**
 * A stable id, the glob it governs, the schema it must satisfy, and the engine decoder that
 * mirrors that schema. Reviewed as LAW, not as code — the same shape imports.ts gives
 * `FORGE_MODULE_PATTERNS`: adding an entry widens what this rung claims to validate, and a
 * reviewer should read that off the diff.
 *
 * `decode` may be `null` for a governed artifact with NO schema decoder (spec 01 §2 lists five
 * such files — docs/spec/OPEN-QUESTIONS.md Q-08); those are checked for well-formedness only.
 * Only the two artifacts with a real `schemas/*.schema.json` and a real decoder are listed today
 * (assertion, precedent), keeping this rung's claims exactly as wide as the contracts that exist.
 */
export interface GovernedArtifact {
  readonly id: string;
  readonly glob: PathGlob;
  /** The `$id` of the schema this artifact must satisfy, quoted in the rationale. */
  readonly schema: string;
  readonly decode: ArtifactDecoder | null;
  readonly why: string;
}

const g = (raw: string): PathGlob => unwrap(parsePathGlob(raw));

/**
 * The program artifacts this deterministic rung knows how to validate, each bound to the
 * contract it must satisfy. Only the four real `schemas/*.schema.json` back a decoder
 * (src/core/index.ts → `SCHEMA_ID`); of those, `assertion` and `precedent` name whole-file
 * program artifacts a worktree diff can create (`verdict` is pre-ledger, `event` is a ledger
 * blob addressed by hash under a ref, not a worktree file). Listing only what has a schema AND a
 * decoder keeps the rung from claiming to enforce a contract that does not exist (cf. the
 * `SCHEMA_ID` "exactly the four real contracts and no more" discipline, OPEN-QUESTIONS Q-08).
 */
export const SCHEMA_GOVERNED_ARTIFACTS: readonly GovernedArtifact[] = [
  {
    id: 'invariants',
    glob: g('.program/invariants.yaml'),
    schema: 'gwtp/assertion.schema.json',
    decode: decodeInvariantsFile,
    why:
      '`.program/invariants.yaml` is a bare sequence of assertions (spec 01 §2-§3); each entry ' +
      'must satisfy schemas/assertion.schema.json. INV-006 makes its validation a CI gate.',
  },
  {
    id: 'precedents',
    glob: g('.program/precedents.yaml'),
    schema: 'gwtp/precedent.schema.json',
    decode: decodePrecedentsFile,
    why:
      '`.program/precedents.yaml` is the case law (spec 03 §6-§7); each entry must satisfy ' +
      'schemas/precedent.schema.json, and it doubles as the judges\' bar-exam corpus.',
  },
];

/** The first governed artifact whose glob matches, or `null`. Pure and total. */
export function governedArtifactOf(path: RepoPath): GovernedArtifact | null {
  for (const a of SCHEMA_GOVERNED_ARTIFACTS) {
    if (matchesScope([a.glob], path)) return a;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading a whole new artifact out of a hunk
// ---------------------------------------------------------------------------

/**
 * `true` for `@@ -0,0 +1,N @@`: an empty pre-image, i.e. a newly created file whose post-image is
 * the WHOLE artifact. This is the only hunk shape whose reconstruction can be validated against a
 * schema without inventing the parts a slice does not show (see the module header). `oldStart ===
 * 0` distinguishes creation from a pure insertion into an existing file (`@@ -5,0 +6,N @@`).
 */
export function isCompleteArtifactHunk(hunk: Hunk): boolean {
  return hunk.oldStart === 0 && hunk.oldLines === 0;
}

interface PostImage {
  readonly text: string;
  readonly lines: readonly PostImageLine[];
}

/** The full post-image of a hunk (context + added), joined, with per-line file numbers retained. */
function postImage(hunk: Hunk): PostImage {
  const lines = postImageLines(hunk);
  return { text: lines.map((l) => l.text).join('\n'), lines };
}

export type MalformationKind = 'unparseable-yaml' | 'schema-invalid';

export interface MalformationOffence {
  readonly path: RepoPath;
  readonly artifact: GovernedArtifact;
  readonly kind: MalformationKind;
  /** 1-based post-image line to cite. Best-effort: the failing line for YAML, else the file head. */
  readonly line: number;
  /** A stable, human-readable summary of what the schema/parse rejected. */
  readonly detail: string;
  readonly severity: SeverityOrdinal;
}

/** yaml@2's parse error carries `linePos: [{ line, col }]`, 1-based within the parsed text. */
function yamlErrorLine(error: unknown): number | null {
  const lp = (error as { linePos?: readonly { readonly line: number }[] }).linePos;
  const first = lp?.[0]?.line;
  return typeof first === 'number' && Number.isFinite(first) ? first : null;
}

function firstErrorDetail(errors: readonly ContractError[]): string {
  const head = errors[0];
  if (head === undefined) return 'the engine decoder rejected the artifact';
  const at = head.at === undefined || head.at.length === 0 ? '' : ` at ${head.at}`;
  const clause = head.clause === undefined ? '' : ` (${head.clause})`;
  return `${head.code}${at}: ${head.message}${clause}`;
}

/**
 * Validate ONE complete new artifact hunk. Returns an offence, or `null` when the artifact is
 * well-formed and structurally valid. Two layers, both deterministic:
 *   1. WELL-FORMEDNESS — the post-image must parse as YAML. A syntax error cannot validate
 *      against any schema; it is `unparseable-yaml`. `yaml.parse` executes nothing — YAML is
 *      data, not code — so parsing untrusted hunk text is pure.
 *   2. STRUCTURE — if a decoder is bound and the document parsed, run it. A decode failure is
 *      `schema-invalid` (the hand-written mirror of schemas/*.schema.json; Q-29). A null or
 *      empty document validates vacuously and skips the decoder (an empty artifact file is legal
 *      — src/core/assertion.ts `decodeInvariantsFile` returns `ok([])`).
 */
export function validateArtifactHunk(hunk: Hunk, artifact: GovernedArtifact): MalformationOffence | null {
  const { text, lines } = postImage(hunk);
  const head = lines[0]?.n ?? hunk.newStart;
  const fileLineOf = (parsedLine: number | null): number =>
    parsedLine === null ? head : (lines[parsedLine - 1]?.n ?? head);

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    return {
      path: hunk.path,
      artifact,
      kind: 'unparseable-yaml',
      line: fileLineOf(yamlErrorLine(e)),
      detail: `not well-formed YAML: ${(e as Error).message.split('\n')[0] ?? 'parse error'}`,
      severity: MALFORMATION_SEVERITY,
    };
  }

  if (parsed === null || parsed === undefined) return null; // an empty artifact validates vacuously
  if (artifact.decode === null) return null; // well-formed, and no schema decoder to apply (Q-08)

  const decoded = artifact.decode(parsed);
  if (decoded.ok) return null;

  return {
    path: hunk.path,
    artifact,
    kind: 'schema-invalid',
    // No line-to-JSON-pointer map exists, so the citation names the artifact at its head — "a
    // citation to the file" (SEED-03 deliverable 1). The `detail` carries the precise JSON pointer.
    line: head,
    detail: `fails ${artifact.schema} — ${firstErrorDetail(decoded.error)}`,
    severity: MALFORMATION_SEVERITY,
  };
}

/**
 * Every malformed new artifact this diff INTRODUCED, one offence per offending artifact. Pure: no
 * fs, no clock, no randomness — same hunks, same offences, so the rationale (and the ledger event
 * hash it feeds) is stable across runs.
 */
export function findSchemaOffences(hunks: readonly Hunk[]): readonly MalformationOffence[] {
  const offences: MalformationOffence[] = [];
  for (const hunk of hunks) {
    if (!isCompleteArtifactHunk(hunk)) continue;
    const artifact = governedArtifactOf(hunk.path);
    if (artifact === null) continue;
    const offence = validateArtifactHunk(hunk, artifact);
    if (offence !== null) offences.push(offence);
  }
  return offences.sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line,
  );
}

// ---------------------------------------------------------------------------
// The verdict (spec 03 §4, schemas/verdict.schema.json)
// ---------------------------------------------------------------------------

/** A citation goes through the CONTRACT's own parser, never around it (INV-004; cf. imports.ts). */
function citationOf(path: RepoPath, line: number): Parsed<Citation> {
  return parseCitation(`${path}:${line}`);
}

function abstention(assertion: AccumulatorKey, rationale: string): AbstainVerdict {
  return { assertion, verdict: 'abstain', confidence: CERTAIN, rationale };
}

/** "Aligned verdicts stay terse: verdict + confidence only" (spec 03 §4). */
function alignment(assertion: AccumulatorKey): AlignedVerdict {
  return { assertion, verdict: 'aligned', confidence: CERTAIN };
}

/**
 * Deterministic prose (hashed into the event body — see imports.ts / path_boundary.ts on why it
 * must be stable).
 */
export function renderSchemaRationale(
  view: AssertionView,
  offences: NonEmptyReadonlyArray<MalformationOffence>,
): string {
  const lines: string[] = [
    `${view.id} — ${view.statement}`,
    '',
    `This change introduces ${offences.length} schema-governed artifact(s) that do not validate ` +
      `against their schema. Anchored severity \`${MALFORMATION_SEVERITY}\` (ADR-0005: four ` +
      'anchors, never a bare float).',
    '',
  ];
  for (const o of offences) {
    lines.push(
      `- ${o.path}:${o.line} — new \`${o.artifact.id}\` artifact, ${o.kind} → ` +
        `\`${o.severity}\`\n    ${o.detail}\n    ${o.artifact.why}`,
    );
  }
  lines.push(
    '',
    'Remedy: make the new artifact conform to its schema before it lands. `gwtp validate` runs ' +
      'the authoritative ajv pass over the whole tree in CI (INV-006); this rung caught it early, ' +
      'on the diff, at the cheapest point on the ladder (spec 03 §1).',
  );
  return lines.join('\n');
}

/**
 * THE JUDGE. `SealedEvidence` in, `Verdict` out — the one signature every rung implements
 * (src/core/evidence.ts), drop-in substitutable for the model rung. `sealEvidence` is the only
 * minter of the parameter, so authorship and the accumulator cannot arrive (INV-003); the return
 * `Verdict` union makes an uncited violation unconstructable (INV-004).
 *
 * Total. Four outcomes:
 *   abstain  — wrong class; nothing in scope; or nothing in scope is a COMPLETE schema-governed
 *              artifact this rung can validate (a partial edit, or an ungoverned file). Honest
 *              insufficiency, escalated up the ladder (spec 03 §4, OPEN-QUESTIONS Q-59).
 *   aligned  — every complete governed artifact this change creates is well-formed and valid.
 *   drift    — a new governed artifact does not validate against its schema, and it could be cited.
 * `regression`/`stale-claim` are never emitted here — the first needs case law (spec 03 §7), the
 * second is the obsolescence sweep's (spec 02 §7).
 */
export function judgeSchemaConformance(sealed: SealedEvidence): Verdict {
  const view = sealed.bundle.assertion;
  const key: AccumulatorKey = view.id;

  if (view.class !== JUDGED_CLASS) {
    return abstention(
      key,
      `the schema-conformance check rules on \`class: ${JUDGED_CLASS}\` assertions; ` +
        `${view.id} is \`class: ${view.class}\`. Escalate rather than assume compliance ` +
        '(spec 03 §4).',
    );
  }

  const hunks = scopedHunks(view.scope, sealed.bundle.hunks);
  if (hunks.length === 0) {
    return abstention(
      key,
      `no hunk in this change intersects ${view.id}'s scope (${view.scope.join(', ')}), so there ` +
        'is nothing to rule on (docs/spec/OPEN-QUESTIONS.md Q-59).',
    );
  }

  // The only hunks this rung can rule on DECISIVELY: complete, newly-created, schema-governed
  // artifacts, whose post-image is the whole file (module header). Everything else — a partial
  // edit to an artifact, or an in-scope file this rung does not govern — cannot be validated from
  // a slice and is handed up the ladder rather than passed on the strength of an unread whole.
  const checkable = hunks.filter(
    (h) => isCompleteArtifactHunk(h) && governedArtifactOf(h.path) !== null,
  );
  if (checkable.length === 0) {
    return abstention(
      key,
      `this change touches ${view.id}'s scope but introduces no COMPLETE schema-governed artifact ` +
        'this deterministic rung can validate against a schema — a partial edit needs the whole ' +
        'file, which `gwtp validate` (the authoritative ajv pass, INV-006) and a wider context ' +
        'ring supply. Honest insufficiency, not a pass (spec 03 §4, OPEN-QUESTIONS Q-59).',
    );
  }

  const offences = findSchemaOffences(checkable);
  // Complete governed artifacts were created, and every one of them validates: honest compliance.
  if (!isNonEmpty(offences)) return alignment(key);

  // One citation per malformed artifact — "no citation, no verdict" (ADR-0005, INV-004), minted
  // through `parseCitation` so a malformed hunk (a line the contract cannot express) grounds no
  // violation.
  const seen = new Set<string>();
  const evidence: Citation[] = [];
  const citable: MalformationOffence[] = [];
  for (const o of offences) {
    const c = citationOf(o.path, o.line);
    if (!c.ok) continue; // uncitable: cannot ground a violation (INV-004)
    if (!seen.has(c.value.source)) {
      seen.add(c.value.source);
      evidence.push(c.value);
    }
    citable.push(o);
  }

  // Malformations existed but none could be cited: abstain, never a fabricated `path:0`.
  if (!isNonEmpty(evidence) || !isNonEmpty(citable)) {
    return abstention(
      key,
      `a new artifact in ${view.id}'s scope fails its schema, but on a hunk whose line numbering ` +
        'the citation contract cannot express (a 1-based span). A violation without a citable span ' +
        'is honest insufficiency, not a pass (INV-004, spec 03 §4).',
    );
  }

  const drift: DriftVerdict = {
    assertion: key,
    verdict: 'drift',
    severity: MALFORMATION_SEVERITY,
    evidence,
    rationale: renderSchemaRationale(view, citable),
    confidence: CERTAIN,
  };
  return drift;
}

/** The `Judge` shape, so this rung is substitutable for the model rung SEED-03 seats. */
export const schemaConformanceJudge: Judge = judgeSchemaConformance;
