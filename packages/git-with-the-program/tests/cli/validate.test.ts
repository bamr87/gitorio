// Implements tests for: seeds/SEED-01-scaffold.md deliverable 2 and its acceptance criterion
// — "`gwtp validate` passes on the shipped `.program/` and fails on a deliberately malformed
// assertion" — plus INV-006 ("All program and ledger artifacts validate against schemas/").
//
// The malformed fixtures assert on SPECIFIC messages, not on counts: a validator whose
// failures are unreadable is a validator nobody runs.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../../src/cli/index.js';
import {
  findSchemaDir,
  kindFromFilename,
  kindFromShape,
  loadSchemaRegistry,
  pointerGet,
  renderReports,
  run,
  validateFile,
  type FileReport,
} from '../../src/cli/commands/validate.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures');
const fixture = (name: string): string => join(FIXTURES, name);

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The acceptance criterion
// ---------------------------------------------------------------------------

describe('gwtp validate on the shipped .program/', () => {
  it('passes, exactly as the directory stands', async () => {
    expect(await run(['--root', REPO_ROOT])).toBe(0);
    expect(stdout).toContain('0 failed');
    expect(stdout.split('\n').filter((l) => l.startsWith('FAIL'))).toEqual([]);
  });

  it('reports all six files of spec 01 §2', async () => {
    await run(['--root', REPO_ROOT]);
    for (const name of [
      'manifest.yaml',
      'charter.md',
      'invariants.yaml',
      'trajectory.yaml',
      'precedents.yaml',
      'scope.yaml',
    ]) {
      expect(stdout).toContain(name);
    }
    expect(stdout).toContain('6 files');
  });

  it('skips charter.md rather than pretending to validate prose', async () => {
    await run(['--root', REPO_ROOT]);
    const line = stdout.split('\n').find((l) => l.includes('charter.md'));
    expect(line).toMatch(/^SKIP/);
    expect(line).toContain('no machine schema');
  });

  it('names the six assertions the program actually carries', async () => {
    await run(['--root', REPO_ROOT]);
    expect(stdout).toMatch(/invariants\.yaml\s+6 assertions/);
  });

  it('runs through the top-level `gwtp` command surface', async () => {
    expect(await main(['validate', '--root', REPO_ROOT])).toBe(0);
    expect(stdout).toContain('PASS');
  });

  it('accepts the program directory as a positional', async () => {
    expect(await run([join(REPO_ROOT, '.program')])).toBe(0);
    expect(stdout).toContain('6 files');
  });

  it('finds .program/ under a repository root given as a positional', async () => {
    expect(await run([REPO_ROOT])).toBe(0);
    expect(stdout).toContain('6 files');
  });
});

// ---------------------------------------------------------------------------
// The deliberately malformed assertion
// ---------------------------------------------------------------------------

describe('gwtp validate on a deliberately malformed assertion', () => {
  beforeEach(async () => {
    await run([fixture('bad-assertion.yaml')]);
  });

  it('exits nonzero', async () => {
    expect(await run([fixture('bad-assertion.yaml')])).toBe(1);
  });

  it('rejects an id outside the schema pattern', () => {
    expect(stdout).toContain('/0/id: must match pattern "^(INV|CAND)-[0-9]{3,}$"');
    expect(stdout).toContain('value: "INV-7"');
  });

  it('rejects a missing provenance twice over: the schema requires it, spec 01 §4 says why', () => {
    expect(stdout).toContain("/1/provenance: must have required property 'provenance'");
    expect(stdout).toContain('assertion `INV-901` has no provenance');
    expect(stdout).toContain('no assertion without provenance (spec 01 §4 rule 1)');
  });

  it('rejects an empty provenance list', () => {
    expect(stdout).toContain('/6/provenance: must NOT have fewer than 1 items');
    expect(stdout).toContain('assertion `INV-905` has empty provenance');
  });

  it('rejects precision above the schema maximum', () => {
    expect(stdout).toContain('/2/precision: must be <= 1');
    expect(stdout).toContain('value: 1.5');
  });

  it('rejects a budget at the exclusive minimum', () => {
    expect(stdout).toContain('/2/budget: must be > 0');
  });

  it('rejects an enforcement value outside the judgment ladder, and lists the ladder', () => {
    expect(stdout).toContain(
      '/3/enforcement: must be equal to one of the allowed values ' +
        '(allowed: deterministic | judgment | hybrid)',
    );
    expect(stdout).toContain('value: "advisory"');
  });

  it('rejects a half_life outside the duration grammar', () => {
    expect(stdout).toContain('/3/half_life: must match pattern "^[0-9]+(d|w|mo)$"');
    expect(stdout).toContain('value: "90 days"');
  });

  it('rejects a CAND-* assertion that self-ratifies, citing spec 04 §4', () => {
    expect(stdout).toContain('/4/status: must be equal to constant');
    expect(stdout).toContain('CAND-* ids may only carry `status: inferred` (spec 04 §4)');
    expect(stdout).toContain('gwtp/assertion.schema.json#/allOf/0');
  });

  it('rejects a duplicate id, which no single-document schema can see', () => {
    expect(stdout).toContain('duplicate assertion id `INV-901`, first seen at /1');
    expect(stdout).toContain('spec 01 §3');
  });

  it('tags each finding with the contract it broke', () => {
    expect(stdout).toContain('[schema] ');
    expect(stdout).toContain('[rule] ');
  });

  it('passes the positive control alongside it', async () => {
    expect(await run([fixture('valid-assertion.yaml')])).toBe(0);
    expect(stdout).toContain('2 assertions');
  });

  it('accepts a lone assertion record, not only a sequence', async () => {
    expect(await run([fixture('lone-assertion.yaml')])).toBe(0);
    expect(stdout).toContain('1 assertion');
  });
});

