// Implements: docs/spec/02-ledger.md — `gwtp ledger append|fold|replay|status`, SEED-02
// deliverable 4. The thin shell over src/ledger: this file parses flags, reads files, renders
// tables and chooses an exit code. Every fact it prints is computed in src/ledger or src/core.
//
// FOUR SUBCOMMANDS, AND WHAT EACH IS ALLOWED TO TOUCH:
//
//   append  reads event YAML (files or stdin), decodes it against schemas/event.schema.json's
//           contract, SEALS it — `sealEvent` is the only minter of an event id — and appends to
//           the ref. Idempotent by content address, so it reports `deduped` rather than failing.
//   fold    recomputes every accumulator from `events/` and prints the meter. `--write`
//           materializes `accumulators/`, which is derived and rewritable (ADR-0002); it can
//           never write `events/`, because `writeDerivedFiles` refuses that path (INV-002).
//   replay  the same fold under overridden knobs, printed beside the recorded one. WRITES
//           NOTHING, ever, and says so in its own output — a counterfactual that could persist
//           would stop being a counterfactual (spec 02 §1 property 3).
//   status  one screen: is the ref there, how many events, what is close to firing, what fired
//           last, and how much governance debt is outstanding.
//
// THE ONE DECLASSIFICATION (INV-003 clause 2). The accumulated value is a `Surprise`, which is
// not a number, and printing a meter reading requires unwrapping it. `withSentencingWarrant`
// therefore appears exactly once below, wrapping the step that turns states into rows of plain
// data; rendering and JSON serialization operate on that plain data and hold no sentencing value.
// src/core/sentencing.ts names this caller in its own doc comment ("its legitimate callers are
// dispersion, proposal rendering and `gwtp ledger status`"). NO AUTHOR IDENTITY IS READ ANYWHERE
// IN THIS FILE: nothing here imports src/ledger/sighted.ts, so dispersion — and with it the
// refactor/reprogram classification — is deliberately out of scope for the CLI (ADR-0003 permits
// authorship only at firing time, and printing a table is not firing time).
//
// INV-005: node builtins, `yaml`, src/core and src/ledger. No forge API; `--repo` is a directory
// and `--ledger-ref` is a ref name, both of which git understands and no forge needs to.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parseAllDocuments } from 'yaml';

import {
  type AccumulatorKey,
  type Assertion,
  type Budget,
  type CommitterTime,
  type ContractError,
  type EventBody,
  type FoldKnobs,
  type HalfLife,
  type LedgerEvent,
  type Precision,
  committerTimeFromEpochMillis,
  decodeInvariantsFile,
  decodeLedgerEvent,
  isNonEmpty,
  isViolationEvent,
  parseBudget,
  parseCommitterTime,
  parseDuration,
  parsePrecision,
  sealEvent,
} from '../../core/index.js';
// The single greppable declassification import in the CLI. `revealSurprise` is never named here:
// the meter is unwrapped by `materializeAccumulator`, which takes this warrant as a parameter.
import { withSentencingWarrant } from '../../core/sentencing.js';
import {
  type FoldKnobsFor,
  type KeyedFoldResult,
  type IgnoredProposal,
  GitRefEventStore,
  type PushResult,
  LEDGER_REF,
  LedgerConcurrencyError,
  LedgerIntegrityError,
  type LedgerProblem,
  type LedgerScan,
  accumulatorFilePath,
  createGitExec,
  emitCanonicalYaml,
  encodeAccumulatorSnapshot,
  foldEventsPerKey,
  foldKnobs,
  governanceDebt,
  isFiringEvent,
  isGitRepository,
  materializeAccumulator,
  projectStateTo,
  writeDerivedFiles,
} from '../../ledger/index.js';

// ---------------------------------------------------------------------------
// Shared flag grammar
// ---------------------------------------------------------------------------

const COMMON_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  repo: { type: 'string' },
  'ledger-ref': { type: 'string' },
  json: { type: 'boolean' },
} as const;

const APPEND_OPTIONS = {
  ...COMMON_OPTIONS,
  file: { type: 'string', multiple: true },
  'dry-run': { type: 'boolean' },
  // The convergence path made reachable from a shipped command (spec 02 §1.1). Without it a local
  // append writes a private ref that never leaves the runner, so two concurrent CI writers each hold
  // their own ledger and never converge. `--push <remote>` runs the store's push-with-retry
  // (fetch → merge-as-set-union → fast-forward push → bounded retry) after the local append.
  push: { type: 'string' },
} as const;

const FOLD_OPTIONS = {
  ...COMMON_OPTIONS,
  key: { type: 'string', multiple: true },
  'as-of': { type: 'string' },
  write: { type: 'boolean' },
} as const;

const REPLAY_OPTIONS = {
  ...COMMON_OPTIONS,
  key: { type: 'string', multiple: true },
  'as-of': { type: 'string' },
  'half-life': { type: 'string' },
  budget: { type: 'string' },
  precision: { type: 'string' },
} as const;

const STATUS_OPTIONS = {
  ...COMMON_OPTIONS,
  'as-of': { type: 'string' },
} as const;

interface CommonValues {
  readonly help?: boolean | undefined;
  readonly repo?: string | undefined;
  readonly 'ledger-ref'?: string | undefined;
  readonly json?: boolean | undefined;
}

/** Everything a subcommand needs to find the ledger it is talking about. */
interface Context {
  readonly repo: string;
  readonly ref: string;
  readonly json: boolean;
}

function contextOf(values: CommonValues): Context {
  return {
    repo: resolve(values.repo ?? process.cwd()),
    ref: values['ledger-ref'] ?? LEDGER_REF,
    json: values.json === true,
  };
}

function storeOf(ctx: Context): GitRefEventStore {
  return new GitRefEventStore({ cwd: ctx.repo, ref: ctx.ref });
}

/**
 * `null` when `--repo` names a git repository, and the reason otherwise.
 *
 * Every read in src/ledger reports an absent ref and an absent REPOSITORY the same way — no tip,
 * no entries — which is correct for a ledger nobody has written yet and actively misleading for a
 * mistyped path. One `rev-parse --git-dir` buys the difference between "0 events" and "that is
 * not a repository".
 */
async function repoProblem(ctx: Context): Promise<string | null> {
  if (!existsSync(ctx.repo)) return `--repo ${displayPath(ctx.repo)} does not exist`;
  try {
    return (await isGitRepository(createGitExec({ cwd: ctx.repo })))
      ? null
      : `--repo ${displayPath(ctx.repo)} is not a git repository, so it has no ${ctx.ref} — ` +
        'the ledger is a git ref (spec 02 §1)';
  } catch (e) {
    return `cannot run git in ${displayPath(ctx.repo)}: ${(e as Error).message}`;
  }
}

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

