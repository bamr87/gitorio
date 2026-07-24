// Implements: docs/spec/03-judge.md §1 (the judgment ladder — made RUNNABLE by SEED-03), §3
// (evidence assembly: the assertion + the scope-intersected hunks of a diff), §4 (the output
// contract) and §6 (the bar exam). The thin CLI shell over src/evidence (the assembler) and
// src/judge (the bench): this file parses flags, reads files, assembles the sealed bundle, runs
// the DETERMINISTIC rung, and renders. Every judgment is computed in src/judge; every seal is
// minted by src/core's sealEvidence().
//
// TWO FORMS:
//   gwtp judge <assertion-id> --diff <file|-> [--repo <dir>]
//       Assemble evidence for ONE assertion (spec 03 §1: one assertion, one diff, one invocation)
//       against a unified diff, then run the deterministic judge whose jurisdiction is the
//       assertion's class. A class with no deterministic judge (behavior, interface) ABSTAINS with
//       a note that an LLM invariant judge must be seated first — spec 03 §6 gates seating on a
//       ratified PR + a passing bar exam, and .program/manifest.yaml seats none by default.
//   gwtp judge bar-exam [--repo <dir>]
//       Read the settled case law in .program/precedents.yaml — "precedents moonlight as the bar
//       exam" (spec 03 §6) — and report. An EMPTY corpus is not a crash: the exam vacuously passes
//       (no settled ruling to contradict), while seating still requires a non-empty corpus.
//
// OFFLINE BY DEFAULT (task constraint / INV-005). No command path here makes a live model call.
// The LLM invariant judge (src/judge/model) and the Anthropic adapter (src/adapters/anthropic)
// are the plumbing for it, but seating a model judge is a ratified-PR act (spec 03 §6): this CLI
// never invokes one. `--repo` is a directory; nothing here names a forge or a provider SDK.
//
// READ-ONLY (INV-001/INV-002): this command reads `.program/` and a diff and writes nothing. A
// verdict is data printed to stdout; recording it as a ledger event is `gwtp ledger append`.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parse as parseYaml } from 'yaml';

import {
  type AbstainVerdict,
  type Assertion,
  type AssertionClass,
  type AssertionView,
  type ChangeRef,
  type ChangeSource,
  type ContractError,
  type Hunk,
  type JudgeRef,
  type Judge,
  type Precedent,
  type RepoPath,
  type Verdict,
  assertionView,
  committerTimeFromEpochMillis,
  decodeInvariantsFile,
  decodeManifest,
  decodePrecedentsFile,
  encodeVerdict,
  isViolation,
  parseCommitSha,
  parseRepoPath,
  sealEvidence,
  unwrap,
} from '../../core/index.js';
import { assembleEvidence, type AssembleRequest } from '../../evidence/index.js';
import {
  IMPORT_BOUNDARY_JUDGE,
  PATH_BOUNDARY_JUDGE,
  SCHEMA_CONFORMANCE_JUDGE,
  importBoundaryJudge,
  pathBoundaryJudge,
  schemaConformanceJudge,
} from '../../judge/index.js';

// ---------------------------------------------------------------------------
// Output helpers (the same shape gwtp validate / gwtp ledger print)
// ---------------------------------------------------------------------------

