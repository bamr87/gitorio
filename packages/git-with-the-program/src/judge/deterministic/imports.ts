// Implements: docs/spec/03-judge.md §1 (the judgment ladder — the DETERMINISTIC rung, "every
// push", no model in the loop), §3 (evidence assembly: "the diff hunks intersecting the
// assertion's scope"), §4 (the output contract), docs/adr/0005-anchored-severity.md, and
// .program/invariants.yaml INV-005 ("Engine core imports no forge-specific APIs; GitHub access
// lives in adapters/", `enforcement: deterministic`) and INV-004 ("Violation verdicts carry
// line-span citations and anchored ordinal severity only"). Output conforms to
// schemas/verdict.schema.json via `Verdict`, which expresses that schema's allOf/if/then
// conditionals as union membership.
//
// SCOPE OF THIS FILE. SEED-03 is the judge harness; this is the ONE deterministic judge v0
// needs, landed early because ROADMAP.md's v0 exit test — "this repo runs it on itself; a
// staged INV-005 breach accumulates and files" — cannot run without a real verdict source.
// It is a slice of SEED-03, not SEED-03: there is no bench, no panel, no verdict cache and no
// bar exam here. `tests/exit-test-v0.test.ts` and `scripts/demo-v0.ts` are its callers.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). It sits under `src/judge/**`, so `scripts/check-inv003.ts` forbids
//  it from value-importing `core/{sentencing,accumulator,dispersion}`, and
//  `tests/ledger/blindness-boundary.test.ts` forbids it from REACHING them through any chain
//  of value imports.
//
//  THAT SECOND RULE IS WHY THIS FILE DEEP-IMPORTS src/core INSTEAD OF USING THE BARREL.
//  `src/core/index.ts` value-re-exports `accumulatorStep`/`decayFactor` from `./accumulator.js`
//  and `shannonEntropy` from `./dispersion.js`, and `accumulator.ts` in turn value-imports
//  `./sentencing.js` — so a single `import { ... } from '../../core/index.js'` would put
//  `src/core/sentencing.ts` inside this file's runtime closure and fail that test. Naming the
//  individual blind modules keeps the closure provably clean. Every specifier below leads only
//  to `brand`/`result`/`ids`/`paths`/`canonical`/`severity`/`change`/`verdict`, none of which
//  can reach the sentencing branch.
//
//  Note the one type-only import: `SealedEvidence` and `Judge` come from `../../core/evidence.js`
//  as ERASED types. A VALUE import of that module would reach `core/blindness.ts`, which
//  value-imports `SENTENCING_TAG` from `core/sentencing.ts` for `assertBlind`'s runtime walk —
//  harmless in substance (a detector symbol is not an identity) but caught by the same
//  transitive rule. The evidence ASSEMBLER (`src/evidence/**`, SEED-03) will have to CALL
//  `sealEvidence` and will meet this head-on; whether "blind" means by-value or by-reachability
//  is docs/spec/OPEN-QUESTIONS.md **Q-60**, and this file is written so nothing has to be
//  decided today.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// WHY THIS FILE HAS ITS OWN IMPORT READER, and why it must not be merged with the one in
// `scripts/check-inv003.ts`. The two answer different questions over different inputs:
//   check-inv003  — "does a blind FILE value-import a declassifier?" Reads whole source files,
//                   must FAIL CLOSED, and is a governance check on this repository.
//   this file     — "did this DIFF add an import of a forge API into an assertion's scope?"
//                   Reads unified-diff hunks (all a judge is shown, spec 03 §3), reports a
//                   citation per offending post-image line, and is engine code judging any
//                   repository. It never sees a whole file and cannot.
// A third reader appearing is the thing to notice. The regexes are deliberately the same shape
// so a reader of one recognises the other; the semantics are not interchangeable.

import { isNonEmpty, type NonEmptyReadonlyArray } from '../../core/brand.js';
import { scopedHunks, type Hunk } from '../../core/change.js';
// TYPE-ONLY, and load-bearing that it stays that way — see the header.
import type { AssertionView, Judge, SealedEvidence } from '../../core/evidence.js';
import type { JudgeRef } from '../../core/event.js';
import type { AccumulatorKey } from '../../core/ids.js';
import { parseJudgeId } from '../../core/ids.js';
import type { RepoPath } from '../../core/paths.js';
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