// ---------------------------------------------------------------------------
// The other three contracts
// ---------------------------------------------------------------------------

describe('ledger events (schemas/event.schema.json)', () => {
  it('accepts a well-formed event', async () => {
    expect(await run([fixture('valid-event.yaml')])).toBe(0);
    expect(stdout).toContain('1 event');
  });

  it('accepts an event file named by its own content hash', async () => {
    const name = '9f1323d86586e342335bdc00a7d4c260bc4ffa3f5d916ef0cfd753891341004a.yaml';
    expect(await run([join(FIXTURES, 'events', name)])).toBe(0);
    expect(stdout).toContain('1 event');
  });

  it('rejects a malformed event on every count', async () => {
    expect(await run([fixture('invalid-event.yaml')])).toBe(1);
    expect(stdout).toContain('/event: must match pattern "^sha256:[a-f0-9]{64}$"');
    expect(stdout).toContain('subject requires at least one of commit | pr | path');
    expect(stdout).toContain(
      '/severity: must be equal to one of the allowed values (allowed: 0.25 | 0.5 | 0.75 | 1)',
    );
    expect(stdout).toContain(
      '/judge/kind: must be equal to one of the allowed values ' +
        '(allowed: deterministic | model | panel | human)',
    );
    expect(stdout).toContain('/t: must match format "date-time"');
  });

  it('requires severity, precision_at and rationale on a violating verdict', async () => {
    await run([fixture('invalid-event.yaml')]);
    expect(stdout).toContain("/precision_at: must have required property 'precision_at'");
    expect(stdout).toContain("/rationale: must have required property 'rationale'");
  });

  it('reports the anyOf on subject once, not once per branch', async () => {
    await run([fixture('invalid-event.yaml')]);
    const branchLines = stdout
      .split('\n')
      .filter((l) => l.includes('/subject/') && l.includes('must have required property'));
    expect(branchLines).toEqual([]);
  });
});

describe('judge verdicts (schemas/verdict.schema.json)', () => {
  it('accepts a well-formed violation verdict', async () => {
    expect(await run([fixture('valid-verdict.yaml')])).toBe(0);
    expect(stdout).toContain('1 verdict');
  });

  it('rejects a malformed verdict', async () => {
    expect(await run([fixture('invalid-verdict.yaml')])).toBe(1);
    expect(stdout).toContain(
      '/severity: must be equal to one of the allowed values ' +
        '(allowed: grazes | bends | breach | entrenches)',
    );
    expect(stdout).toContain('/confidence: must be <= 1');
    expect(stdout).toContain('/evidence/0: must match pattern "^.+:[0-9]+(-[0-9]+)?$"');
    expect(stdout).toContain("/rationale: must have required property 'rationale'");
    expect(stdout).toContain("/precedent: must have required property 'precedent'");
  });

  it('reports the engine\'s "no citation, no verdict" finding the schema cannot make', async () => {
    await run([fixture('invalid-verdict.yaml')]);
    expect(stdout).toContain('uncited-violation: no citation, no verdict (ADR-0005, INV-004)');
  });
});

