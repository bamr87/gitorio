// Implements: seeds/SEED-01-scaffold.md deliverable 2 and INV-006 ("All program and ledger
// artifacts validate against schemas/ in CI"), against docs/spec/01-core-memory.md §2
// (`.program/` layout), §6 (trajectory and scope) and §7 (manifest), and
// docs/spec/02-ledger.md §2 (the observation record).
//
// THREE PASSES, ON PURPOSE (docs/spec/OPEN-QUESTIONS.md Q-29).
//
//   [schema] ajv (draft-07) + ajv-formats against schemas/*.schema.json. AUTHORITATIVE for
//            INV-006: this is the check the invariant literally names.
//   [rule]   the cross-entry and structural rules draft-07 cannot state, from
//            src/core/validate.ts: ids unique within a file (spec 01 §3), no assertion
//            without provenance (spec 01 §4 rule 1), CAND-* may only be `inferred`
//            (spec 04 §4), and the whole of manifest.yaml / scope.yaml / trajectory.yaml,
//            which no schema binds at all (Q-08).
//   [engine] the hand-written decoders in src/core. A file can satisfy the JSON Schema and
//            still be unreadable by the engine — schemas/verdict.schema.json permits
//            `evidence: []` (Q-06) and schemas/event.schema.json puts no pattern on
//            `rationale` (Q-05). Reporting only the schema pass would let those land green
//            and fail at fold time; reporting only the engine pass would quietly redefine
//            INV-006.
//
// All three run on every file. [engine] lines are suppressed where [schema] or [rule] already
// named the same field — that pair is mostly redundant. [rule] lines are never suppressed:
// they are the ones that quote the spec at the human reading the failure, where ajv can only
// say `must have required property`.
//
// ajv, the filesystem and YAML all stop here: src/core stays dependency-free and
// forge-agnostic (INV-005). The command is READ-ONLY and writes nothing to .program/ (INV-001).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { Ajv, type AnySchemaObject, type ErrorObject, type ValidateFunction } from 'ajv';
// ajv-formats is CommonJS with `module.exports = formatsPlugin` AND `exports.default =
// formatsPlugin`. Under NodeNext, TypeScript models the default import as the whole
// `module.exports` namespace while Node hands back the function itself; `.default.default` is
// the one spelling correct in both, because the plugin is its own `.default`.
import * as ajvFormats from 'ajv-formats';
import { parseDocument } from 'yaml';

import { decodeAssertion } from '../../core/assertion.js';
import { decodeLedgerEvent } from '../../core/event.js';
import { decodePrecedent } from '../../core/precedent.js';
import type { ContractError } from '../../core/result.js';
import {
  type DocumentFindings,
  validateInvariantsDocument,
  validateManifestDocument,
  validatePrecedentsDocument,
  validateScopeDocument,
  validateTrajectoryDocument,
} from '../../core/validate.js';
import { decodeVerdict } from '../../core/verdict.js';

const addFormats = ajvFormats.default.default;

// ---------------------------------------------------------------------------
// The four binding contracts, and the artifact kinds that map onto them
// ---------------------------------------------------------------------------

/** Mirrors src/core/index.ts SCHEMA_ID: exactly four schemas exist and no more (Q-08). */
export const SCHEMA_NAMES = ['assertion', 'event', 'verdict', 'precedent'] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

const SCHEMA_ID: Readonly<Record<SchemaName, string>> = {
  assertion: 'gwtp/assertion.schema.json',
  event: 'gwtp/event.schema.json',
  verdict: 'gwtp/verdict.schema.json',
  precedent: 'gwtp/precedent.schema.json',
};

/** `charter` is prose; the three unschema'd files get structural validation instead (Q-08). */
export type ArtifactKind = SchemaName | 'manifest' | 'scope' | 'trajectory' | 'charter';

export function isSchemaName(s: string): s is SchemaName {
  return (SCHEMA_NAMES as readonly string[]).includes(s);
}

/** The six files of spec 01 §2, in the order the spec lists them. */
const PROGRAM_FILES: readonly (readonly [file: string, kind: ArtifactKind])[] = [
  ['manifest.yaml', 'manifest'],
  ['charter.md', 'charter'],
  ['invariants.yaml', 'assertion'],
  ['trajectory.yaml', 'trajectory'],
  ['precedents.yaml', 'precedent'],
  ['scope.yaml', 'scope'],
];