// ---------------------------------------------------------------------------
// Judge identity (spec 03 §6: changing the id is seating a new judge)
// ---------------------------------------------------------------------------

/**
 * A deterministic check has no model and no prompt, so its identity is the NAME OF THE
 * PROCEDURE. `JudgeRef.prompt` is deliberately absent: there is no prompt file to hash, and
 * inventing one would make `judgeHash` claim a provenance that does not exist.
 */
export const IMPORT_BOUNDARY_JUDGE_ID = 'import-boundary';

export const IMPORT_BOUNDARY_JUDGE: JudgeRef = {
  kind: 'deterministic',
  id: unwrap(parseJudgeId(IMPORT_BOUNDARY_JUDGE_ID)),
};

/**
 * A deterministic procedure either saw the offending line or it did not. `confidence: 1` is
 * the honest reading, and it is what makes this rung cheap enough to run on every push
 * (spec 03 §1).
 */
export const CERTAIN: Confidence = unwrap(parseConfidence(1));

/**
 * spec 01 §3 gives every assertion a `class`, and this procedure can only rule on ONE of them.
 * An assertion of another class handed to this judge gets an `abstain` — "honest insufficiency"
 * (spec 03 §4) — rather than a fabricated `aligned`, which would be a compliance the ledger
 * counts and ships as evidence quality (spec 02 §4). Out of jurisdiction is insufficiency, not
 * innocence. See docs/spec/OPEN-QUESTIONS.md Q-59.
 */
export const JUDGED_CLASS = 'dependency' as const;

// ---------------------------------------------------------------------------
// What counts as a forge
// ---------------------------------------------------------------------------

export type ForgeFamily = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'in-repo-adapter';

/**
 * `exact`            — the whole bare specifier (`octokit`).
 * `prefix`           — a package scope (`@octokit/`), matching every module under it.
 * `relative-segment` — a path segment of a RELATIVE specifier (`../adapters/github/issues.js`).
 *                      Never applied to a bare specifier, so a package literally named
 *                      `adapters` on npm is not swept up.
 */
export type ForgeMatch = 'exact' | 'prefix' | 'relative-segment';

export interface ForgeModulePattern {
  /** Stable id, quoted in the rationale so a reviewer can find the rule that fired. */
  readonly id: string;
  readonly family: ForgeFamily;
  readonly match: ForgeMatch;
  readonly value: string;
  /** Why this entry is here. Reviewed as law, not as code — keep it truthful. */
  readonly why: string;
}

/**
 * The whole of forge detection, in one exported const so it is reviewable as a LIST rather than
 * archaeology across a function body — the same shape `scripts/check-inv001.ts` gives
 * `MACHINE_ACTOR_PATTERNS`, and for the same reason: adding an entry widens what this engine
 * calls a forge dependency, and a reviewer should be able to read that off the diff.
 *
 * Deliberately conservative. Every entry is a whole specifier, a whole package scope, or a
 * whole path segment — never a bare substring, so `github-flavored-markdown` (a text renderer)
 * and `gitlab-ci-local` (a task runner) are NOT matched by the `github`/`gitlab` entries.
 *
 * STATED RECALL GAP, rather than papered over: this reads IMPORT SPECIFIERS only. A core module
 * that shells out to `gh` through `node:child_process`, or that hard-codes
 * `https://api.github.com` and reaches it with `fetch`, imports nothing forge-specific and is
 * invisible here. That is the deterministic rung being deterministic; INV-005 is
 * `enforcement: deterministic` today, and widening it to `hybrid` — so an LLM magistrate can
 * rule on the cases a specifier list cannot see — is a `.program/` amendment, not a code change.
 * See docs/spec/OPEN-QUESTIONS.md Q-58.
 */
