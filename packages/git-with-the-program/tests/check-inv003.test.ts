// Implements tests for: scripts/check-inv003.ts — the deterministic INV-003 prescreen
// (.program/invariants.yaml INV-003, docs/adr/0003-judge-blindness.md, docs/spec/03-judge.md §2).
//
// Two halves, deliberately:
//   - the PURE decision procedure, driven from in-memory `SourceFile`s that never touched disk;
//   - `main()`, driven against a scratch tree, so all three EXIT CODES are exercised. A check
//     whose "could not look" path is untested is a check that can silently become "clean".

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLIND_DIRS,
  SENTENCING_MODULES,
  SENTENCING_SYMBOL_KEYS,
  SENTENCING_VALUES,
  SYMBOL_KEY_DECLARERS,
  SYMBOL_KEY_OWNER,
  findInv003Violations,
  formatInv003Violations,
  isBlindFile,
  isSentencingModule,
  main,
  normalizeSpecifier,
  parseImports,
  parseNamedBindings,
  stripComments,
  type SourceFile,
} from '../scripts/check-inv003.js';
import * as barrel from '../src/core/index.js';
import * as accumulator from '../src/core/accumulator.js';
import * as dispersion from '../src/core/dispersion.js';
import * as sentencing from '../src/core/sentencing.js';

const judge = (text: string): SourceFile => ({ path: 'src/judge/ladder.ts', text });
const evidence = (text: string): SourceFile => ({ path: 'src/evidence/assembler.ts', text });
const ledger = (text: string): SourceFile => ({ path: 'src/ledger/fold.ts', text });

// ────────────────────────────────────────────────────────────────────────────────────────
// The leak this check exists to catch
// ────────────────────────────────────────────────────────────────────────────────────────