describe('precedents (schemas/precedent.schema.json)', () => {
  it('accepts well-formed case law of all three rulings', async () => {
    expect(await run([fixture('valid-precedent.yaml')])).toBe(0);
    expect(stdout).toContain('3 precedents');
  });

  it('rejects malformed case law', async () => {
    expect(await run([fixture('invalid-precedent.yaml')])).toBe(1);
    expect(stdout).toContain('/0/id: must match pattern "^PRE-[0-9]{3,}$"');
    expect(stdout).toContain(
      '/0/ruling: must be equal to one of the allowed values ' +
        '(allowed: killed | affirmed | coincidence)',
    );
    expect(stdout).toContain('/0/evidence: must NOT have fewer than 1 items');
    expect(stdout).toContain("/1/evidence: must have required property 'evidence'");
    expect(stdout).toContain('duplicate precedent id `PRE-010`');
  });
});

// ---------------------------------------------------------------------------
// The three unschema'd `.program/` files (Q-08)
// ---------------------------------------------------------------------------

describe('structural validation where no schema exists (Q-08)', () => {
  it('rejects a malformed manifest', async () => {
    expect(await run([fixture('bad-manifest.yaml')])).toBe(1);
    expect(stdout).toContain('`schema_version` is required (spec 01 §7)');
    expect(stdout).toContain('duplicate judge seat `invariant-judge`');
    expect(stdout).toContain('unknown field `epoch`');
    expect(stdout).toContain('expected ^e([0-9]+)$, got "E0"');
    expect(stdout).toContain('expected ^sha256:[a-f0-9]{64}$, got "sha256:abc"');
    expect(stdout).toContain('no schema (Q-08)');
  });

  it('rejects a malformed scope', async () => {
    expect(await run([fixture('bad-scope.yaml')])).toBe(1);
    expect(stdout).toContain('scope claim requires `path` (spec 01 §6)');
    expect(stdout).toContain('duplicate scope claim `docs/**`');
    expect(stdout).toContain('unknown field `epochs`');
    expect(stdout).toContain('glob uses syntax outside the supported subset (** * ?)');
  });

  it('rejects a malformed trajectory', async () => {
    expect(await run([fixture('bad-trajectory.yaml')])).toBe(1);
    expect(stdout).toContain('trajectory entry requires `intent` (spec 01 §6)');
    expect(stdout).toContain('`implies_obsolete` must be a sequence of path globs');
    expect(stdout).toContain('duplicate trajectory id `TRJ-002`');
    expect(stdout).toContain('expected ^TRJ-[0-9]{3,}$, got "TRJ-1"');
  });
});

// ---------------------------------------------------------------------------
// Command surface
// ---------------------------------------------------------------------------