export const FORGE_MODULE_PATTERNS: readonly ForgeModulePattern[] = [
  {
    id: 'octokit-scope',
    family: 'github',
    match: 'prefix',
    value: '@octokit/',
    why:
      "GitHub's own REST/GraphQL SDK (@octokit/rest, @octokit/graphql, @octokit/request-error). " +
      'The canonical way a forge API enters a Node codebase.',
  },
  {
    id: 'octokit',
    family: 'github',
    match: 'exact',
    value: 'octokit',
    why: 'The umbrella `octokit` package — the same SDK under its aggregate name.',
  },
  {
    id: 'actions-toolkit',
    family: 'github',
    match: 'prefix',
    value: '@actions/',
    why:
      'The GitHub Actions toolkit (@actions/core, @actions/github, @actions/exec). It is the ' +
      "runner's API, not a generic CI library: it reads GITHUB_* env and writes workflow " +
      'commands, so importing it pins the engine to one forge.',
  },
  {
    id: 'probot',
    family: 'github',
    match: 'exact',
    value: 'probot',
    why: 'A GitHub App framework; it exists only to be a GitHub App.',
  },
  {
    id: 'github-legacy-client',
    family: 'github',
    match: 'exact',
    value: 'github',
    why:
      'The legacy `github` npm client (Octokit\'s predecessor). Matched EXACTLY, so ' +
      '`github-slugger` and `github-flavored-markdown` — neither of which talks to a forge — ' +
      'are not swept up.',
  },
  {
    id: 'gitbeaker-scope',
    family: 'gitlab',
    match: 'prefix',
    value: '@gitbeaker/',
    why: "GitLab's most-used Node SDK. INV-005 says forge-specific, not GitHub-specific.",
  },
  {
    id: 'bitbucket',
    family: 'bitbucket',
    match: 'exact',
    value: 'bitbucket',
    why:
      'The Bitbucket Cloud REST client. Matched exactly rather than by prefix, so an unrelated ' +
      'package whose name merely begins with `bitbucket` is not swept up.',
  },
  {
    id: 'azure-devops-node-api',
    family: 'azure-devops',
    match: 'exact',
    value: 'azure-devops-node-api',
    why:
      "Azure DevOps' official Node client. Listed for the same reason as the GitLab and " +
      'Bitbucket entries: INV-005 says forge-specific, not GitHub-specific, and a check that ' +
      'only knew about GitHub would quietly license every other forge into the engine core.',
  },
  {
    id: 'adapters-directory',
    family: 'in-repo-adapter',
    match: 'relative-segment',
    value: 'adapters',
    why:
      "INV-005's SECOND clause: \"GitHub access lives in adapters/\". A relative import out of " +
      'the engine and into the adapter directory is a forge dependency by definition, whatever ' +
      'the adapter happens to be called — and it is the shape the breach usually takes in ' +
      'practice, because the SDK is already wrapped by then. src/core/delivery.ts states the ' +
      'rule from the other side: core declares the PORT, adapters supply the implementation, ' +
      'and the dependency arrow only ever points inward.',
  },
];

/** Drops a query/fragment and a source extension, and normalizes separators. */
export function normalizeImportSpecifier(spec: string): string {
  return spec
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/\.(m|c)?[jt]sx?$/, '');
}