function num(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

function pct(value: number, of: number | null): string {
  if (of === null || !(of > 0)) return '—';
  return `${((value / of) * 100).toFixed(0)}%`;
}

function shortId(id: string): string {
  return id.startsWith('sha256:') ? `${id.slice(0, 'sha256:'.length + 12)}…` : id;
}

type Align = 'l' | 'r';

/** Fixed-width columns. No dependency, and the same shape `gwtp validate` prints. */
function table(headers: readonly string[], rows: readonly (readonly string[])[], align: readonly Align[]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((c, i) =>
        align[i] === 'r'
          ? c.padStart(widths[i] ?? 0)
          : i === cells.length - 1
            ? c
            : c.padEnd(widths[i] ?? 0),
      )
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

// ---------------------------------------------------------------------------
// The knobs: `budget` and `half_life` are fields of an ASSERTION
// ---------------------------------------------------------------------------

const INVARIANTS_PATH = join('.program', 'invariants.yaml');

interface ProgramKnobs {
  /** Assertions by id, from `.program/invariants.yaml`. Empty when the file is absent. */
  readonly assertions: ReadonlyMap<string, Assertion>;
  readonly path: string;
  readonly present: boolean;
  readonly errors: readonly ContractError[];
}

function loadProgramKnobs(repo: string): ProgramKnobs {
  const path = join(repo, INVARIANTS_PATH);
  if (!existsSync(path)) {
    return { assertions: new Map(), path, present: false, errors: [] };
  }
  const docs = parseAllDocuments(readFileSync(path, 'utf8'));
  const first = docs[0];
  const raw: unknown = first === undefined ? [] : first.toJS({ maxAliasCount: -1 });
  const decoded = decodeInvariantsFile(raw, '');
  if (!decoded.ok) {
    return { assertions: new Map(), path, present: true, errors: decoded.error };
  }
  const assertions = new Map<string, Assertion>();
  for (const a of decoded.value) assertions.set(a.id as string, a);
  return { assertions, path, present: true, errors: [] };
}

interface KnobOverrides {
  readonly halfLife?: HalfLife;
  readonly budget?: Budget;
  readonly precision?: Precision;
}

/**
 * The resolver `foldEventsPerKey` walks with. An accumulator key with no assertion has no budget
 * and no half-life, and this returns `null` for it rather than inventing either — see
 * docs/spec/OPEN-QUESTIONS.md Q-56. The one exception is explicit: when the caller supplied BOTH
 * `--half-life` and `--budget` (replay), those ARE knobs for every key, including the
 * scope-claim keys an obsolescence sweep writes (spec 02 §7).
 */
function knobsResolver(program: ProgramKnobs, overrides: KnobOverrides = {}): FoldKnobsFor {
  const complete = overrides.halfLife !== undefined && overrides.budget !== undefined;
  return (key: AccumulatorKey): FoldKnobs | null => {
    const assertion = program.assertions.get(key as string);
    if (assertion === undefined) {
      return complete
        ? foldKnobs(
            { budget: overrides.budget as Budget, half_life: overrides.halfLife as HalfLife },
            precisionOverrideOf(overrides),
          )
        : null;
    }
    return foldKnobs(assertion, {
      ...(overrides.halfLife !== undefined ? { halfLife: overrides.halfLife } : {}),
      ...(overrides.budget !== undefined ? { budget: overrides.budget } : {}),
      ...precisionOverrideOf(overrides),
    });
  };
}

function precisionOverrideOf(overrides: KnobOverrides): { precisionOverride?: Precision } {
  return overrides.precision !== undefined ? { precisionOverride: overrides.precision } : {};
}

// ---------------------------------------------------------------------------
// Reading the ledger
// ---------------------------------------------------------------------------

function renderProblems(problems: readonly LedgerProblem[]): string {
  return problems.map((p) => `  ${p.path} [${p.code}]: ${p.message}`).join('\n');
}

interface EventCensus {
  readonly total: number;
  readonly violations: number;
  readonly compliances: number;
  readonly abstentions: number;
  readonly firingEvents: number;
}

function census(events: readonly LedgerEvent[]): EventCensus {
  let violations = 0;
  let compliances = 0;
  let abstentions = 0;
  let firingEvents = 0;
  for (const e of events) {
    if (isFiringEvent(e)) firingEvents += 1;
    if (isViolationEvent(e)) violations += 1;
    else if (e.verdict === 'abstain') abstentions += 1;
    else compliances += 1;
  }
  return { total: events.length, violations, compliances, abstentions, firingEvents };
}

// ---------------------------------------------------------------------------
// The rows: the ONE place a `Surprise` becomes a number
// ---------------------------------------------------------------------------

interface AccumulatorRow {
  readonly key: string;
  readonly value: number;
  readonly budget: number | null;
  readonly percentOfBudget: number | null;
  readonly armed: boolean;
  readonly lastFiredAt: string | null;
  readonly violationCount: number;
  readonly complianceCount: number;
  readonly abstentionCount: number;
  readonly contributing: number;
  readonly halfLife: string | null;
  readonly rearmFraction: number | null;
  readonly precisionOverride: number | null;
  readonly knobs: string | null;
  readonly asOf: string | null;
  readonly lastEventAt: string | null;
  readonly firings: number;
}

interface FiringRow {
  readonly key: string;
  readonly at: string;
  readonly triggeredBy: string;
  readonly value: number;
  readonly budget: number;
}

interface FoldReport {
  readonly rows: readonly AccumulatorRow[];
  readonly firings: readonly FiringRow[];
  /** `accumulators/<key>.yaml` files, as they would be written. Pure: not projected to a clock. */
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly emitErrors: readonly ContractError[];
}

/**
 * Turns a keyed fold into plain data. The `withSentencingWarrant` below is the CLI's ONLY
 * declassification: `materializeAccumulator` takes the warrant as a parameter (src/ledger/cache.ts
 * keeps it that way deliberately), so every meter reading in this file passes through this one
 * call and rendering downstream can hold nothing tainted.
 *
 * `asOf` projects the meter to an explicit instant for DISPLAY only — `projectStateTo` ages the
 * state and re-tests the re-arm threshold. The materialized files always come from the
 * unprojected fold, so `accumulators/` stays a pure function of the event set and the knobs
 * (ADR-0002) and never records what time it was written.
 */
function reportOf(
  result: KeyedFoldResult,
  keys: readonly AccumulatorKey[],
  asOf: CommitterTime | null,
): FoldReport {
  return withSentencingWarrant((warrant): FoldReport => {
    const rows: AccumulatorRow[] = [];
    const files: { path: string; content: string }[] = [];
    const emitErrors: ContractError[] = [];

    for (const key of keys) {
      const state = result.states.get(key);
      const knobs = result.knobs.get(key);
      if (state === undefined || knobs === undefined) continue;

      const shown = asOf === null ? state : projectStateTo(state, asOf, knobs);
      const snapshot = materializeAccumulator(shown, warrant).snapshot;
      const budget = knobs.budget as number;
      rows.push({
        key: key as string,
        value: snapshot.value,
        budget,
        percentOfBudget: budget > 0 ? (snapshot.value / budget) * 100 : null,
        armed: snapshot.armed,
        lastFiredAt: snapshot.last_fired_at,
        violationCount: snapshot.violation_count,
        complianceCount: snapshot.compliance_count,
        abstentionCount: snapshot.abstention_count,
        contributing: snapshot.event_count,
        halfLife: knobs.halfLife.source,
        rearmFraction: knobs.rearmFraction,
        precisionOverride:
          knobs.precisionOverride === null ? null : (knobs.precisionOverride as number),
        knobs: snapshot.knobs,
        asOf: snapshot.as_of,
        lastEventAt: snapshot.last_event_at,
        firings: result.firings.filter((f) => f.key === key).length,
      });

      const materialized = materializeAccumulator(state, warrant);
      const yaml = emitCanonicalYaml(encodeAccumulatorSnapshot(materialized.snapshot), ['key']);
      if (yaml.ok) files.push({ path: materialized.path, content: yaml.value });
      else emitErrors.push(yaml.error);
    }

    // A `Firing` carries its own `Surprise`, and there is no `revealSurprise` in this file: the
    // meter is read through `materializeAccumulator`, so the firing's value is read by handing
    // that function a state whose `value` is the firing's. Same warrant, same single door.
    const firings: FiringRow[] = result.firings
      .filter((f) => keys.includes(f.key))
      .map((f) => {
        const state = result.states.get(f.key);
        return {
          key: f.key as string,
          at: f.at as string,
          triggeredBy: f.triggeredBy as string,
          value:
            state === undefined
              ? Number.NaN
              : materializeAccumulator({ ...state, value: f.value }, warrant).snapshot.value,
          budget: f.budget as number,
        };
      });

    return { rows, firings, files, emitErrors };
  });
}

// ---------------------------------------------------------------------------
// `gwtp ledger append`
// ---------------------------------------------------------------------------

/**
 * An event body with no id yet. `decodeLedgerEvent` requires `event`, because a stored event
 * always has one, so a document that omits it is decoded against a PLACEHOLDER and then sealed —
 * the placeholder never survives, and `sealEvent` recomputes the id from the canonical body
 * exactly as the store would. A document that DOES carry an id is decoded as-is and re-sealed
 * too, which is how a mismatch is detected rather than trusted.
 */
const PLACEHOLDER_ID = `sha256:${'0'.repeat(64)}`;

interface ParsedInput {
  readonly event: LedgerEvent;
  readonly source: string;
  /** The id the document claimed, when it claimed one. */
  readonly declared: string | null;
}

interface InputProblem {
  readonly source: string;
  readonly errors: readonly ContractError[];
}

function readEventDocuments(
  text: string,
  source: string,
  events: ParsedInput[],
  problems: InputProblem[],
): void {
  let docs;
  try {
    docs = parseAllDocuments(text);
  } catch (e) {
    problems.push({
      source,
      errors: [{ code: 'wrong-type', message: `not YAML: ${(e as Error).message}` }],
    });
    return;
  }

  const records: { raw: unknown; at: string }[] = [];
  docs.forEach((doc, i) => {
    if (doc.errors.length > 0) {
      problems.push({
        source,
        errors: doc.errors.map((e) => ({
          code: 'wrong-type' as const,
          message: e.message,
          at: `/${i}`,
        })),
      });
      return;
    }
    const value: unknown = doc.toJS({ maxAliasCount: -1 });
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, j) => records.push({ raw: item, at: `${source}[${j}]` }));
      return;
    }
    records.push({ raw: value, at: docs.length > 1 ? `${source}#${i}` : source });
  });

  for (const record of records) {
    const declared =
      typeof record.raw === 'object' &&
      record.raw !== null &&
      !Array.isArray(record.raw) &&
      typeof (record.raw as Record<string, unknown>)['event'] === 'string'
        ? ((record.raw as Record<string, unknown>)['event'] as string)
        : null;
    const withId =
      declared === null && typeof record.raw === 'object' && record.raw !== null
        ? { ...(record.raw as Record<string, unknown>), event: PLACEHOLDER_ID }
        : record.raw;

    const decoded = decodeLedgerEvent(withId, '');
    if (!decoded.ok) {
      problems.push({ source: record.at, errors: decoded.error });
      continue;
    }
    const { event: _placeholder, ...body } = decoded.value;
    const sealed = sealEvent(body as EventBody);
    if (!sealed.ok) {
      problems.push({ source: record.at, errors: [sealed.error] });
      continue;
    }
    if (declared !== null && declared !== (sealed.value.event as string)) {
      problems.push({
        source: record.at,
        errors: [
          {
            code: 'hash-mismatch',
            message:
              `document declares \`event: ${declared}\` but its canonical body hashes to ` +
              `${sealed.value.event}. Events are content-addressed (spec 02 §1); the id is not a ` +
              'field a writer chooses.',
            at: '/event',
          },
        ],
      });
      continue;
    }
    events.push({ event: sealed.value, source: record.at, declared });
  }
}