function out(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function errOut(text: string): void {
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function displayPath(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? file : rel;
}

function formatContractError(e: ContractError): string {
  return `${e.code}${e.at === undefined || e.at === '' ? '' : ` at ${e.at}`}: ${e.message}`;
}

// ---------------------------------------------------------------------------
// The bench: which deterministic judge sits for which assertion class
// ---------------------------------------------------------------------------

interface DeterministicSeat {
  readonly ref: JudgeRef;
  readonly judge: Judge;
}

/**
 * spec 03 §1: one narrow magistrate per assertion class expressible as a rule. Keyed by the
 * CORE vocabulary `AssertionClass`, so the routing follows the assertion's own `class` field.
 * The three deterministic judges each rule ONE class (and `abstain` if handed another — "out of
 * jurisdiction is insufficiency", spec 03 §4); this map picks the one whose jurisdiction matches:
 *   boundary   → path-boundary   (INV-001-style protected-subtree writes)
 *   dependency → import-boundary  (INV-005-style forge imports in engine core)
 *   convention → schema-conformance (INV-006-style artifact validation)
 * `behavior` and `interface` have no deterministic rung — they need the LLM invariant judge, which
 * must be seated first (spec 03 §6). Those abstain with a note rather than a fabricated ruling.
 */
const DETERMINISTIC_BY_CLASS: Partial<Record<AssertionClass, DeterministicSeat>> = {
  boundary: { ref: PATH_BOUNDARY_JUDGE, judge: pathBoundaryJudge },
  dependency: { ref: IMPORT_BOUNDARY_JUDGE, judge: importBoundaryJudge },
  convention: { ref: SCHEMA_CONFORMANCE_JUDGE, judge: schemaConformanceJudge },
};

// ---------------------------------------------------------------------------
// A minimal unified-diff reader (this CLI's inbound edge)
// ---------------------------------------------------------------------------

/**
 * `git diff` / `git show` output → `Hunk[]`. The judges consume already-parsed hunks (spec 03 §3),
 * so turning a supplied diff into hunks is the CLI's job; the assembler re-scopes and seals them.
 * A hunk's `text` is the body only — `+`/`-`/` `/`\` lines WITH their markers, no `@@` header —
 * exactly what `src/core/change.ts` Hunk and `postImageLines` expect. A `/dev/null` target (a
 * deletion) yields no post-image path and is dropped: there is nothing citable to rule on.
 */
export function parseUnifiedDiff(diff: string): readonly Hunk[] {
  const hunks: Hunk[] = [];
  let path: RepoPath | null = null;
  let open:
    | { oldStart: number; oldLines: number; newStart: number; newLines: number; body: string[] }
    | null = null;

  const flush = (): void => {
    if (open === null) return;
    if (path !== null) {
      hunks.push({
        path,
        oldStart: open.oldStart,
        oldLines: open.oldLines,
        newStart: open.newStart,
        newLines: open.newLines,
        text: open.body.join('\n'),
      });
    }
    open = null;
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      path = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      flush();
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        path = null;
        continue;
      }
      const parsed = parseRepoPath(target.replace(/^b\//, ''));
      path = parsed.ok ? parsed.value : null;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header !== null) {
      flush();
      open = {
        oldStart: Number.parseInt(header[1] as string, 10),
        oldLines: header[2] === undefined ? 1 : Number.parseInt(header[2], 10),
        newStart: Number.parseInt(header[3] as string, 10),
        newLines: header[4] === undefined ? 1 : Number.parseInt(header[4], 10),
        body: [],
      };
      continue;
    }
    if (open === null) continue;
    if (
      line === '' ||
      line.startsWith(' ') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith('\\')
    ) {
      open.body.push(line);
    }
  }
  flush();
  return hunks;
}

// ---------------------------------------------------------------------------
// Reading the program store
// ---------------------------------------------------------------------------

interface ProgramFiles {
  readonly assertions: readonly Assertion[];
  readonly charter: string;
}

type LoadResult =
  | { readonly ok: true; readonly value: ProgramFiles }
  | { readonly ok: false; readonly code: number; readonly message: string };

function loadProgram(repo: string): LoadResult {
  const programDir = join(repo, '.program');
  if (!existsSync(programDir) || !statSync(programDir).isDirectory()) {
    return {
      ok: false,
      code: 2,
      message: `no .program/ under ${displayPath(repo)} — pass --repo <dir> pointing at a program store`,
    };
  }
  const invariantsPath = join(programDir, 'invariants.yaml');
  if (!existsSync(invariantsPath)) {
    return { ok: false, code: 2, message: `no ${displayPath(invariantsPath)} — nothing to judge against` };
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(invariantsPath, 'utf8'));
  } catch (e) {
    return { ok: false, code: 1, message: `${displayPath(invariantsPath)} is not valid YAML: ${(e as Error).message}` };
  }
  const decoded = decodeInvariantsFile(raw, '');
  if (!decoded.ok) {
    return {
      ok: false,
      code: 1,
      message:
        `${displayPath(invariantsPath)} did not decode:\n` +
        decoded.error.map((e) => `  ${formatContractError(e)}`).join('\n'),
    };
  }
  const charterPath = join(programDir, 'charter.md');
  const charter = existsSync(charterPath) ? readFileSync(charterPath, 'utf8') : '';
  return { ok: true, value: { assertions: decoded.value, charter } };
}

/** The diff bytes, from a file or stdin (`-`). */
function readDiff(source: string): { ok: true; text: string } | { ok: false; code: number; message: string } {
  if (source === '-') {
    if (process.stdin.isTTY === true) {
      return { ok: false, code: 2, message: 'no diff on stdin — pipe a unified diff, or pass --diff <file>' };
    }
    try {
      return { ok: true, text: readFileSync(0, 'utf8') };
    } catch (e) {
      return { ok: false, code: 1, message: `cannot read stdin: ${(e as Error).message}` };
    }
  }
  const file = resolve(source);
  if (!existsSync(file)) {
    return { ok: false, code: 2, message: `--diff ${displayPath(file)} does not exist` };
  }
  try {
    return { ok: true, text: readFileSync(file, 'utf8') };
  } catch (e) {
    return { ok: false, code: 1, message: `cannot read ${displayPath(file)}: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// A placeholder ChangeRef (the sealed bundle carries none of it)
// ---------------------------------------------------------------------------

/**
 * `assembleEvidence` hands the `ChangeRef` to the `ChangeSource`; the sealed bundle itself carries
 * only {assertion, charter excerpt, hunks, ring, precedent} (src/core/evidence.ts), never a commit
 * or a committer time. The CLI judges a SUPPLIED diff rather than a git commit, so there is no real
 * ref — this placeholder satisfies the type and is invisible to the verdict and to `hunkHash`.
 */
const PLACEHOLDER_REF: ChangeRef = {
  commit: unwrap(parseCommitSha('0'.repeat(40))),
  committerTime: unwrap(committerTimeFromEpochMillis(0)),
};

// ---------------------------------------------------------------------------
// gwtp judge <assertion-id> --diff <file|->
// ---------------------------------------------------------------------------

const ASSERTION_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  diff: { type: 'string' },
  repo: { type: 'string' },
  json: { type: 'boolean' },
} as const;

function assertionUsage(): string {
  return [
    'gwtp judge <assertion-id> — run the judgment ladder against a diff (spec 03 §1, §3)',
    '',
    'Usage:',
    '  gwtp judge <assertion-id> --diff <file>    judge a unified diff against one assertion',
    '  git diff | gwtp judge <assertion-id> --diff -   read the diff from stdin',
    '',
    'One assertion, one diff, one invocation (spec 03 §1). The deterministic judge whose',
    'jurisdiction is the assertion\'s class rules the change; a class with no deterministic rung',
    '(behavior, interface) abstains with a note that an LLM invariant judge must be seated first',
    '(spec 03 §6). No live model call is made by default.',
    '',
    'Options:',
    '  --diff <file|->      the unified diff to judge; `-` reads stdin (required)',
    '  --repo <dir>         repository holding .program/ (default: cwd)',
    '  --json               machine-readable output',
    '  -h, --help           show this message',
    '',
    'Exit codes: 0 a verdict was produced (aligned | drift | abstain) · 1 processing error ·',
    '2 usage error. A `drift` verdict is a successful judgment, not an error.',
    '',
  ].join('\n');
}

function classNote(cls: AssertionClass): string {
  return (
    `No deterministic judge sits for \`class: ${cls}\` (the deterministic bench covers boundary, ` +
    'dependency and convention). Ruling it requires the LLM invariant judge, which must be seated ' +
    'first: a ratified PR plus a passing bar exam (spec 03 §6). .program/manifest.yaml seats none, ' +
    'and this command makes no live model call by default. Abstaining — honest insufficiency ' +
    'never accumulates and escalates (spec 03 §4).'
  );
}

function verdictJson(verdict: Verdict): Record<string, unknown> {
  const encoded = encodeVerdict(verdict);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(encoded)) {
    if (v !== undefined) clean[k] = v;
  }
  return clean;
}

async function runJudgeAssertion(argv: readonly string[]): Promise<number> {
  let values: {
    help?: boolean | undefined;
    diff?: string | undefined;
    repo?: string | undefined;
    json?: boolean | undefined;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: ASSERTION_OPTIONS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp judge: ${(e as Error).message}\n\n${assertionUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(assertionUsage());
    return 0;
  }

  const json = values.json === true;

  if (positionals.length === 0) {
    errOut(`gwtp judge: missing <assertion-id>\n\n${assertionUsage()}`);
    return 2;
  }
  if (positionals.length > 1) {
    errOut(
      `gwtp judge: one assertion per invocation (spec 03 §1); got ${positionals
        .map((p) => `\`${p}\``)
        .join(', ')}`,
    );
    return 2;
  }
  const assertionId = positionals[0] as string;

  if (values.diff === undefined) {
    errOut(`gwtp judge: --diff <file|-> is required\n\n${assertionUsage()}`);
    return 2;
  }

  const repo = resolve(values.repo ?? process.cwd());
  const program = loadProgram(repo);
  if (!program.ok) {
    errOut(`gwtp judge: ${program.message}`);
    return program.code;
  }

  const assertion = program.value.assertions.find((a) => String(a.id) === assertionId);
  if (assertion === undefined) {
    const available = program.value.assertions.map((a) => a.id).join(', ');
    errOut(
      `gwtp judge: no assertion \`${assertionId}\` in ${displayPath(join(repo, '.program', 'invariants.yaml'))}` +
        (available.length > 0 ? ` (available: ${available})` : ''),
    );
    return 2;
  }

  const diffRead = readDiff(values.diff);
  if (!diffRead.ok) {
    errOut(`gwtp judge: ${diffRead.message}`);
    return diffRead.code;
  }
  const parsedHunks = parseUnifiedDiff(diffRead.text);

  // Assemble the sealed bundle through the real chokepoint. `sealEvidence` audits for author
  // identity and accumulator state (compile-time via Blind<T>, runtime via assertBlind) before any
  // judge sees anything (ADR-0003). The ChangeSource returns the parsed hunks; the assembler
  // re-scopes them to the assertion's scope (spec 03 §3).
  const view: AssertionView = assertionView(assertion);
  const change: ChangeSource = { hunksIntersecting: async () => parsedHunks };
  const req: AssembleRequest = {
    assertion: view,
    charter: program.value.charter,
    change,
    ref: PLACEHOLDER_REF,
    precedent: null,
  };
  const sealedResult = await assembleEvidence(req, sealEvidence);
  if (!sealedResult.ok) {
    errOut(`gwtp judge: could not assemble evidence: ${formatContractError(sealedResult.error)}`);
    return 1;
  }
  const sealed = sealedResult.value;

  // Route by class → the deterministic magistrate, or abstain-with-note when none sits.
  const seat = DETERMINISTIC_BY_CLASS[assertion.class];
  let verdict: Verdict;
  let judgeRef: JudgeRef | null;
  let note: string | null;
  if (seat === undefined) {
    note = classNote(assertion.class);
    const abstain: AbstainVerdict = { assertion: view.id, verdict: 'abstain', rationale: note };
    verdict = abstain;
    judgeRef = null;
  } else {
    verdict = await seat.judge(sealed);
    judgeRef = seat.ref;
    note = null;
  }

  if (json) {
    emitJson({
      command: 'judge',
      repo,
      assertion: {
        id: assertion.id,
        class: assertion.class,
        enforcement: assertion.enforcement,
        status: assertion.status,
        statement: assertion.statement,
        scope: [...assertion.scope],
      },
      diff: { hunks: parsedHunks.length, scopedHunks: sealed.bundle.hunks.length, ring: sealed.bundle.ring },
      judge: judgeRef === null ? null : { kind: judgeRef.kind, id: judgeRef.id },
      hunkHash: sealed.hunkHash,
      verdict: verdictJson(verdict),
      ...(note === null ? {} : { note }),
      ok: true,
    });
    return 0;
  }

  out(`assertion   ${assertion.id}  (class: ${assertion.class}, enforcement: ${assertion.enforcement}, status: ${assertion.status})`);
  out(`statement   ${assertion.statement}`);
  out(`scope       ${assertion.scope.join(', ')}`);
  out(
    `diff        ${parsedHunks.length} hunk(s) parsed, ${sealed.bundle.hunks.length} in scope ` +
      `(ring: ${sealed.bundle.ring})`,
  );
  out(`judge       ${judgeRef === null ? '(no deterministic rung for this class)' : `${judgeRef.kind}:${judgeRef.id}`}`);
  out('');
  out(`verdict     ${verdict.verdict}${isViolation(verdict) ? ` (${verdict.severity})` : ''}`);
  if (verdict.confidence !== undefined) out(`confidence  ${verdict.confidence}`);
  if (isViolation(verdict)) {
    out(`evidence    ${verdict.evidence.map((c) => c.source).join(', ')}`);
    if (verdict.verdict === 'regression') out(`precedent   ${verdict.precedent}`);
  }
  const rationale = isViolation(verdict) ? verdict.rationale : verdict.verdict === 'abstain' ? verdict.rationale : undefined;
  if (rationale !== undefined && rationale.length > 0) {
    out('');
    out('rationale');
    for (const line of rationale.split('\n')) out(`  ${line}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// gwtp judge bar-exam
// ---------------------------------------------------------------------------

const BAR_EXAM_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  repo: { type: 'string' },
  json: { type: 'boolean' },
} as const;

function barExamUsage(): string {
  return [
    'gwtp judge bar-exam — replay the settled case law against a candidate judge (spec 03 §6)',
    '',
    'Usage:',
    '  gwtp judge bar-exam [--repo <dir>]',
    '',
    '"Precedents moonlight as the bar exam" (spec 03 §6): .program/precedents.yaml is the corpus a',
    'candidate judge must re-decide before it may sit. This command reads and validates that corpus',
    'and reports its readiness. An EMPTY corpus is not a crash — the exam vacuously passes (there is',
    'no settled ruling to contradict), while seating any judge still requires a non-empty corpus.',
    '',
    'Options:',
    '  --repo <dir>         repository holding .program/ (default: cwd)',
    '  --json               machine-readable output',
    '  -h, --help           show this message',
    '',
    'Exit codes: 0 corpus read (empty → vacuous pass) · 1 corpus malformed · 2 usage error.',
    '',
  ].join('\n');
}

interface SeatedJudgeInfo {
  readonly id: string;
  readonly model: string;
}

function loadSeatedJudges(repo: string): { judges: readonly SeatedJudgeInfo[]; note: string | null } {
  const manifestPath = join(repo, '.program', 'manifest.yaml');
  if (!existsSync(manifestPath)) return { judges: [], note: 'no .program/manifest.yaml' };
  try {
    const decoded = decodeManifest(parseYaml(readFileSync(manifestPath, 'utf8')), '');
    if (!decoded.ok) {
      return { judges: [], note: `manifest.yaml did not decode: ${decoded.error.map(formatContractError).join('; ')}` };
    }
    return { judges: decoded.value.judges.map((j) => ({ id: String(j.id), model: j.model })), note: null };
  } catch (e) {
    return { judges: [], note: `manifest.yaml unreadable: ${(e as Error).message}` };
  }
}

async function runBarExam(argv: readonly string[]): Promise<number> {
  let values: { help?: boolean | undefined; repo?: string | undefined; json?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: BAR_EXAM_OPTIONS,
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp judge bar-exam: ${(e as Error).message}\n\n${barExamUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(barExamUsage());
    return 0;
  }

  const json = values.json === true;
  const repo = resolve(values.repo ?? process.cwd());

  const programDir = join(repo, '.program');
  if (!existsSync(programDir) || !statSync(programDir).isDirectory()) {
    errOut(`gwtp judge bar-exam: no .program/ under ${displayPath(repo)}`);
    return 2;
  }
  const precedentsPath = join(programDir, 'precedents.yaml');
  if (!existsSync(precedentsPath)) {
    errOut(`gwtp judge bar-exam: no ${displayPath(precedentsPath)} — the bar-exam corpus is spec 01 §2 case law`);
    return 2;
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(precedentsPath, 'utf8'));
  } catch (e) {
    errOut(`gwtp judge bar-exam: ${displayPath(precedentsPath)} is not valid YAML: ${(e as Error).message}`);
    return 1;
  }
  const decoded = decodePrecedentsFile(raw, '');
  if (!decoded.ok) {
    errOut(
      `gwtp judge bar-exam: ${displayPath(precedentsPath)} did not decode:\n` +
        decoded.error.map((e) => `  ${formatContractError(e)}`).join('\n'),
    );
    return 1;
  }

  const corpus: readonly Precedent[] = decoded.value;
  const killed = corpus.filter((p) => p.ruling === 'killed').length;
  const affirmed = corpus.filter((p) => p.ruling === 'affirmed').length;
  const coincidence = corpus.filter((p) => p.ruling === 'coincidence').length;
  const seating = loadSeatedJudges(repo);
  const vacuousPass = corpus.length === 0;

  // spec 03 §6: seating a judge requires re-deciding a NON-EMPTY corpus and matching every ruling
  // — a run that examined nothing "has not passed, it has failed to look" (src/judge/bar_exam.ts
  // runBarExam: `seatingAllowed = corpus.length > 0 && failed === 0`). So an empty corpus is a
  // vacuous PASS of the exam and simultaneously blocks seating for want of anything to examine.
  const seatingAllowed = corpus.length > 0;

  if (json) {
    emitJson({
      command: 'bar-exam',
      repo,
      corpus: {
        path: displayPath(precedentsPath),
        settledCases: corpus.length,
        killed,
        affirmed,
        coincidence,
      },
      seatedJudges: seating.judges,
      ...(seating.note === null ? {} : { manifestNote: seating.note }),
      vacuousPass,
      seatingAllowed,
      note: vacuousPass
        ? 'the bar-exam corpus is empty; the exam vacuously passes (no settled ruling to contradict), ' +
          'but seating a judge requires a non-empty corpus (spec 03 §6)'
        : 'replaying these settled cases against a candidate judge requires per-case sealed evidence ' +
          'and the ruling each was settled at (a Precedent record carries neither a Verdict nor a ' +
          'severity, spec 03 §6); seating remains gated on the ratification flow (INV-001)',
      ok: true,
    });
    return 0;
  }

  out(`bar-exam corpus   ${displayPath(precedentsPath)}`);
  out(
    `settled cases     ${corpus.length}` +
      (corpus.length === 0 ? '' : ` (killed ${killed}, affirmed ${affirmed}, coincidence ${coincidence})`),
  );
  out(
    `seated judges     ${seating.judges.length === 0 ? 'none' : seating.judges.map((j) => `${j.id} (${j.model})`).join(', ')}` +
      (seating.note === null ? '' : ` — ${seating.note}`),
  );
  out('');
  if (vacuousPass) {
    out('PASS  the bar-exam corpus is empty: the exam vacuously passes.');
    out(
      '      No settled ruling exists to contradict, so any candidate trivially matches. Seating a ' +
        'judge still requires a NON-EMPTY corpus (spec 03 §6): a run that examined nothing has not ' +
        'passed, it has failed to look. .program/precedents.yaml accrues case law as disputes settle.',
    );
  } else {
    out(`${corpus.length} settled case(s) form the bar-exam corpus.`);
    out(
      'Replaying them against a candidate judge requires per-case sealed evidence and the ruling ' +
        'each was settled at — a Precedent record carries neither a Verdict nor a severity (spec 03 ' +
        '§6). Seating a passing judge is a ratified PR that adds it to .program/manifest.yaml ' +
        '(INV-001); src/judge/bar_exam.ts runBarExam/proposeSeating produce that gated proposal.',
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

function usage(): string {
  return [
    'gwtp judge — run the judgment ladder against a change; bar-exam a candidate judge (spec 03)',
    '',
    'Usage:',
    '  gwtp judge <assertion-id> --diff <file|-> [--repo <dir>] [--json]',
    '  gwtp judge bar-exam [--repo <dir>] [--json]',
    '',
    'Forms:',
    '  <assertion-id> --diff …   assemble evidence for ONE assertion against a unified diff and run',
    '                            the deterministic judge for its class (spec 03 §1, §3). A class with',
    '                            no deterministic rung abstains with a note to seat an LLM judge.',
    '  bar-exam                  read .program/precedents.yaml (the bar-exam corpus, spec 03 §6) and',
    '                            report; an empty corpus vacuously passes rather than crashing.',
    '',
    'Offline by default: no command here makes a live model call. Seating a model judge is a',
    'ratified-PR act (spec 03 §6). This command reads .program/ and a diff and writes nothing',
    '(INV-001/INV-002).',
    '',
    'Run `gwtp judge <form> --help` for a form\'s own options.',
    '',
    'Exit codes: 0 success · 1 processing error · 2 usage error.',
    '',
  ].join('\n');
}

export async function run(argv: readonly string[]): Promise<number> {
  const first = argv[0];

  if (first === '--help' || first === '-h') {
    out(usage());
    return 0;
  }
  if (first === undefined) {
    errOut(usage());
    return 2;
  }
  if (first === 'bar-exam') {
    return runBarExam(argv.slice(1));
  }
  // Anything else is the <assertion-id> form (the id is the first positional; flags may precede it).
  return runJudgeAssertion(argv);
}