/** The first pattern that fires, or `null`. Pure and total. */
export function forgeModuleOf(specifier: string): ForgeModulePattern | null {
  const s = normalizeImportSpecifier(specifier);
  if (s.length === 0) return null;
  const relative = s.startsWith('.') || s.startsWith('/');
  for (const p of FORGE_MODULE_PATTERNS) {
    if (p.match === 'relative-segment') {
      if (relative && s.split('/').includes(p.value)) return p;
      continue;
    }
    if (relative) continue;
    if (p.match === 'exact' && s === p.value) return p;
    if (p.match === 'prefix' && s.startsWith(p.value)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The severity ladder (ADR-0005: four anchors, never a bare float)
// ---------------------------------------------------------------------------

/**
 * `type-only`  — `import type { Octokit } from '@octokit/rest'`. Erased by
 *                `verbatimModuleSyntax`, so there is NO runtime dependency; what has crossed
 *                the boundary is the vocabulary. It **grazes**.
 * `dynamic`    — `await import('@octokit/rest')` / `require(...)`. A real runtime dependency,
 *                but a conditional one that only some code paths take, and one that a bare-repo
 *                degradation path can legitimately guard. It **bends**.
 * `value`      — a static value import. The module is now unconditionally required to load
 *                engine core: `import ... from` is a **breach**.
 * `re-export`  — `export { Octokit } from '@octokit/rest'`. Core's public surface now HANDS OUT
 *                the forge API, so every consumer of the barrel inherits the dependency and
 *                removing it becomes a breaking change to core's contract. It **entrenches**.
 *
 * This ladder is engine judgement, NOT spec text: ADR-0005 fixes the four anchors and their
 * numeric mapping and says nothing about which import form sits on which rung. Severity
 * multiplies precision in the fold, so this constant decides how many breaches it takes to fire
 * — which is why it is a named export rather than a branch, so it is arguable and so a
 * reprogramming proposal has something concrete to argue with.
 * See docs/spec/OPEN-QUESTIONS.md Q-58.
 */
export const IMPORT_FORM_SEVERITY = {
  'type-only': 'grazes',
  dynamic: 'bends',
  value: 'breach',
  're-export': 'entrenches',
} as const satisfies Record<ImportForm, SeverityOrdinal>;

export type ImportForm = 'type-only' | 'dynamic' | 'value' | 're-export';

// ---------------------------------------------------------------------------
// Reading a hunk's post-image
// ---------------------------------------------------------------------------

export interface PostImageLine {
  /** 1-based line number in the post-image, so a `Citation` is checkable against the hunk. */
  readonly n: number;
  /** `true` for a `+` line: content this diff introduced. */
  readonly added: boolean;
  readonly text: string;
}

/**
 * The post-image of one hunk: context and added lines, numbered from `newStart`; removed lines
 * consume no number. `\ No newline at end of file` is metadata, not content.
 *
 * Parsing the POST-IMAGE rather than the added lines alone is what lets a multi-line import
 * statement be read at all —
 *
 *     import {
 *       Octokit,
 *     } from '@octokit/rest';
 *
 * — where the specifier and the `import` keyword are three lines apart and only some of those
 * lines may be `+`.
 */
export function postImageLines(hunk: Hunk): readonly PostImageLine[] {
  const out: PostImageLine[] = [];
  if (hunk.text.length === 0) return out;
  let n = hunk.newStart;
  for (const raw of hunk.text.replace(/\n$/, '').split('\n')) {
    if (raw.startsWith('\\')) continue;
    const marker = raw.length === 0 ? ' ' : (raw[0] as string);
    if (marker === '-') continue;
    if (marker !== '+' && marker !== ' ') continue;
    out.push({ n, added: marker === '+', text: raw.length === 0 ? '' : raw.slice(1) });
    n += 1;
  }
  return out;
}

/** The same shape of reader as `scripts/check-inv003.ts` — see the module header on why both exist. */
const CLAUSE_OK = /^[\sA-Za-z_$0-9{},*]*$/;
const STATIC_RE = /(?:^|[\s;}])(import|export)([\s\S]*?)\sfrom\s*(['"])([^'"]*)\3/g;
const BARE_RE = /(?:^|[\s;}])import\s*(['"])([^'"]*)\1/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*(['"])([^'"]*)\1/g;

export interface ImportOffence {
  readonly path: RepoPath;
  /** 1-based post-image line carrying the specifier. */
  readonly line: number;
  readonly specifier: string;
  readonly form: ImportForm;
  readonly pattern: ForgeModulePattern;
  readonly severity: SeverityOrdinal;
  /** The offending line, trimmed, for the rationale. */
  readonly source: string;
}

interface Located {
  readonly specifier: string;
  readonly form: ImportForm;
  /** Character offset of the specifier within the joined post-image text. */
  readonly at: number;
}

function scanStatements(text: string): readonly Located[] {
  const found: Located[] = [];

  STATIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATIC_RE.exec(text)) !== null) {
    const clause = m[2] ?? '';
    if (!CLAUSE_OK.test(clause)) {
      // The lazy clause ran into a later statement. Rewind one character so the statement it
      // swallowed is still scanned: a skipped statement is a MISSED violation.
      STATIC_RE.lastIndex = m.index + 1;
      continue;
    }
    const specifier = m[4] ?? '';
    const typeOnly = /^\s*type[\s{*]/.test(clause);
    const form: ImportForm = typeOnly ? 'type-only' : m[1] === 'export' ? 're-export' : 'value';
    found.push({ specifier, form, at: m.index + m[0].lastIndexOf(specifier) });
  }

  BARE_RE.lastIndex = 0;
  while ((m = BARE_RE.exec(text)) !== null) {
    const specifier = m[2] ?? '';
    // `import 'x'` binds nothing but still loads the module: a value dependency.
    found.push({ specifier, form: 'value', at: m.index + m[0].lastIndexOf(specifier) });
  }

  DYNAMIC_RE.lastIndex = 0;
  while ((m = DYNAMIC_RE.exec(text)) !== null) {
    const specifier = m[2] ?? '';
    found.push({ specifier, form: 'dynamic', at: m.index + m[0].lastIndexOf(specifier) });
  }

  return found;
}

/**
 * Every forge import this diff INTRODUCED, one offence per specifier occurrence.
 *
 * Only offences whose specifier lands on an ADDED line are reported. A judge rules on the
 * change it was shown (spec 03 §3), and a forge import that was already there and merely rode
 * along as context is not something this diff did — it is the state of the repository, which is
 * what the obsolescence sweep and a full-tree run are for (spec 02 §7).
 *
 * Pure: no fs, no clock, no randomness. Same hunks, same offences, forever — which is what
 * makes the rationale (and therefore the ledger event's content hash) stable across runs.
 */
export function findForgeImports(hunks: readonly Hunk[]): readonly ImportOffence[] {
  const offences: ImportOffence[] = [];

  for (const hunk of hunks) {
    const lines = postImageLines(hunk);
    if (lines.length === 0) continue;

    // Joined post-image, plus the character offset each line starts at, so a match anywhere in
    // a multi-line statement maps back to the line that actually names the module.
    const starts: number[] = [];
    let cursor = 0;
    for (const l of lines) {
      starts.push(cursor);
      cursor += l.text.length + 1;
    }
    const text = lines.map((l) => l.text).join('\n');

    for (const hit of scanStatements(text)) {
      const pattern = forgeModuleOf(hit.specifier);
      if (pattern === null) continue;

      let index = 0;
      while (index + 1 < starts.length && (starts[index + 1] as number) <= hit.at) index += 1;
      const line = lines[index] as PostImageLine;
      if (!line.added) continue;

      offences.push({
        path: hunk.path,
        line: line.n,
        specifier: hit.specifier,
        form: hit.form,
        pattern,
        severity: IMPORT_FORM_SEVERITY[hit.form],
        source: line.text.trim(),
      });
    }
  }

  return offences.sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line,
  );
}

// ---------------------------------------------------------------------------
// The verdict (spec 03 §4, schemas/verdict.schema.json)
// ---------------------------------------------------------------------------

/**
 * A citation goes through the CONTRACT's own parser, never around it. Building a `Citation`
 * struct directly (the audit's imports.ts:449 probe) let a hunk with `newStart: 0` mint a
 * `path:0` citation — a string `parseCitation` rejects as not 1-based, i.e. a `drift` verdict that
 * satisfies "no citation, no verdict" only nominally (INV-004). `parseCitation` is the one gate;
 * an offence it rejects cannot ground a violation, and the caller abstains instead.
 */
function citationOf(path: RepoPath, line: number): Parsed<Citation> {
  return parseCitation(`${path}:${line}`);
}

/** Prose form for the rationale blob, where an unparseable line is still worth naming verbatim. */
function offenceLabel(path: RepoPath, line: number): string {
  return `${path}:${line}`;
}

function abstention(assertion: AccumulatorKey, rationale: string): AbstainVerdict {
  return { assertion, verdict: 'abstain', confidence: CERTAIN, rationale };
}

/**
 * "Aligned verdicts stay terse: verdict + confidence only" (spec 03 §4). The type has nowhere
 * to put anything else.
 */
function alignment(assertion: AccumulatorKey): AlignedVerdict {
  return { assertion, verdict: 'aligned', confidence: CERTAIN };
}

/**
 * Deterministic prose, and it has to be: this string is hashed into the ledger event's
 * `rationale` blob ref, which is part of the hashed event body, which is the event's id and its
 * idempotency key (spec 02 §1). A rationale that varied between runs would make the same
 * observation land at two content addresses and defeat the whole append-only design.
 */
export function renderImportRationale(
  view: AssertionView,
  offences: NonEmptyReadonlyArray<ImportOffence>,
  severity: SeverityOrdinal,
): string {
  const lines: string[] = [
    `${view.id} — ${view.statement}`,
    '',
    `This change introduces ${offences.length} forge-specific import(s) inside the assertion's ` +
      `scope (${view.scope.join(', ')}). Anchored severity \`${severity}\` is the worst rung ` +
      'among them (ADR-0005: four anchors, never a bare float).',
    '',
  ];
  for (const o of offences) {
    lines.push(
      `- ${offenceLabel(o.path, o.line)} — ${o.form} import of ` +
        `\`${o.specifier}\` (${o.pattern.family}, rule \`${o.pattern.id}\`) → \`${o.severity}\`` +
        `\n    ${o.source}\n    ${o.pattern.why}`,
    );
  }
  lines.push(
    '',
    'Remedy: declare a PORT in the engine and put the forge call behind it in `adapters/`. ' +
      '`src/core/delivery.ts` is the worked example — `DeliveryPort` has one method and no ' +
      'accessor through which a repository slug, an API token or an issue number could reach ' +
      'the engine, and both a REST adapter and a bare-repo file sink satisfy it.',
  );
  return lines.join('\n');
}

/**
 * THE JUDGE. `SealedEvidence` in, `Verdict` out — the one signature every rung of the ladder
 * implements (src/core/evidence.ts). Because `sealEvidence` is the only minter of the parameter
 * type, there is no second argument through which authorship or a running total could arrive;
 * because the return type is the `Verdict` union, an uncited violation or an off-anchor severity
 * is unconstructable rather than merely invalid (INV-004).
 *
 * Total. Four outcomes, and each says something different:
 *   abstain  — wrong assertion class, or nothing in scope: honest insufficiency (spec 03 §4),
 *              and the least-committal answer to OPEN-QUESTIONS Q-59. Never accumulates.
 *   aligned  — in-scope hunks, no forge import. Counted, subtracts nothing (spec 02 §4).
 *   drift    — a forge import was introduced.
 * `regression` is deliberately never emitted: it requires a `PRE-id` (spec 03 §7) and case law
 * is not something a specifier list can read.
 */
export function judgeImportBoundary(sealed: SealedEvidence): Verdict {
  const view = sealed.bundle.assertion;
  const key: AccumulatorKey = view.id;

  if (view.class !== JUDGED_CLASS) {
    return abstention(
      key,
      `the import-boundary check rules on \`class: ${JUDGED_CLASS}\` assertions; ` +
        `${view.id} is \`class: ${view.class}\`. Escalate rather than assume compliance ` +
        '(spec 03 §4).',
    );
  }

  const hunks = scopedHunks(view.scope, sealed.bundle.hunks);
  if (hunks.length === 0) {
    return abstention(
      key,
      `no hunk in this change intersects ${view.id}'s scope (${view.scope.join(', ')}), so ` +
        'there is nothing to rule on. An `aligned` here would be a compliance the ledger ' +
        'counts and ships as evidence quality (spec 02 §4) on the strength of having looked ' +
        'at nothing (docs/spec/OPEN-QUESTIONS.md Q-59).',
    );
  }

  const offences = findForgeImports(hunks);
  if (!isNonEmpty(offences)) return alignment(key);

  // One citation per offending line, deduplicated and ordered — "no citation, no verdict"
  // (ADR-0005, INV-004). Each is minted through `parseCitation`, so an offence on a malformed
  // hunk (a line the contract cannot express as a 1-based span) simply produces no citation.
  const seen = new Set<string>();
  const evidence: Citation[] = [];
  const citable: ImportOffence[] = [];
  for (const o of offences) {
    const c = citationOf(o.path, o.line);
    if (!c.ok) continue; // uncitable: it cannot ground a violation (INV-004)
    if (seen.has(c.value.source)) {
      citable.push(o);
      continue;
    }
    seen.add(c.value.source);
    evidence.push(c.value);
    citable.push(o);
  }

  // Offences existed but none could be cited: the honest ruling is abstain — "no citation, no
  // verdict" means the absence of a citable span is insufficiency, never a silent pass and never
  // a fabricated `path:0` (spec 03 §4, INV-004).
  if (!isNonEmpty(evidence) || !isNonEmpty(citable)) {
    return abstention(
      key,
      `a forge-specific import was found in ${view.id}'s scope, but on a hunk whose line ` +
        'numbering the citation contract cannot express (a 1-based span). A violation without a ' +
        'citable span is honest insufficiency, not a pass (INV-004, spec 03 §4).',
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
    rationale: renderImportRationale(view, citable, severity),
    confidence: CERTAIN,
  };
  return drift;
}

/** The `Judge` shape, so this rung is substitutable for the model rung SEED-03 seats. */
export const importBoundaryJudge: Judge = judgeImportBoundary;