describe('the command surface', () => {
  it('honours an explicit --schema override', async () => {
    expect(await run(['--schema', 'verdict', fixture('valid-verdict.yaml')])).toBe(0);
  });

  it('an override that contradicts the document fails it', async () => {
    expect(await run(['--schema', 'event', fixture('valid-verdict.yaml')])).toBe(1);
    expect(stdout).toContain("must have required property 'event'");
  });

  it('an override validates a document no inference could classify', async () => {
    expect(await run(['--schema', 'assertion', fixture('mystery.yaml')])).toBe(1);
    expect(stdout).toContain("must have required property 'id'");
  });

  it('rejects an unknown --schema with a usage exit code', async () => {
    expect(await run(['--schema', 'accumulator', fixture('valid-event.yaml')])).toBe(2);
    expect(stderr).toContain('unknown --schema `accumulator`');
    expect(stderr).toContain('assertion | event | verdict | precedent');
  });

  it('rejects an unknown flag with a usage exit code', async () => {
    expect(await run(['--wat'])).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  it('prints help and exits clean', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(stdout).toContain('gwtp validate');
    expect(stdout).toContain('INV-006');
    expect(stdout).toContain('Exit codes');
  });

  it('exits 2 when --root names a directory with no .program/', async () => {
    expect(await run(['--root', FIXTURES])).toBe(2);
    expect(stderr).toContain('no .program/ under');
  });

  it('fails a path that does not exist', async () => {
    expect(await run([fixture('no-such-file.yaml')])).toBe(1);
    expect(stdout).toContain('no such file');
  });

  it('fails an unparseable YAML file with a line and column, and no ASCII art', async () => {
    expect(await run([fixture('broken-event.yaml')])).toBe(1);
    expect(stdout).toContain('[yaml] line 5, col 1');
    expect(stdout).not.toContain('^\n');
  });

  it('fails a document whose contract cannot be inferred, and says what to pass', async () => {
    expect(await run([fixture('mystery.yaml')])).toBe(1);
    expect(stdout).toContain('cannot infer a contract');
    expect(stdout).toContain('--schema <assertion|event|verdict|precedent>');
  });

  it('validates several paths in one run and fails if any one fails', async () => {
    expect(await run([fixture('valid-event.yaml'), fixture('invalid-event.yaml')])).toBe(1);
    expect(stdout).toContain('1 passed, 1 failed');
  });

  it('exits 0 when every named path passes', async () => {
    expect(
      await run([
        fixture('valid-assertion.yaml'),
        fixture('valid-event.yaml'),
        fixture('valid-verdict.yaml'),
        fixture('valid-precedent.yaml'),
      ]),
    ).toBe(0);
    expect(stdout).toContain('4 files: 4 passed, 0 failed');
  });
});

// ---------------------------------------------------------------------------
// Inference and rendering, as units
// ---------------------------------------------------------------------------

describe('kind inference', () => {
  it.each([
    ['.program/invariants.yaml', 'assertion'],
    ['.program/precedents.yaml', 'precedent'],
    ['.program/manifest.yaml', 'manifest'],
    ['.program/scope.yaml', 'scope'],
    ['.program/trajectory.yaml', 'trajectory'],
    ['.program/charter.md', 'charter'],
    ['tests/fixtures/bad-assertion.yaml', 'assertion'],
    ['tests/fixtures/invalid-verdict.yaml', 'verdict'],
    [`events/${'a'.repeat(64)}.yaml`, 'event'],
    [join('some', 'events', 'anything.yaml'), 'event'],
  ])('reads %s as %s', (file, expected) => {
    expect(kindFromFilename(file)).toBe(expected);
  });

  it('gives up on a filename that names nothing', () => {
    expect(kindFromFilename('notes.yaml')).toBeNull();
  });

  it.each([
    [{ event: 'sha256:x', judge: {} }, 'event'],
    [{ ruling: 'killed', pattern: 'x' }, 'precedent'],
    [{ enforcement: 'judgment' }, 'assertion'],
    [{ verdict: 'aligned', assertion: 'INV-001' }, 'verdict'],
    [{ claims: [] }, 'scope'],
    [{ watermark: {} }, 'manifest'],
    [{ horizon: 'v0' }, 'trajectory'],
  ])('reads %o as %s', (doc, expected) => {
    expect(kindFromShape(doc)).toBe(expected);
  });

  it('infers from the first record of a sequence', () => {
    expect(kindFromShape([{ ruling: 'killed', pattern: 'x' }])).toBe('precedent');
  });

  it('gives up on a shape it does not recognise', () => {
    expect(kindFromShape({ hello: 'world' })).toBeNull();
    expect(kindFromShape('a string')).toBeNull();
    expect(kindFromShape([])).toBeNull();
  });
});

describe('pointerGet', () => {
  const doc = { a: [{ b: 1 }], 'weird/key': 2, 'tilde~key': 3 };

  it('resolves the empty pointer to the whole document', () => {
    expect(pointerGet(doc, '')).toEqual({ found: true, value: doc });
  });

  it('walks objects and arrays', () => {
    expect(pointerGet(doc, '/a/0/b')).toEqual({ found: true, value: 1 });
  });

  it('unescapes ~1 and ~0', () => {
    expect(pointerGet(doc, '/weird~1key')).toEqual({ found: true, value: 2 });
    expect(pointerGet(doc, '/tilde~0key')).toEqual({ found: true, value: 3 });
  });

  it('reports a miss rather than throwing', () => {
    expect(pointerGet(doc, '/a/9/b').found).toBe(false);
    expect(pointerGet(doc, '/nope').found).toBe(false);
    expect(pointerGet(doc, '/a/0/b/c').found).toBe(false);
  });
});

describe('renderReports', () => {
  const passing: FileReport = {
    file: '.program/scope.yaml',
    status: 'pass',
    kind: 'scope',
    detail: '5 claims',
    problems: [],
  };
  const failing: FileReport = {
    file: 'x.yaml',
    status: 'fail',
    kind: 'event',
    detail: '1 event',
    problems: [
      { origin: 'schema', at: '/t', message: 'must match format "date-time"', value: '"nope"' },
      { origin: 'engine', at: '', message: 'wrong-type: expected an object' },
    ],
  };

  it('summarises an all-pass run as PASS', () => {
    expect(renderReports([passing])).toContain('PASS  1 file: 1 passed, 0 failed, 0 skipped');
  });

  it('summarises a mixed run as FAIL and counts every bucket', () => {
    const out = renderReports([passing, failing, { ...passing, status: 'skip' }]);
    expect(out).toContain('FAIL  3 files: 1 passed, 1 failed, 1 skipped');
  });

  it('renders the pointer, the message and the offending value', () => {
    expect(renderReports([failing])).toContain(
      '[schema] /t: must match format "date-time"  value: "nope"',
    );
  });

  it('renders a document-level problem as <document>', () => {
    expect(renderReports([failing])).toContain('[engine] <document>:');
  });

  it('pads filenames so every detail starts in the same column', () => {
    const columns = renderReports([passing, failing])
      .split('\n')
      .filter((l) => /^(?:PASS|FAIL|SKIP) {2}\S/.test(l) && !/^\w{4} {2}\d+ files?:/.test(l))
      .map((l) => {
        const m = /^(?:PASS|FAIL|SKIP) {2}.*? {2}(\S.*)$/.exec(l);
        return m === null ? -1 : l.length - (m[1] ?? '').length;
      });
    expect(columns).toHaveLength(2);
    expect(new Set(columns).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Q-29: the gap between ajv and the engine, closed by a test rather than by trust
// ---------------------------------------------------------------------------

describe('schema/engine conformance (OPEN-QUESTIONS Q-29)', () => {
  const schemaDir = findSchemaDir();
  if (schemaDir === null) throw new Error('schemas/ not found');
  const registry = loadSchemaRegistry(schemaDir);

  const check = (file: string): FileReport =>
    validateFile(registry, fixture(file), file, {});

  const originsOf = (r: FileReport): Set<string> => new Set(r.problems.map((p) => p.origin));

  it('the four schemas all register and compile', () => {
    for (const name of ['assertion', 'event', 'verdict', 'precedent'] as const) {
      expect(typeof registry.validator(name)).toBe('function');
    }
  });

  it('every valid fixture satisfies BOTH validators — no divergence on the happy path', () => {
    for (const file of [
      'valid-assertion.yaml',
      'lone-assertion.yaml',
      'valid-event.yaml',
      'valid-verdict.yaml',
      'valid-precedent.yaml',
    ]) {
      expect(check(file).problems, `${file} should have no problems`).toEqual([]);
    }
  });

  it('Q-06: `evidence: []` is schema-valid but the engine rejects it (no citation, no verdict)', () => {
    const report = validateFile(registry, fixture('invalid-verdict.yaml'), 'v', {});
    const engineOnly = report.problems.filter((p) => p.origin === 'engine');
    expect(engineOnly.map((p) => p.message).join('\n')).toContain('uncited-violation');
  });

  it('Q-07: the engine reads spec 02 §2\'s own abbreviated timestamp; ajv does not', () => {
    const report = check('invalid-event.yaml');
    const t = report.problems.filter((p) => p.at === '/t');
    expect(t).toHaveLength(1);
    expect(t[0]?.origin).toBe('schema');
    expect(t[0]?.message).toContain('date-time');
  });

  it('the engine finds problems on unschema\'d files that ajv structurally cannot', () => {
    for (const file of ['bad-manifest.yaml', 'bad-scope.yaml', 'bad-trajectory.yaml']) {
      const origins = originsOf(check(file));
      expect(origins.has('schema'), `${file} has no schema to check against`).toBe(false);
      expect(origins.size, `${file} must still fail`).toBeGreaterThan(0);
    }
  });

  it('the schemas on disk are the ones the CLI compiles', () => {
    for (const name of ['assertion', 'event', 'verdict', 'precedent'] as const) {
      const raw = JSON.parse(
        readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8'),
      ) as Record<string, unknown>;
      expect(raw['$id']).toBe(`gwtp/${name}.schema.json`);
      expect(raw['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    }
  });
});