// ---------------------------------------------------------------------------
// Locating schemas/ — works from src/ under tsx and from dist/ after a build
// ---------------------------------------------------------------------------

const SCHEMA_PROBE = join('schemas', 'assertion.schema.json');

function ascendFor(start: string, probe: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, probe))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findSchemaDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = ascendFor(here, SCHEMA_PROBE) ?? ascendFor(process.cwd(), SCHEMA_PROBE);
  return root === null ? null : join(root, 'schemas');
}

// ---------------------------------------------------------------------------
// The ajv registry
// ---------------------------------------------------------------------------

export interface SchemaRegistry {
  readonly validator: (name: SchemaName) => ValidateFunction;
}

export function loadSchemaRegistry(schemaDir: string): SchemaRegistry {
  const ajv = new Ajv({
    allErrors: true, // one pass reports every problem in the file (src/core/result.ts)
    strict: false, // the shipped schemas are plain draft-07, not ajv-flavoured
    allowUnionTypes: true, // event.supersedes and verdict.precedent are ["string", "null"]
    validateFormats: true, // event.t is `format: date-time`
  });
  addFormats(ajv);

  for (const name of SCHEMA_NAMES) {
    const file = join(schemaDir, `${name}.schema.json`);
    const schema = JSON.parse(readFileSync(file, 'utf8')) as AnySchemaObject;
    ajv.addSchema(schema); // keyed by its own $id, e.g. gwtp/assertion.schema.json
  }

  const compiled = new Map<SchemaName, ValidateFunction>();
  return {
    validator(name) {
      const cached = compiled.get(name);
      if (cached !== undefined) return cached;
      const fn = ajv.getSchema(SCHEMA_ID[name]);
      if (fn === undefined) {
        throw new Error(`${SCHEMA_ID[name]} did not register (is its $id intact?)`);
      }
      compiled.set(name, fn);
      return fn;
    },
  };
}

// ---------------------------------------------------------------------------
// Kind inference: filename first, then shape
// ---------------------------------------------------------------------------

const EVENT_FILENAME = /^[0-9a-f]{64}$/;

/** `.program/invariants.yaml` -> assertion; `events/<64-hex>.yaml` -> event; and so on. */
export function kindFromFilename(file: string): ArtifactKind | null {
  const stem = basename(file, extname(file)).toLowerCase();
  if (EVENT_FILENAME.test(stem)) return 'event';
  if (dirname(file).split(sep).includes('events')) return 'event';

  if (stem.endsWith('manifest')) return 'manifest';
  if (stem.endsWith('scope')) return 'scope';
  if (stem.endsWith('trajectory')) return 'trajectory';
  if (stem.endsWith('charter')) return 'charter';

  if (stem.includes('invariant') || stem.includes('assertion')) return 'assertion';
  if (stem.includes('precedent')) return 'precedent';
  if (stem.includes('verdict')) return 'verdict';
  if (stem.includes('event')) return 'event';
  return null;
}

/**
 * Shape inference for a document whose filename says nothing. Ordered most-discriminating
 * first: only a ledger event carries a content hash of itself alongside a judge, `ruling` is
 * unique to precedents, and only an assertion carries the accumulator knobs.
 */
export function kindFromShape(doc: unknown): ArtifactKind | null {
  const record = Array.isArray(doc) ? doc.find((d) => d !== null && typeof d === 'object') : doc;
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const r = record as Record<string, unknown>;

  if ('event' in r && 'judge' in r) return 'event';
  if ('ruling' in r && 'pattern' in r) return 'precedent';
  if ('enforcement' in r || 'half_life' in r || 'precision' in r) return 'assertion';
  if ('verdict' in r && 'assertion' in r) return 'verdict';
  if ('claims' in r) return 'scope';
  if ('watermark' in r || 'schema_version' in r) return 'manifest';
  if ('implies_obsolete' in r || 'horizon' in r) return 'trajectory';
  return null;
}

// ---------------------------------------------------------------------------
// Problems and reports
// ---------------------------------------------------------------------------

export type ProblemOrigin = 'schema' | 'rule' | 'engine' | 'yaml' | 'io';