function appendUsage(): string {
  return [
    'gwtp ledger append — record observations on the ledger ref (INV-002: append-only)',
    '',
    'Usage:',
    '  gwtp ledger append <file.yaml>...      read events from files',
    '  gwtp ledger append --file <path>       same, repeatable',
    '  cat event.yaml | gwtp ledger append    read events from stdin',
    '',
    'Each document may be one event mapping, a sequence of them, or several YAML documents.',
    'The `event:` id is OPTIONAL: it is the sha256 of the canonical body (spec 02 §1), so it is',
    'computed here. Supplying one is allowed and is checked, never trusted.',
    '',
    'Options:',
    '  --file <path>        an input file; repeatable. `-` means stdin',
    '  --dry-run            decode, seal and report ids; write nothing',
    '  --push <remote>      after the local append, converge with a remote ledger and push it',
    '                       (fetch → merge-as-set-union → fast-forward → bounded retry, spec 02 §1.1).',
    '                       A rejected push never loses the local write and fails loudly.',
    '  --repo <dir>         repository holding the ledger ref (default: cwd)',
    '  --ledger-ref <ref>   ref to append to (default: ' + LEDGER_REF + ')',
    '  --json               machine-readable output',
    '  -h, --help           show this message',
    '',
    'A repeated append is a no-op reported as `deduped`, not an error: the filename IS the hash',
    'of the body, so recording the same observation twice cannot produce two events.',
    '',
  ].join('\n');
}