describe('the barrel route (the leak that refuted INV-003)', () => {
  it('FAILS a judge that value-imports a declassifier from the src/core barrel', () => {
    const v = findInv003Violations([
      judge(
        "import { toAccumulatorSnapshot } from '../core/index.js';\n" +
          'export const meter = (s: never): number => toAccumulatorSnapshot(s).value;\n',
      ),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]?.code).toBe('sentencing-value-import');
    expect(v[0]?.line).toBe(1);
    expect(v[0]?.detail).toContain('toAccumulatorSnapshot');
  });

  it.each(['rawSurprise', 'toDispersionSnapshot', 'computeDispersion', 'withSentencingWarrant'])(
    'FAILS a judge that value-imports `%s` from anywhere at all',
    (name) => {
      const v = findInv003Violations([judge(`import { ${name} } from '../core/index.js';\n`)]);
      expect(v.map((x) => x.code)).toEqual(['sentencing-value-import']);
    },
  );

  it('FAILS a deep value-import of the sentencing module in every shape', () => {
    const shapes = [
      "import { revealSurprise } from '../core/sentencing.js';",
      "import * as s from '../core/sentencing.js';",
      "import s from '../core/sentencing.js';",
      "import '../core/sentencing.js';",
      "export * from '../core/sentencing.js';",
      "export { revealActor } from '../../src/core/sentencing.js';",
      "import { revealSurprise } from '../core/accumulator.js';",
      "import { computeDispersion } from '../core/dispersion.js';",
    ];
    for (const line of shapes) {
      const v = findInv003Violations([judge(line + '\n')]);
      expect(v.length, line).toBeGreaterThanOrEqual(1);
      expect(
        v.some((x) => x.code === 'sentencing-module-value-import'),
        line,
      ).toBe(true);
    }
  });

  it('FAILS a dynamic import or require of the sentencing branch', () => {
    const v = findInv003Violations([
      judge("const m = await import('../core/sentencing.js');\n"),
      evidence("const n = require('../core/accumulator.js');\n"),
    ]);
    expect(v.map((x) => x.code)).toEqual([
      'sentencing-dynamic-import',
      'sentencing-dynamic-import',
    ]);
  });

  it('FAILS a forged warrant assembled off the global symbol registry, anywhere in src/', () => {
    const key = SENTENCING_SYMBOL_KEYS[0];
    const v = findInv003Violations([
      { path: 'src/adapters/github/forge.ts', text: `const w = Symbol.for('${key}');\n` },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]?.code).toBe('forged-warrant-symbol');
    expect(v[0]?.detail).toContain(key);
  });

  it('FAILS a judge that reaches the declassifiers THROUGH the src/ledger barrel', () => {
    // The audit's exact refutation: `atFiringTime` and `describeEvidenceLocus` untaint but are
    // NOT in SENTENCING_VALUES, so before Rule 1b a judge could reach them via src/ledger/index.js
    // and the prescreen printed OK. Rule 1b draws the boundary at the ledger module itself.
    const v = findInv003Violations([
      judge(
        "import { atFiringTime, describeEvidenceLocus } from '../../ledger/index.js';\n" +
          'export const who = (l: never): string =>\n' +
          '  atFiringTime((w) => describeEvidenceLocus(l, w).actor);\n',
      ),
    ]);
    expect(v.map((x) => x.code)).toContain('blind-imports-ledger');
    expect(v[0]?.line).toBe(1);
  });

  it.each([
    "import { firingProposal } from '../../ledger/firing.js';",
    "import { resolveEvidenceLocus } from '../../ledger/sighted.js';",
    "import * as l from '../../ledger/index.js';",
    "import '../../ledger/store.js';",
    "export * from '../../ledger/index.js';",
  ])('FAILS a blind module value-importing the ledger walk: %s', (line) => {
    const v = findInv003Violations([evidence(line + '\n')]);
    expect(v.some((x) => x.code === 'blind-imports-ledger'), line).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// What must NOT fire. A prescreen with false positives gets disabled, which is a worse
// outcome than the leak.
// ────────────────────────────────────────────────────────────────────────────────────────

describe('what the prescreen deliberately allows', () => {
  it('PASSES `import type` from the sentencing branch — naming a type you cannot read', () => {
    expect(
      findInv003Violations([
        judge(
          "import type { Surprise, ActorId } from '../core/sentencing.js';\n" +
            "import type { AccumulatorState } from '../core/accumulator.js';\n",
        ),
      ]),
    ).toEqual([]);
  });

  it('PASSES a per-specifier `type` modifier mixed into a value import', () => {
    expect(
      findInv003Violations([
        judge("import { type Surprise, type ActorId } from '../core/sentencing.js';\n"),
      ]),
    ).toEqual([]);
  });

  it('PASSES the barrel for everything that is not a declassifier', () => {
    expect(
      findInv003Violations([
        judge(
          "import { decayFactor, severityWeight, shannonEntropy } from '../core/index.js';\n" +
            "import { sealEvidence } from '../core/evidence.js';\n",
        ),
      ]),
    ).toEqual([]);
  });

  it('PASSES src/ledger — the one module allowed to read authorship at firing time', () => {
    expect(
      findInv003Violations([
        ledger(
          "import { revealSurprise, withSentencingWarrant } from '../core/sentencing.js';\n" +
            "import { computeDispersion } from '../core/dispersion.js';\n",
        ),
      ]),
    ).toEqual([]);
  });

  it('PASSES a blind module that `import type`s from the ledger barrel — a named, unreadable type', () => {
    // Rule 1b forbids VALUE imports of the ledger walk, never type imports: naming EvidenceLocus
    // to describe a parameter it can never read is exactly what blindness permits.
    expect(
      findInv003Violations([
        judge(
          "import type { EvidenceLocus, Proposal } from '../../ledger/index.js';\n" +
            "import { type DispersionStats } from '../../ledger/firing.js';\n",
        ),
      ]),
    ).toEqual([]);
  });

  it('PASSES a lookalike module that is not the sentencing branch', () => {
    expect(
      findInv003Violations([
        judge(
          "import { x } from '../core/sentencing-notes.js';\n" +
            "import { y } from '../core/accumulator-cache.js';\n",
        ),
      ]),
    ).toEqual([]);
  });

  it('PASSES a COMMENT that names every banned thing — or this repo could not document itself', () => {
    const text =
      '// This judge must never import revealSurprise or toAccumulatorSnapshot, and must\n' +
      "// never call Symbol.for('gwtp.sentencing.warrant') to forge a warrant.\n" +
      '/* import { withSentencingWarrant } from "../core/sentencing.js"; */\n' +
      "import type { Surprise } from '../core/sentencing.js';\n";
    expect(findInv003Violations([judge(text)])).toEqual([]);
  });

  it('PASSES the real repository tree', async () => {
    // The regression guard on the guard: if the prescreen ever starts flagging the shipped
    // source, CI is red for a reason that has nothing to do with a leak.
    const { collectSources } = await import('../scripts/check-inv003.js');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../', import.meta.url));
    expect(findInv003Violations(collectSources(root, ['src', 'scripts']))).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// The lexer and the import reader
// ────────────────────────────────────────────────────────────────────────────────────────

describe('stripComments', () => {
  it('blanks comments to spaces and preserves every byte offset', () => {
    const src = 'const a = 1; // secret\nconst b = 2;\n';
    const out = stripComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('secret');
    expect(out).toContain('const a = 1;');
  });

  it('does not treat a // inside a string literal as a comment', () => {
    const src = "const url = 'https://example.com/x'; const z = 3;\n";
    expect(stripComments(src)).toContain('const z = 3;');
  });

  it('leaves string contents intact — that is where an import specifier lives', () => {
    expect(stripComments("import x from '../core/sentencing.js';")).toContain(
      '../core/sentencing.js',
    );
  });

  it('survives an unterminated block comment and an unterminated string', () => {
    expect(stripComments('/* never closed').trim()).toBe('');
    expect(() => stripComments("const s = 'never closed")).not.toThrow();
  });
});

describe('parseImports', () => {
  it('reads a multi-line type-only export clause without spanning statements', () => {
    const src =
      "import { a } from 'x';\n" +
      'export type {\n  Judge,\n  Verdict,\n} from ' +
      "'../core/index.js';\n";
    const records = parseImports(src);
    expect(records.map((r) => r.specifier)).toEqual(['x', '../core/index.js']);
    expect(records[1]?.typeOnly).toBe(true);
    expect(records[1]?.named.map((n) => n.name)).toEqual(['Judge', 'Verdict']);
  });

  it('does not let a bare import swallow the statement after it', () => {
    const src = "import './side-effect.js';\nexport type { X } from '../core/sentencing.js';\n";
    const records = parseImports(src);
    const sentencingRecord = records.find((r) => r.specifier.includes('sentencing'));
    expect(sentencingRecord?.typeOnly).toBe(true);
    expect(findInv003Violations([judge(src)])).toEqual([]);
  });

  it('still catches a leak that a preceding bare import would otherwise have hidden', () => {
    // The fail-open shape: the lazy clause of the first `import` used to consume the second
    // statement whole, and a skipped statement is a MISSED violation.
    const src =
      "import './side-effect.js';\n" +
      "import { revealSurprise } from '../core/sentencing.js';\n";
    const v = findInv003Violations([judge(src)]);
    expect(v.map((x) => x.code)).toContain('sentencing-module-value-import');
    expect(v.some((x) => x.line === 2)).toBe(true);
  });

  it('reports the line of the KEYWORD, not of the newline before it', () => {
    const src = "const a = 1;\n\nimport { b } from 'y';\n";
    expect(parseImports(src)[0]?.line).toBe(3);
  });

  it('resolves aliases to the imported name, not the local one', () => {
    expect(parseNamedBindings('revealSurprise as peek', false)).toEqual([
      { name: 'revealSurprise', typeOnly: false },
    ]);
    expect(
      findInv003Violations([
        judge("import { revealSurprise as peek } from '../core/index.js';\n"),
      ]),
    ).toHaveLength(1);
  });

  it('marks default and namespace imports as whole-module', () => {
    expect(parseImports("import s from 'x';")[0]?.wholeModule).toBe(true);
    expect(parseImports("import * as s from 'x';")[0]?.wholeModule).toBe(true);
    expect(parseImports("import { s } from 'x';")[0]?.wholeModule).toBe(false);
    expect(parseImports("import type * as s from 'x';")[0]?.wholeModule).toBe(false);
  });
});

describe('specifier and path scoping', () => {
  it('normalizes extensions and query strings away', () => {
    expect(normalizeSpecifier('../core/sentencing.js')).toBe('../core/sentencing');
    expect(normalizeSpecifier('../core/sentencing.ts?raw')).toBe('../core/sentencing');
    expect(normalizeSpecifier('..\\core\\sentencing.mjs')).toBe('../core/sentencing');
  });

  it('matches the sentencing modules on a path boundary only', () => {
    for (const m of SENTENCING_MODULES) {
      expect(isSentencingModule(`../${m}.js`)).toBe(true);
      expect(isSentencingModule(m)).toBe(true);
      expect(isSentencingModule(`../my-${m}.js`)).toBe(false);
      expect(isSentencingModule(`../${m}-cache.js`)).toBe(false);
    }
  });

  it('claims exactly the two blind directories', () => {
    expect(BLIND_DIRS).toEqual(['src/judge/', 'src/evidence/']);
    expect(isBlindFile('src/judge/index.ts')).toBe(true);
    expect(isBlindFile('src/evidence/assembler.ts')).toBe(true);
    expect(isBlindFile('./src/judge/index.ts')).toBe(true);
    expect(isBlindFile('src/ledger/fold.ts')).toBe(false);
    expect(isBlindFile('src/core/sentencing.ts')).toBe(false);
    expect(isBlindFile('tests/core/judge.test.ts')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// The rule list must not drift from the thing it is protecting
// ────────────────────────────────────────────────────────────────────────────────────────

describe('SENTENCING_VALUES is kept honest', () => {
  it('names only values that actually exist in the sentencing branch', () => {
    const deep = new Set([
      ...Object.keys(sentencing),
      ...Object.keys(accumulator),
      ...Object.keys(dispersion),
    ]);
    for (const name of SENTENCING_VALUES) {
      expect(deep.has(name), `${name} is banned but does not exist`).toBe(true);
    }
  });

  it('names nothing the barrel still exports — the two lists cannot disagree', () => {
    const reachable = new Set(Object.keys(barrel));
    for (const name of SENTENCING_VALUES) {
      expect(reachable.has(name), `${name} is banned yet reachable from src/core/index.js`).toBe(
        false,
      );
    }
  });

  it('covers every declassifier by arity — none of them mints its own warrant', () => {
    expect(SENTENCING_VALUES).toContain('toAccumulatorSnapshot');
    expect(SENTENCING_VALUES).toContain('rawSurprise');
    expect(SENTENCING_VALUES).toContain('computeDispersion');
    expect(SENTENCING_VALUES).toContain('toDispersionSnapshot');
  });

  it('exempts the symbol-key owner and the check itself, and nothing else', () => {
    expect(SYMBOL_KEY_DECLARERS).toContain(SYMBOL_KEY_OWNER);
    expect(SYMBOL_KEY_DECLARERS).toContain('scripts/check-inv003.ts');
    expect(SYMBOL_KEY_DECLARERS).toHaveLength(2);
    const key = SENTENCING_SYMBOL_KEYS[0];
    expect(
      findInv003Violations([{ path: SYMBOL_KEY_OWNER, text: `Symbol.for('${key}')` }]),
    ).toEqual([]);
  });

  it('does not let the shorter registry key fire on the longer one', () => {
    const v = findInv003Violations([
      { path: 'src/core/blindness.ts', text: "Symbol.for('gwtp.sentencing.warrant')\n" },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]?.detail).toContain('gwtp.sentencing.warrant');
  });
});

describe('formatInv003Violations', () => {
  it('names the file, the line, the rule and the offending source', () => {
    const report = formatInv003Violations(
      findInv003Violations([judge("import { revealSurprise } from '../core/sentencing.js';\n")]),
    );
    expect(report).toContain('src/judge/ladder.ts:1');
    expect(report).toContain('sentencing-module-value-import');
    expect(report).toContain('revealSurprise');
  });

  it('is empty when there is nothing to report', () => {
    expect(formatInv003Violations([])).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// main() and the exit-code contract: 0 clean · 1 violated · 2 could not look
// ────────────────────────────────────────────────────────────────────────────────────────

describe('main() exit codes', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gwtp-inv003-'));
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  const write = (rel: string, text: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  };

  const scaffold = (): void => {
    write('src/judge/index.ts', "export type { Verdict } from '../core/index.js';\n");
    write('src/evidence/index.ts', "import type { Surprise } from '../core/sentencing.js';\n");
    write('src/core/sentencing.ts', 'export const x = 1;\n');
    write('scripts/noop.ts', 'export const y = 2;\n');
  };

  it('exits 0 on a clean tree, and says what it looked at', () => {
    scaffold();
    expect(main([], root)).toBe(0);
    expect(out.join('')).toContain('INV-003 prescreen OK');
    expect(out.join('')).toContain('2 file(s) under src/judge/, src/evidence/');
  });

  it('exits 1 on a value import, and reports the offending line on stderr', () => {
    scaffold();
    write('src/judge/leak.ts', "import { revealSurprise } from '../core/sentencing.js';\n");
    expect(main([], root)).toBe(1);
    expect(err.join('')).toContain('INV-003 PRESCREEN VIOLATED');
    expect(err.join('')).toContain('src/judge/leak.ts:1');
    expect(out.join('')).not.toContain('OK');
  });

  it('exits 2 when src/ does not exist — "could not look" is never "clean"', () => {
    expect(main([], root)).toBe(2);
    expect(err.join('')).toContain('is not a directory');
    expect(out.join('')).toBe('');
  });

  it('exits 2 when the blind directories are empty — a scan of nothing has not passed', () => {
    write('src/core/sentencing.ts', 'export const x = 1;\n');
    write('scripts/noop.ts', 'export const y = 2;\n');
    expect(main([], root)).toBe(2);
    expect(err.join('')).toContain('failed to look');
  });

  it('exits 2 on an unparseable flag rather than assuming defaults', () => {
    scaffold();
    expect(main(['--nonsense'], root)).toBe(2);
    expect(err.join('')).toContain('check-inv003:');
  });

  it('exits 0 for --help without scanning anything', () => {
    expect(main(['--help'], root)).toBe(0);
    expect(out.join('')).toContain('Exit codes:');
  });

  it('honours --root', () => {
    scaffold();
    expect(main(['--root', root], process.cwd())).toBe(0);
  });
});