export interface Problem {
  readonly origin: ProblemOrigin;
  /** RFC 6901-shaped pointer into the document, e.g. `/2/provenance`. */
  readonly at: string;
  readonly message: string;
  /** The offending value, rendered, when the pointer resolves to one. */
  readonly value?: string;
  readonly clause?: string;
}

export interface FileReport {
  readonly file: string;
  readonly status: 'pass' | 'fail' | 'skip';
  readonly kind: ArtifactKind | null;
  readonly detail: string;
  readonly problems: readonly Problem[];
}

const MAX_VALUE_CHARS = 120;

function renderValue(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS - 1)}…` : s;
}

/** RFC 6901 resolution, so every reported problem can show the value it is about. */
export function pointerGet(doc: unknown, pointer: string): { found: boolean; value: unknown } {
  if (pointer === '') return { found: true, value: doc };
  let cur: unknown = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return { found: false, value: undefined };
      cur = cur[i];
      continue;
    }
    if (cur !== null && typeof cur === 'object') {
      const rec = cur as Record<string, unknown>;
      // Own keys only. `'constructor' in rec` is true for every object alive, which would
      // make `pointerGet(doc, '/constructor')` report a native function as the offending value.
      if (!Object.hasOwn(rec, seg)) return { found: false, value: undefined };
      cur = rec[seg];
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: cur };
}

/**
 * Two classes of ajv error are dropped as noise rather than signal:
 *   - `keyword: 'if'`, emitted alongside the `then` sub-errors it has already reported;
 *     `must match "then" schema` names no field a human can act on.
 *   - the per-branch failures under an `anyOf`. `subject: {}` fails all three branches of
 *     event.schema.json#/properties/subject/anyOf, and reporting "must have required property
 *     'commit'", "'pr'" and "'path'" as three separate demands inverts the meaning. The
 *     surviving `anyOf` error says it once, correctly.
 */
function renderAjvError(e: ErrorObject, doc: unknown, prefix: string): Problem | null {
  if (e.keyword === 'if') return null;
  if (e.keyword !== 'anyOf' && e.schemaPath.includes('/anyOf/')) return null;

  let at = `${prefix}${e.instancePath}`;
  let message = e.message ?? 'failed validation';
  let showValue = true;

  if (e.keyword === 'required') {
    const missing = (e.params as { missingProperty?: string }).missingProperty;
    if (missing !== undefined) {
      at = `${at}/${missing}`;
      showValue = false;
    }
  } else if (e.keyword === 'additionalProperties') {
    const extra = (e.params as { additionalProperty?: string }).additionalProperty;
    if (extra !== undefined) at = `${at}/${extra}`;
  } else if (e.keyword === 'enum') {
    const allowed = (e.params as { allowedValues?: readonly unknown[] }).allowedValues;
    if (allowed !== undefined) message = `${message} (allowed: ${allowed.map(String).join(' | ')})`;
  } else if (e.keyword === 'anyOf') {
    message = `${message} — subject requires at least one of commit | pr | path`;
  }

  const resolved = showValue ? pointerGet(doc, at) : { found: false, value: undefined };
  return {
    origin: 'schema',
    at,
    message,
    ...(resolved.found ? { value: renderValue(resolved.value) } : {}),
    clause: e.schemaPath,
  };
}

function renderContractError(
  e: ContractError,
  doc: unknown,
  origin: 'rule' | 'engine',
): Problem {
  const at = e.at ?? '';
  const resolved = pointerGet(doc, at);
  return {
    origin,
    at,
    message: `${e.code}: ${e.message}`,
    ...(resolved.found ? { value: renderValue(resolved.value) } : {}),
    ...(e.clause !== undefined ? { clause: e.clause } : {}),
  };
}

/**
 * The decoder pass is dropped wherever the schema pass or the rule pass already named the
 * field: `invalid-id: expected ^PRE-[0-9]{3,}$` beside `must match pattern "^PRE-[0-9]{3,}$"`
 * teaches people to skim. Nothing else is suppressed — an engine-only finding is precisely
 * the case the second and third passes exist for.
 */
function assembleProblems(
  schema: readonly Problem[],
  rules: readonly Problem[],
  engine: readonly Problem[],
): Problem[] {
  const covered = new Set([...schema, ...rules].map((p) => p.at));
  return [...schema, ...rules, ...engine.filter((p) => !covered.has(p.at))];
}

// ---------------------------------------------------------------------------
// The two passes
// ---------------------------------------------------------------------------

/** ajv, per record. A YAML sequence is validated entry by entry so pointers read `/3/id`. */
function schemaProblems(registry: SchemaRegistry, name: SchemaName, doc: unknown): readonly Problem[] {
  const validate = registry.validator(name);
  const check = (data: unknown, prefix: string): Problem[] => {
    if (validate(data) === true) return [];
    return (validate.errors ?? [])
      .map((e) => renderAjvError(e, doc, prefix))
      .filter((p): p is Problem => p !== null);
  };

  if (!Array.isArray(doc)) return check(doc, '');
  const out: Problem[] = [];
  doc.forEach((entry, i) => out.push(...check(entry, `/${i}`)));
  return out;
}

function decodeErrors(name: SchemaName, raw: unknown, at: string): readonly ContractError[] {
  switch (name) {
    case 'assertion': {
      const r = decodeAssertion(raw, at);
      return r.ok ? [] : r.error;
    }
    case 'event': {
      const r = decodeLedgerEvent(raw, at);
      return r.ok ? [] : r.error;
    }
    case 'verdict': {
      const r = decodeVerdict(raw, at);
      return r.ok ? [] : r.error;
    }
    case 'precedent': {
      const r = decodePrecedent(raw, at);
      return r.ok ? [] : r.error;
    }
  }
}

/**
 * The rule and decoder passes over a schema'd artifact. For `assertion` and `precedent`
 * SEQUENCES this routes through src/core/validate.ts, which adds the cross-entry rules
 * draft-07 cannot express: ids unique within the file (spec 01 §3), no assertion without
 * provenance (spec 01 §4 rule 1), and CAND-* may only be `inferred` (spec 04 §4). A lone
 * record — an event file, or `--schema assertion` on a single document — has no cross-entry
 * rules to break, so it gets the decoder alone.
 */
function coreFindings(name: SchemaName, doc: unknown): DocumentFindings {
  const isSequence = Array.isArray(doc) || doc === null || doc === undefined;
  if (isSequence && name === 'assertion') return validateInvariantsDocument(doc, '');
  if (isSequence && name === 'precedent') return validatePrecedentsDocument(doc, '');
  if (Array.isArray(doc)) {
    const decoder: ContractError[] = [];
    doc.forEach((entry, i) => decoder.push(...decodeErrors(name, entry, `/${i}`)));
    return { rules: [], decoder };
  }
  return { rules: [], decoder: decodeErrors(name, doc, '') };
}

function structuralFindings(kind: 'manifest' | 'scope' | 'trajectory', doc: unknown): DocumentFindings {
  if (kind === 'manifest') return validateManifestDocument(doc, '');
  if (kind === 'scope') return validateScopeDocument(doc, '');
  return validateTrajectoryDocument(doc, '');
}

// ---------------------------------------------------------------------------
// Validating one file
// ---------------------------------------------------------------------------

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function ioProblem(message: string): Problem {
  return { origin: 'io', at: '', message };
}

function claimCount(doc: unknown): number {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return 0;
  const claims = (doc as Record<string, unknown>)['claims'];
  return Array.isArray(claims) ? claims.length : 0;
}

export interface ValidateFileOptions {
  /** Forces the contract, bypassing filename and shape inference (`--schema`). */
  readonly forceSchema?: SchemaName | undefined;
  /** Set for the six files walked out of a `.program/` directory. */
  readonly programFile?: boolean | undefined;
  readonly kindHint?: ArtifactKind | undefined;
}

export function validateFile(
  registry: SchemaRegistry,
  file: string,
  displayPath: string,
  options: ValidateFileOptions = {},
): FileReport {
  const fail = (
    problems: readonly Problem[],
    kind: ArtifactKind | null,
    detail: string,
  ): FileReport => ({ file: displayPath, status: 'fail', kind, detail, problems });

  if (!existsSync(file)) {
    return fail(
      [
        ioProblem(
          options.programFile === true
            ? 'absent — spec 01 §2 lists this file in the `.program/` layout'
            : 'no such file',
        ),
      ],
      options.kindHint ?? null,
      'unreadable',
    );
  }

  const kind = options.forceSchema ?? options.kindHint ?? kindFromFilename(file);

  if (kind === 'charter') {
    return {
      file: displayPath,
      status: 'skip',
      kind,
      detail: 'prose — ratified by humans, no machine schema (spec 01 §2)',
      problems: [],
    };
  }

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return fail([ioProblem(`unreadable: ${(e as Error).message}`)], kind, 'unreadable');
  }

  // `prettyErrors` (the default) is what populates `linePos`; a governance file that will not
  // parse deserves a line and column, not just a complaint.
  const parsed = parseDocument(text, { prettyErrors: true });
  if (parsed.errors.length > 0) {
    return fail(
      parsed.errors.map((e) => ({
        origin: 'yaml' as const,
        at: e.linePos === undefined ? '' : `line ${e.linePos[0].line}, col ${e.linePos[0].col}`,
        // `prettyErrors` appends the offending source excerpt and a caret to `message`. The
        // position is already in `at`, so keep the sentence and drop the ASCII art.
        message: (e.message.split('\n')[0] ?? e.message).replace(
          / at line \d+, column \d+:?$/,
          '',
        ),
      })),
      kind,
      'unparseable YAML',
    );
  }
  const doc: unknown = parsed.toJS();

  const resolvedKind = kind ?? kindFromShape(doc);
  if (resolvedKind === null) {
    return fail(
      [
        ioProblem(
          'cannot infer a contract from the filename or the document shape; pass ' +
            `--schema <${SCHEMA_NAMES.join('|')}>`,
        ),
      ],
      null,
      'unknown artifact',
    );
  }

  let problems: readonly Problem[];
  let detail: string;

  if (resolvedKind === 'manifest' || resolvedKind === 'scope' || resolvedKind === 'trajectory') {
    const findings = structuralFindings(resolvedKind, doc);
    problems = assembleProblems(
      [],
      findings.rules.map((e) => renderContractError(e, doc, 'rule')),
      findings.decoder.map((e) => renderContractError(e, doc, 'engine')),
    );
    detail =
      resolvedKind === 'manifest'
        ? 'manifest — structural, no schema (Q-08)'
        : resolvedKind === 'scope'
          ? `scope — structural, no schema (Q-08); ${pluralize(claimCount(doc), 'claim')}`
          : `trajectory — structural, no schema (Q-08); ${pluralize(
              Array.isArray(doc) ? doc.length : 0,
              'intent',
            )}`;
  } else if (resolvedKind === 'charter') {
    problems = []; // unreachable: handled before the file is read
    detail = 'prose';
  } else {
    const findings = coreFindings(resolvedKind, doc);
    problems = assembleProblems(
      schemaProblems(registry, resolvedKind, doc),
      findings.rules.map((e) => renderContractError(e, doc, 'rule')),
      findings.decoder.map((e) => renderContractError(e, doc, 'engine')),
    );
    detail = pluralize(Array.isArray(doc) ? doc.length : doc === null ? 0 : 1, resolvedKind);
  }

  return {
    file: displayPath,
    status: problems.length > 0 ? 'fail' : 'pass',
    kind: resolvedKind,
    detail,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Rendering the run
// ---------------------------------------------------------------------------

const STATUS_LABEL: Readonly<Record<FileReport['status'], string>> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

export function renderReports(reports: readonly FileReport[]): string {
  const width = Math.max(0, ...reports.map((r) => r.file.length));
  const lines: string[] = [];

  for (const r of reports) {
    const detail =
      r.problems.length === 0 ? r.detail : `${r.detail}, ${pluralize(r.problems.length, 'problem')}`;
    lines.push(`${STATUS_LABEL[r.status]}  ${r.file.padEnd(width)}  ${detail}`);
    for (const p of r.problems) {
      const where = p.at === '' ? '<document>' : p.at;
      const value = p.value === undefined ? '' : `  value: ${p.value}`;
      lines.push(`        [${p.origin}] ${where}: ${p.message}${value}`);
      if (p.clause !== undefined) lines.push(`                 clause: ${p.clause}`);
    }
  }

  const passed = reports.filter((r) => r.status === 'pass').length;
  const failed = reports.filter((r) => r.status === 'fail').length;
  const skipped = reports.filter((r) => r.status === 'skip').length;
  lines.push('');
  lines.push(
    `${failed === 0 ? 'PASS' : 'FAIL'}  ${pluralize(reports.length, 'file')}: ` +
      `${passed} passed, ${failed} failed, ${skipped} skipped`,
  );
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  root: { type: 'string' },
  schema: { type: 'string' },
} as const;

function usage(): string {
  return [
    'gwtp validate — schema conformance for the program and the ledger (INV-006)',
    '',
    'Usage:',
    '  gwtp validate                 validate the whole .program/ directory',
    '  gwtp validate <path...>       validate specific files, or a program directory',
    '',
    'Options:',
    '  --root <dir>                  repository root holding .program/ (default: cwd)',
    `  --schema <${SCHEMA_NAMES.join('|')}>`,
    '                                force a contract instead of inferring it from the',
    '                                filename or the document shape',
    '  -h, --help                    show this message',
    '',
    'Every artifact is checked three ways. [schema] is ajv against schemas/*.schema.json and',
    'is authoritative for INV-006. [rule] is the cross-entry and structural law draft-07',
    'cannot state — unique ids, mandatory provenance, and the whole of manifest.yaml,',
    'scope.yaml and trajectory.yaml, which no schema binds (Q-08). [engine] is the src/core',
    'decoder, which is stricter in the three places OPEN-QUESTIONS records.',
    '',
    'Exit codes: 0 all pass · 1 any failure · 2 usage error.',
    '',
  ].join('\n');
}

function displayFor(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? file : rel;
}

/** A positional naming a directory validates as a program store — `.program/` if it has one. */
function programDirOf(target: string): string | null {
  if (!existsSync(target) || !statSync(target).isDirectory()) return null;
  const nested = join(target, '.program');
  return existsSync(nested) && statSync(nested).isDirectory() ? nested : target;
}

function validateProgramDir(registry: SchemaRegistry, dir: string): FileReport[] {
  return PROGRAM_FILES.map(([name, kind]) => {
    const file = join(dir, name);
    return validateFile(registry, file, displayFor(file), { kindHint: kind, programFile: true });
  });
}

export async function run(argv: readonly string[]): Promise<number> {
  let values: { help?: boolean | undefined; root?: string | undefined; schema?: string | undefined };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`gwtp validate: ${(e as Error).message}\n\n${usage()}`);
    return 2;
  }

  if (values.help === true) {
    process.stdout.write(usage());
    return 0;
  }

  let forceSchema: SchemaName | undefined;
  if (values.schema !== undefined) {
    if (!isSchemaName(values.schema)) {
      process.stderr.write(
        `gwtp validate: unknown --schema \`${values.schema}\`; expected one of ` +
          `${SCHEMA_NAMES.join(' | ')}\n`,
      );
      return 2;
    }
    forceSchema = values.schema;
  }

  const schemaDir = findSchemaDir();
  if (schemaDir === null) {
    process.stderr.write(
      'gwtp validate: cannot locate schemas/ — no ancestor of this module or of the working ' +
        `directory contains ${SCHEMA_PROBE}\n`,
    );
    return 2;
  }

  let registry: SchemaRegistry;
  try {
    registry = loadSchemaRegistry(schemaDir);
  } catch (e) {
    process.stderr.write(`gwtp validate: ${schemaDir} did not load: ${(e as Error).message}\n`);
    return 2;
  }

  const reports: FileReport[] = [];

  if (positionals.length === 0) {
    const root = resolve(values.root ?? process.cwd());
    const dir = join(root, '.program');
    if (!existsSync(dir)) {
      process.stderr.write(
        `gwtp validate: no .program/ under ${root} — pass --root <dir> or name files explicitly\n`,
      );
      return 2;
    }
    reports.push(...validateProgramDir(registry, dir));
  } else {
    for (const positional of positionals) {
      const target = resolve(positional);
      const dir = programDirOf(target);
      if (dir !== null) {
        reports.push(...validateProgramDir(registry, dir));
        continue;
      }
      reports.push(validateFile(registry, target, displayFor(target), { forceSchema }));
    }
  }

  process.stdout.write(renderReports(reports));
  return reports.some((r) => r.status === 'fail') ? 1 : 0;
}