async function runAppend(argv: readonly string[]): Promise<number> {
  let values: CommonValues & {
    file?: string[] | undefined;
    'dry-run'?: boolean | undefined;
    push?: string | undefined;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: APPEND_OPTIONS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp ledger append: ${(e as Error).message}\n\n${appendUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(appendUsage());
    return 0;
  }

  const ctx = contextOf(values);
  const bad = await repoProblem(ctx);
  if (bad !== null) {
    errOut(`gwtp ledger append: ${bad}`);
    return 2;
  }
  const sources = [...positionals, ...(values.file ?? [])];
  const parsed: ParsedInput[] = [];
  const problems: InputProblem[] = [];

  if (sources.length === 0 || sources.includes('-')) {
    if (sources.length === 0 && process.stdin.isTTY === true) {
      errOut(`gwtp ledger append: no input — name a file or pipe YAML on stdin\n\n${appendUsage()}`);
      return 2;
    }
    try {
      readEventDocuments(readFileSync(0, 'utf8'), '<stdin>', parsed, problems);
    } catch (e) {
      errOut(`gwtp ledger append: cannot read stdin: ${(e as Error).message}`);
      return 1;
    }
  }
  for (const source of sources) {
    if (source === '-') continue;
    const file = resolve(source);
    if (!existsSync(file)) {
      problems.push({
        source: displayPath(file),
        errors: [{ code: 'missing-field', message: 'no such file' }],
      });
      continue;
    }
    readEventDocuments(readFileSync(file, 'utf8'), displayPath(file), parsed, problems);
  }

  if (problems.length > 0) {
    if (ctx.json) {
      emitJson({
        command: 'append',
        ref: ctx.ref,
        repo: ctx.repo,
        ok: false,
        problems: problems.map((p) => ({ source: p.source, errors: p.errors })),
      });
    } else {
      errOut('gwtp ledger append: refusing to write — some input did not decode:');
      for (const p of problems) {
        errOut(`  ${p.source}`);
        for (const e of p.errors) errOut(`      ${formatContractError(e)}`);
      }
    }
    return 1;
  }

  if (!isNonEmpty(parsed)) {
    if (ctx.json) {
      emitJson({ command: 'append', ref: ctx.ref, repo: ctx.repo, ok: true, written: [], deduped: [], events: [] });
    } else {
      out('gwtp ledger append: no events in the input; nothing to do.');
    }
    return 0;
  }

  const describe = (e: LedgerEvent): Record<string, unknown> => ({
    event: e.event,
    assertion: e.assertion,
    verdict: e.verdict,
    t: e.t,
    ...(isViolationEvent(e) ? { severity: e.severity, precision_at: e.precision_at } : {}),
    ...(e.supersedes === null ? {} : { supersedes: e.supersedes }),
  });

  if (values['dry-run'] === true) {
    if (ctx.json) {
      emitJson({
        command: 'append',
        ref: ctx.ref,
        repo: ctx.repo,
        ok: true,
        dryRun: true,
        written: [],
        deduped: [],
        sealed: parsed.map((p) => ({ ...describe(p.event), source: p.source })),
      });
    } else {
      out(`--dry-run: ${parsed.length} event(s) sealed, nothing written to ${ctx.ref}.`);
      out(
        table(
          ['EVENT', 'ASSERTION', 'VERDICT', 'COMMITTER TIME', 'SOURCE'],
          parsed.map((p) => [
            shortId(p.event.event),
            p.event.assertion,
            p.event.verdict,
            p.event.t,
            p.source,
          ]),
          ['l', 'l', 'l', 'l', 'l'],
        ),
      );
    }
    return 0;
  }

  const sealed = parsed.map((p) => p.event);
  if (!isNonEmpty(sealed)) {
    out('gwtp ledger append: no events in the input; nothing to do.');
    return 0;
  }
  const store = storeOf(ctx);
  const outcome = await store.append(sealed);
  const written = new Set(outcome.written as readonly string[]);

  // --push wires the convergence path (spec 02 §1.1) to a shipped command. Push AFTER the local
  // append so a rejected push never loses the local write, and surface a failure loudly: "a ledger
  // write that silently did not happen is worse than a failed CI step".
  let pushResult: PushResult | null = null;
  if (values.push !== undefined) {
    try {
      pushResult = await store.pushWithRetry(values.push);
    } catch (e) {
      const msg = `gwtp ledger append: local append succeeded but push to ${values.push} failed: ${(e as Error).message}`;
      if (ctx.json) {
        emitJson({
          command: 'append',
          ref: ctx.ref,
          repo: ctx.repo,
          ok: false,
          written: outcome.written,
          deduped: outcome.deduped,
          pushed: false,
          pushError: (e as Error).message,
        });
      } else {
        errOut(msg);
      }
      return 1;
    }
  }

  if (ctx.json) {
    emitJson({
      command: 'append',
      ref: ctx.ref,
      repo: ctx.repo,
      ok: true,
      dryRun: false,
      written: outcome.written,
      deduped: outcome.deduped,
      ...(pushResult === null
        ? {}
        : { pushed: pushResult.pushed, pushAttempts: pushResult.attempts, remote: values.push }),
      events: parsed.map((p) => ({
        ...describe(p.event),
        status: written.has(p.event.event as string) ? 'written' : 'deduped',
        source: p.source,
      })),
    });
    return 0;
  }

  out(
    `${outcome.written.length} written, ${outcome.deduped.length} deduped → ${ctx.ref} in ${displayPath(ctx.repo)}`,
  );
  if (pushResult !== null) {
    out(
      `pushed to ${values.push} in ${pushResult.attempts} attempt(s); ledger tip ${pushResult.tip === null ? '—' : shortId(pushResult.tip as string)}`,
    );
  }
  out(
    table(
      ['STATUS', 'EVENT', 'ASSERTION', 'VERDICT', 'COMMITTER TIME'],
      parsed.map((p) => [
        written.has(p.event.event as string) ? 'written' : 'deduped',
        shortId(p.event.event),
        p.event.assertion,
        p.event.verdict,
        p.event.t,
      ]),
      ['l', 'l', 'l', 'l', 'l'],
    ),
  );
  if (outcome.deduped.length > 0) {
    out('');
    out(
      'A deduped event is not an error: the filename is the hash of the body, so the observation ' +
        'was already recorded (spec 02 §1, ADR-0002).',
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Shared fold plumbing for `fold`, `replay` and `status`
// ---------------------------------------------------------------------------

interface LedgerRead {
  readonly scan: LedgerScan;
  readonly program: ProgramKnobs;
}

async function readLedger(ctx: Context): Promise<LedgerRead> {
  const scan = await storeOf(ctx).scan();
  return { scan, program: loadProgramKnobs(ctx.repo) };
}

function selectedKeys(
  result: KeyedFoldResult,
  wanted: readonly string[] | undefined,
): { keys: readonly AccumulatorKey[]; unknown: readonly string[] } {
  if (wanted === undefined || wanted.length === 0) return { keys: result.keys, unknown: [] };
  const present = new Set(result.keys as readonly string[]);
  const keys: AccumulatorKey[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    if (present.has(w)) keys.push(w as AccumulatorKey);
    else missing.push(w);
  }
  return { keys, unknown: missing };
}

function parseOverrides(values: {
  'half-life'?: string | undefined;
  budget?: string | undefined;
  precision?: string | undefined;
}): { overrides: KnobOverrides; errors: readonly ContractError[] } {
  const errors: ContractError[] = [];
  const overrides: { -readonly [K in keyof KnobOverrides]?: KnobOverrides[K] } = {};

  if (values['half-life'] !== undefined) {
    const d = parseDuration(values['half-life'], '/half-life');
    if (d.ok) overrides.halfLife = d.value;
    else errors.push(d.error);
  }
  // `Number('soon')` is `NaN`, and a NaN reaching `parseBudget` reports "must be a finite
  // number", which is true and unhelpful. The text the user typed is the useful half.
  if (values.budget !== undefined) {
    const raw = Number(values.budget);
    const b = Number.isFinite(raw)
      ? parseBudget(raw, '/budget')
      : { ok: false as const, error: {
          code: 'invalid-budget' as const,
          message: `--budget expects a number > 0, got ${JSON.stringify(values.budget)}`,
          at: '/budget',
        } };
    if (b.ok) overrides.budget = b.value;
    else errors.push(b.error);
  }
  if (values.precision !== undefined) {
    const raw = Number(values.precision);
    const p = Number.isFinite(raw)
      ? parsePrecision(raw, '/precision')
      : { ok: false as const, error: {
          code: 'invalid-precision' as const,
          message: `--precision expects a number in (0, 1], got ${JSON.stringify(values.precision)}`,
          at: '/precision',
        } };
    if (p.ok) overrides.precision = p.value;
    else errors.push(p.error);
  }
  return { overrides, errors };
}

function parseAsOf(raw: string | undefined): { at: CommitterTime | null; error: ContractError | null } {
  if (raw === undefined) return { at: null, error: null };
  if (raw === 'now') {
    const now = committerTimeFromEpochMillis(Date.now());
    return now.ok ? { at: now.value, error: null } : { at: null, error: now.error };
  }
  const t = parseCommitterTime(raw, '/as-of');
  return t.ok ? { at: t.value, error: null } : { at: null, error: t.error };
}

function unfoldedNote(result: KeyedFoldResult): string {
  return (
    `${result.unfolded.length} accumulator key(s) not folded — no assertion in ` +
    `${INVARIANTS_PATH} supplies a budget and a half-life for them, and this engine will not ` +
    `invent one (docs/spec/OPEN-QUESTIONS.md Q-56): ` +
    result.unfolded.map((k) => `\`${k}\``).join(', ')
  );
}

function accumulatorTable(rows: readonly AccumulatorRow[]): string {
  return table(
    ['KEY', 'VALUE', 'BUDGET', '%BUD', 'ARM', 'V', 'C', 'A', 'HALF-LIFE', 'LAST EVENT'],
    rows.map((r) => [
      r.key,
      num(r.value),
      r.budget === null ? '—' : num(r.budget),
      pct(r.value, r.budget),
      r.armed ? 'armed' : `fired ${r.lastFiredAt === null ? '' : shortTime(r.lastFiredAt)}`,
      String(r.violationCount),
      String(r.complianceCount),
      String(r.abstentionCount),
      r.halfLife ?? '—',
      r.lastEventAt ?? '—',
    ]),
    ['l', 'r', 'r', 'r', 'l', 'r', 'r', 'r', 'r', 'l'],
  );
}

function shortTime(t: string): string {
  return t.length >= 10 ? t.slice(0, 10) : t;
}

function reportProblems(ctx: Context, scan: LedgerScan, command: string): boolean {
  if (scan.problems.length === 0) return false;
  if (!ctx.json) {
    errOut(
      `gwtp ledger ${command}: ${scan.problems.length} integrity problem(s) in ${ctx.ref} — a ` +
        'blob whose name does not match its content hash is tamper evidence, not a rounding error:',
    );
    errOut(renderProblems(scan.problems));
  }
  return true;
}

// ---------------------------------------------------------------------------
// `gwtp ledger fold`
// ---------------------------------------------------------------------------

function foldUsage(): string {
  return [
    'gwtp ledger fold — recompute every accumulator from the event set (spec 02 §4)',
    '',
    'Usage:',
    '  gwtp ledger fold [--key <accumulator-key>]... [--write]',
    '',
    'The fold is deterministic: same event set + same knobs → identical state. Accumulators are',
    'DERIVED and never authoritative (ADR-0002), so this command can always be re-run and its',
    'answer never depends on the cache.',
    '',
    'Options:',
    '  --key <key>          restrict to one accumulator key; repeatable',
    '  --as-of <timestamp>  age the meter to an instant for display (`now` is accepted).',
    '                       Decay runs on committer time (ADR-0004); the written cache is never',
    '                       projected, so `accumulators/` stays a pure function of `events/`',
    '  --write              materialize `accumulators/` into the ledger ref',
    '  --repo <dir>         repository holding the ledger ref and `.program/` (default: cwd)',
    '  --ledger-ref <ref>   ref to fold (default: ' + LEDGER_REF + ')',
    '  --json               machine-readable output',
    '  -h, --help           show this message',
    '',
    '`budget` and `half_life` come from the assertion in .program/invariants.yaml. A key with no',
    'assertion is reported, never folded against a guessed budget (Q-56).',
    '',
    'Exit codes: 0 folded · 1 ledger or program problem · 2 usage error.',
    '',
  ].join('\n');
}

async function runFold(argv: readonly string[]): Promise<number> {
  let values: CommonValues & {
    key?: string[] | undefined;
    'as-of'?: string | undefined;
    write?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: FOLD_OPTIONS,
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp ledger fold: ${(e as Error).message}\n\n${foldUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(foldUsage());
    return 0;
  }

  const ctx = contextOf(values);
  const asOf = parseAsOf(values['as-of']);
  if (asOf.error !== null) {
    errOut(`gwtp ledger fold: --as-of ${formatContractError(asOf.error)}`);
    return 2;
  }
  const bad = await repoProblem(ctx);
  if (bad !== null) {
    errOut(`gwtp ledger fold: ${bad}`);
    return 2;
  }

  const { scan, program } = await readLedger(ctx);
  const tainted = reportProblems(ctx, scan, 'fold');

  const result = foldEventsPerKey(scan.events, knobsResolver(program));
  if (!result.ok) {
    errOut(`gwtp ledger fold: ${formatContractError(result.error)}`);
    return 1;
  }
  const selected = selectedKeys(result.value, values.key);
  const report = reportOf(result.value, selected.keys, asOf.at);

  let write: { written: readonly string[]; unchanged: readonly string[]; commit: string | null } | null =
    null;
  if (values.write === true) {
    // A tampered ledger must never be materialized. The fold above ran over `scan.events`, which
    // EXCLUDES any blob whose name does not match its content hash — so writing now would persist a
    // derived cache that quietly agrees with the tamperer and move the ref onto it. The derived
    // level's one hard rule (ADR-0002): it may not certify a source it has already flagged as
    // tamper evidence. Refuse, loudly, and leave the ref where it is.
    if (tainted) {
      errOut(
        'gwtp ledger fold --write: refusing to materialize a cache over a tampered ledger — ' +
          `${scan.problems.length} integrity problem(s) above. Fix the ledger first; a derived ` +
          'cache must never certify events the store itself rejected (ADR-0002, INV-002).',
      );
      if (ctx.json) {
        emitJson({
          command: 'fold',
          ref: ctx.ref,
          repo: ctx.repo,
          ok: false,
          wrote: null,
          problems: scan.problems,
        });
      }
      return 1;
    }
    if (report.emitErrors.length > 0) {
      errOut('gwtp ledger fold: an accumulator snapshot would not serialize; nothing written:');
      for (const e of report.emitErrors) errOut(`  ${formatContractError(e)}`);
      return 1;
    }
    const files = report.files.filter((f) =>
      selected.keys.some((k) => f.path === accumulatorFilePath(k)),
    );
    const done = await writeDerivedFiles(
      { cwd: ctx.repo, ref: ctx.ref },
      files,
      `ledger: materialize ${files.length} accumulator(s)`,
    );
    write = { written: done.written, unchanged: done.unchanged, commit: done.commit };
  }

  if (ctx.json) {
    emitJson({
      command: 'fold',
      ref: ctx.ref,
      repo: ctx.repo,
      tip: scan.tip,
      asOf: asOf.at,
      eventCount: result.value.eventCount,
      tips: result.value.tips.length,
      forks: result.value.forks,
      dangling: result.value.dangling,
      accumulators: report.rows,
      firings: report.firings,
      unfolded: result.value.unfolded,
      unknownKeys: selected.unknown,
      program: { path: program.path, present: program.present, assertions: program.assertions.size },
      problems: scan.problems,
      write,
      ok: !tainted && selected.unknown.length === 0,
    });
    return tainted || selected.unknown.length > 0 ? 1 : 0;
  }

  out(
    `${ctx.ref} ${scan.tip === null ? '(absent)' : `@ ${scan.tip.slice(0, 12)}`} · ` +
      `${result.value.eventCount} event(s), ${result.value.tips.length} tip(s), ` +
      `${report.rows.length} accumulator(s)`,
  );
  if (!program.present) {
    out(`no ${INVARIANTS_PATH} under ${displayPath(ctx.repo)} — no assertion supplies any knobs`);
  }
  out('');
  out(report.rows.length === 0 ? '(no accumulators)' : accumulatorTable(report.rows));

  if (report.firings.length > 0) {
    out('');
    out(`${report.firings.length} firing(s) during the walk (spec 02 §5):`);
    for (const f of report.firings) {
      out(
        `  ${f.at}  ${f.key}  ${num(f.value)} >= budget ${num(f.budget)}  ` +
          `triggered by ${shortId(f.triggeredBy)}`,
      );
    }
  }
  if (result.value.forks.length > 0) {
    out('');
    out(
      `${result.value.forks.length} supersession fork(s) — two events superseding the same event; ` +
        'both are tips and both accumulate (reported, not resolved).',
    );
  }
  if (result.value.dangling.length > 0) {
    out(
      `${result.value.dangling.length} event(s) supersede an id absent from this ledger; kept as tips.`,
    );
  }
  if (result.value.unfolded.length > 0) {
    out('');
    out(unfoldedNote(result.value));
  }
  if (selected.unknown.length > 0) {
    out('');
    errOut(`no accumulator keyed ${selected.unknown.map((k) => `\`${k}\``).join(', ')} in this ledger`);
  }
  if (write !== null) {
    out('');
    out(
      write.commit === null
        ? `--write: ${write.unchanged.length} accumulator file(s) already current; no commit made.`
        : `--write: ${write.written.length} accumulator file(s) written, ` +
          `${write.unchanged.length} unchanged → ${ctx.ref} ${write.commit.slice(0, 12)}`,
    );
    out(
      'The cache is derived, never authoritative (ADR-0002): `events/` is untouched, and this ' +
        'file can be deleted and re-folded at any time.',
    );
  }
  return tainted || selected.unknown.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// `gwtp ledger replay`
// ---------------------------------------------------------------------------

function replayUsage(): string {
  return [
    'gwtp ledger replay — the same fold under different knobs, side by side (spec 02 §1.3)',
    '',
    'Usage:',
    '  gwtp ledger replay [--half-life 90d] [--budget 2.0] [--precision 0.9] [--key <key>]...',
    '',
    '"Retune a half_life or precision retroactively and recompute; run counterfactuals (what',
    'fires under budget 2.0?) without losing anything." Every override is a READ-TIME',
    'substitution: `precision_at` is frozen per event by spec 02 §2 and nothing here can reach a',
    'stored event. THIS COMMAND WRITES NOTHING — not the ledger, not the cache, not `.program/`.',
    '',
    'Options:',
    '  --half-life <Nd|Nw|Nmo>  replace every assertion half-life',
    '  --budget <number>        replace every assertion budget',
    '  --precision <0..1]       replace every event\'s frozen precision_at at read time',
    '  --key <key>              restrict to one accumulator key; repeatable',
    '  --as-of <timestamp>      age both meters to an instant for display (`now` is accepted)',
    '  --repo <dir>             repository holding the ledger ref and `.program/` (default: cwd)',
    '  --ledger-ref <ref>       ref to replay (default: ' + LEDGER_REF + ')',
    '  --json                   machine-readable output',
    '  -h, --help               show this message',
    '',
    'Supplying BOTH --half-life and --budget also gives knobs to keys that have no assertion at',
    'all — the scope-claim keys an obsolescence sweep writes (spec 02 §7, Q-56).',
    '',
    'Exit codes: 0 replayed · 1 ledger or program problem · 2 usage error.',
    '',
  ].join('\n');
}

async function runReplay(argv: readonly string[]): Promise<number> {
  let values: CommonValues & {
    key?: string[] | undefined;
    'as-of'?: string | undefined;
    'half-life'?: string | undefined;
    budget?: string | undefined;
    precision?: string | undefined;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: REPLAY_OPTIONS,
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp ledger replay: ${(e as Error).message}\n\n${replayUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(replayUsage());
    return 0;
  }

  const ctx = contextOf(values);
  const parsedOverrides = parseOverrides(values);
  const asOf = parseAsOf(values['as-of']);
  const usageErrors = [...parsedOverrides.errors, ...(asOf.error === null ? [] : [asOf.error])];
  if (usageErrors.length > 0) {
    for (const e of usageErrors) errOut(`gwtp ledger replay: ${formatContractError(e)}`);
    return 2;
  }
  const bad = await repoProblem(ctx);
  if (bad !== null) {
    errOut(`gwtp ledger replay: ${bad}`);
    return 2;
  }

  const { scan, program } = await readLedger(ctx);
  const tainted = reportProblems(ctx, scan, 'replay');

  const recorded = foldEventsPerKey(scan.events, knobsResolver(program));
  if (!recorded.ok) {
    errOut(`gwtp ledger replay: ${formatContractError(recorded.error)}`);
    return 1;
  }
  const counterfactual = foldEventsPerKey(
    scan.events,
    knobsResolver(program, parsedOverrides.overrides),
  );
  if (!counterfactual.ok) {
    errOut(`gwtp ledger replay: ${formatContractError(counterfactual.error)}`);
    return 1;
  }

  // The union of both key sets: an override can bring a key into the fold that had no knobs.
  const union = [
    ...new Set<string>([
      ...(recorded.value.keys as readonly string[]),
      ...(counterfactual.value.keys as readonly string[]),
    ]),
  ].sort() as AccumulatorKey[];
  const selected = selectedKeys(
    { ...counterfactual.value, keys: union },
    values.key,
  );

  const before = reportOf(recorded.value, selected.keys, asOf.at);
  const after = reportOf(counterfactual.value, selected.keys, asOf.at);
  const byKey = (rows: readonly AccumulatorRow[]): Map<string, AccumulatorRow> =>
    new Map(rows.map((r) => [r.key, r]));
  const beforeRows = byKey(before.rows);
  const afterRows = byKey(after.rows);

  const overrides = {
    halfLife: parsedOverrides.overrides.halfLife?.source ?? null,
    budget: parsedOverrides.overrides.budget === undefined ? null : (parsedOverrides.overrides.budget as number),
    precision:
      parsedOverrides.overrides.precision === undefined
        ? null
        : (parsedOverrides.overrides.precision as number),
  };

  const comparison = selected.keys.map((key) => {
    const a = beforeRows.get(key as string) ?? null;
    const b = afterRows.get(key as string) ?? null;
    return {
      key: key as string,
      recorded: a,
      counterfactual: b,
      delta: {
        value: a === null || b === null ? null : b.value - a.value,
        firings: a === null || b === null ? null : b.firings - a.firings,
        armed: a === null || b === null ? null : b.armed !== a.armed,
      },
    };
  });

  if (ctx.json) {
    emitJson({
      command: 'replay',
      ref: ctx.ref,
      repo: ctx.repo,
      tip: scan.tip,
      asOf: asOf.at,
      overrides,
      eventCount: recorded.value.eventCount,
      comparison,
      recordedFirings: before.firings,
      counterfactualFirings: after.firings,
      unfolded: counterfactual.value.unfolded,
      unknownKeys: selected.unknown,
      wrote: null,
      note: 'counterfactual only — nothing was written to the ledger, the cache or .program/',
      problems: scan.problems,
      ok: !tainted && selected.unknown.length === 0,
    });
    return tainted || selected.unknown.length > 0 ? 1 : 0;
  }

  out(
    `COUNTERFACTUAL REPLAY of ${ctx.ref} · ${recorded.value.eventCount} event(s) · ` +
      `NOTHING WAS WRITTEN`,
  );
  out(
    `overrides: half_life=${overrides.halfLife ?? '(recorded)'} ` +
      `budget=${overrides.budget === null ? '(recorded)' : num(overrides.budget)} ` +
      `precision_at=${overrides.precision === null ? '(recorded, frozen per event)' : num(overrides.precision)}`,
  );
  out('');

  if (comparison.length === 0) out('(no accumulators)');
  for (const c of comparison) {
    out(c.key);
    const line = (label: string, r: AccumulatorRow | null): string =>
      r === null
        ? `  ${label.padEnd(14)} — (no knobs for this key; Q-56)`
        : `  ${label.padEnd(14)} value ${num(r.value).padStart(9)}  budget ${num(r.budget ?? 0).padStart(7)}  ` +
          `${pct(r.value, r.budget).padStart(5)}  fires ${String(r.firings).padStart(2)}  ` +
          `${r.armed ? 'armed' : 'fired'}  half-life ${r.halfLife ?? '—'}`;
    out(line('recorded', c.recorded));
    out(line('counterfactual', c.counterfactual));
    if (c.delta.value !== null) {
      const sign = c.delta.value >= 0 ? '+' : '';
      out(
        `  ${'delta'.padEnd(14)} value ${(sign + num(c.delta.value)).padStart(9)}` +
          `${c.delta.firings === 0 ? '' : `  fires ${c.delta.firings === null ? '' : (c.delta.firings > 0 ? '+' : '') + String(c.delta.firings)}`}` +
          `${c.delta.armed === true ? '  ARM STATE CHANGES' : ''}`,
      );
    }
  }

  if (counterfactual.value.unfolded.length > 0) {
    out('');
    out(unfoldedNote(counterfactual.value));
  }
  if (selected.unknown.length > 0) {
    out('');
    errOut(`no accumulator keyed ${selected.unknown.map((k) => `\`${k}\``).join(', ')} in this ledger`);
  }
  out('');
  out(
    'Nothing was written: not `events/` (INV-002), not `accumulators/` (a counterfactual cache ' +
      'would be indistinguishable from a real one), and not `.program/` (INV-001). Run ' +
      '`gwtp ledger fold --write` to materialize the RECORDED fold.',
  );
  return tainted || selected.unknown.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// `gwtp ledger status`
// ---------------------------------------------------------------------------

function statusUsage(): string {
  return [
    'gwtp ledger status — one screen: the ref, the census, what is close to firing, what fired',
    '',
    'Usage:',
    '  gwtp ledger status [--as-of <timestamp>]',
    '',
    'Options:',
    '  --as-of <timestamp>  the instant to age the meters to (default: now)',
    '  --repo <dir>         repository holding the ledger ref and `.program/` (default: cwd)',
    '  --ledger-ref <ref>   ref to summarize (default: ' + LEDGER_REF + ')',
    '  --json               machine-readable output',
    '  -h, --help           show this message',
    '',
    'Exit codes: 0 clean · 1 ledger integrity problem · 2 usage error.',
    '',
  ].join('\n');
}

async function runStatus(argv: readonly string[]): Promise<number> {
  let values: CommonValues & { 'as-of'?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: STATUS_OPTIONS,
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp ledger status: ${(e as Error).message}\n\n${statusUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(statusUsage());
    return 0;
  }

  const ctx = contextOf(values);
  const asOf = parseAsOf(values['as-of'] ?? 'now');
  if (asOf.error !== null || asOf.at === null) {
    errOut(
      `gwtp ledger status: --as-of ${asOf.error === null ? 'is unreadable' : formatContractError(asOf.error)}`,
    );
    return 2;
  }
  const at = asOf.at;
  const bad = await repoProblem(ctx);
  if (bad !== null) {
    errOut(`gwtp ledger status: ${bad}`);
    return 2;
  }

  const { scan, program } = await readLedger(ctx);
  const tainted = reportProblems(ctx, scan, 'status');
  const counts = census(scan.events);

  const result = foldEventsPerKey(scan.events, knobsResolver(program));
  if (!result.ok) {
    errOut(`gwtp ledger status: ${formatContractError(result.error)}`);
    return 1;
  }
  const report = reportOf(result.value, result.value.keys, at);
  const hot = [...report.rows]
    .filter((r) => r.percentOfBudget !== null && r.percentOfBudget >= (r.rearmFraction ?? 0.5) * 100)
    .sort((a, b) => (b.percentOfBudget ?? 0) - (a.percentOfBudget ?? 0));

  const lastFiring = report.firings.length === 0 ? null : (report.firings[report.firings.length - 1] as FiringRow);

  // Every firing counts as unanswered: the ledger records that a proposal was filed and never
  // records an answer, and "what makes a proposal stale rather than merely open" is unratified
  // (docs/spec/OPEN-QUESTIONS.md Q-55). The direction is `unrecorded` because it is: a firing
  // event keeps a dispersion snapshot, not a proposal kind (Q-57).
  const open: IgnoredProposal[] = result.value.firings.map((f) => ({
    key: f.key,
    kind: 'unrecorded' as const,
    firedAt: f.at,
    triggeredBy: f.triggeredBy,
  }));
  const debt = governanceDebt(open, at);

  if (ctx.json) {
    emitJson({
      command: 'status',
      ref: ctx.ref,
      repo: ctx.repo,
      refPresent: scan.tip !== null,
      tip: scan.tip,
      asOf: at,
      events: counts,
      tips: result.value.tips.length,
      program: { path: program.path, present: program.present, assertions: program.assertions.size },
      accumulators: report.rows,
      nearBudget: hot,
      unfolded: result.value.unfolded,
      lastFiring,
      firings: report.firings.length,
      governanceDebt: {
        asOf: debt.asOf,
        openCount: debt.openCount,
        proposalDays: debt.proposalDays,
        oldestFiredAt: debt.oldestFiredAt,
        oldestAgeDays: debt.oldestAgeDays,
        byKind: debt.byKind,
      },
      problems: scan.problems,
      ok: !tainted,
    });
    return tainted ? 1 : 0;
  }

  const summary: readonly (readonly [string, string])[] = [
    [
      'ledger',
      `${ctx.ref}  ${scan.tip === null ? 'absent (no events recorded yet)' : `present @ ${scan.tip.slice(0, 12)}`}`,
    ],
    [
      'events',
      `${counts.total} recorded · ${result.value.tips.length} tip(s) · ` +
        `${counts.violations} violation(s), ${counts.compliances} compliance(s), ` +
        `${counts.abstentions} abstention(s), of which ${counts.firingEvents} firing event(s)`,
    ],
    [
      'program',
      program.present
        ? `${displayPath(program.path)} · ${program.assertions.size} assertion(s)`
        : `${displayPath(program.path)} · absent — no knobs, so nothing folds`,
    ],
    ['as of', `${at} (committer time, ADR-0004)`],
  ];
  const labelWidth = Math.max(...summary.map(([label]) => label.length));
  for (const [label, value] of summary) out(`${label.padEnd(labelWidth)}  ${value}`);
  out('');

  const rearmPct = ((report.rows[0]?.rearmFraction ?? 0.5) * 100).toFixed(0);
  if (hot.length === 0) {
    out(`near budget: none at or above ${rearmPct}% (the re-arm fraction, spec 02 §6, Q-14)`);
  } else {
    out(`near budget (at or above ${rearmPct}%, the re-arm fraction — spec 02 §6, Q-14):`);
    out(accumulatorTable(hot));
    if (report.rows.length > hot.length) {
      out(`(${report.rows.length - hot.length} further accumulator(s) below that line)`);
    }
  }
  out('');

  if (lastFiring === null) {
    out('last firing: none — no accumulator has reached its budget in this event set');
  } else {
    out(
      `last firing: ${lastFiring.at}  ${lastFiring.key}  ` +
        `${num(lastFiring.value)} >= budget ${num(lastFiring.budget)}  ` +
        `triggered by ${shortId(lastFiring.triggeredBy)}`,
    );
  }
  out('');
  out(renderGovernanceDebtLine(debt.openCount, debt.proposalDays, debt.oldestAgeDays, debt.oldestFiredAt, at));

  if (result.value.unfolded.length > 0) {
    out('');
    out(unfoldedNote(result.value));
  }
  return tainted ? 1 : 0;
}

/**
 * `renderGovernanceDebt` in src/ledger/firing.ts is markdown for a proposal body; this is the
 * one-line form `status` prints. Same numbers, same source — `governanceDebt` computed both.
 */
function renderGovernanceDebtLine(
  openCount: number,
  proposalDays: number,
  oldestAgeDays: number,
  oldestFiredAt: CommitterTime | null,
  at: CommitterTime,
): string {
  if (openCount === 0) {
    return `governance debt: 0 proposal-days (no firing has gone unanswered as of ${at})`;
  }
  return (
    `governance debt: ${proposalDays.toFixed(1)} proposal-days across ${openCount} firing(s) ` +
    `counted as unanswered; oldest waited ${oldestAgeDays.toFixed(1)} day(s) (fired ${oldestFiredAt}). ` +
    'This meter does not decay (spec 02 §6, Q-55), and the ledger records no answer to a ' +
    'proposal, so every firing counts (Q-55) with an unrecorded direction (Q-57).'
  );
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const SUBCOMMANDS: Readonly<Record<string, { summary: string; run: (argv: readonly string[]) => Promise<number> }>> = {
  append: { summary: 'record observations on the ledger ref (append-only, idempotent)', run: runAppend },
  fold: { summary: 'recompute every accumulator from the event set', run: runFold },
  replay: { summary: 'the same fold under overridden knobs; writes nothing', run: runReplay },
  status: { summary: 'ref, census, what is near budget, last firing, governance debt', run: runStatus },
};

function usage(): string {
  const width = Math.max(...Object.keys(SUBCOMMANDS).map((n) => n.length));
  return [
    'gwtp ledger — the event-sourced ledger on ' + LEDGER_REF + ' (docs/spec/02-ledger.md)',
    '',
    'Usage:',
    '  gwtp ledger <subcommand> [options]',
    '',
    'Subcommands:',
    ...Object.entries(SUBCOMMANDS).map(([name, s]) => `  ${name.padEnd(width)}  ${s.summary}`),
    '',
    'Common options (every subcommand):',
    '  --repo <dir>         repository holding the ledger ref and `.program/` (default: cwd)',
    '  --ledger-ref <ref>   the ref to read or write (default: ' + LEDGER_REF + ')',
    '  --json               machine-readable output',
    '  -h, --help           show a subcommand\'s own options',
    '',
    'The ledger is profane: machine-append-only, content-addressed, never mutated (INV-002).',
    'Corrections supersede. The program (.program/) is sacred and no subcommand here writes it',
    '(INV-001) — a reprogramming proposal arrives as a patch a human applies.',
    '',
    'Exit codes: 0 success · 1 failure · 2 usage error.',
    '',
  ].join('\n');
}

export async function run(argv: readonly string[]): Promise<number> {
  const first = argv[0];

  if (first === undefined) {
    process.stdout.write(usage());
    return 2;
  }
  if (first === '--help' || first === '-h') {
    process.stdout.write(usage());
    return 0;
  }

  const spec = SUBCOMMANDS[first];
  if (spec === undefined) {
    errOut(`gwtp ledger: unknown subcommand \`${first}\`\n\n${usage()}`);
    return 2;
  }

  try {
    return await spec.run(argv.slice(1));
  } catch (e) {
    if (e instanceof LedgerIntegrityError) {
      errOut(`gwtp ledger ${first}: ${e.message}`);
      return 1;
    }
    if (e instanceof LedgerConcurrencyError) {
      errOut(
        `gwtp ledger ${first}: ${e.message} (gave up after ${e.attempts} attempt(s); nothing was lost — retry)`,
      );
      return 1;
    }
    errOut(`gwtp ledger ${first}: ${(e as Error).message}`);
    return 1;
  }
}
