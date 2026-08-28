// Implements tests for: docs/spec/05-nexus.md §3 P2-P4 (the v0 TypeScript/JavaScript
// extractor) and the blanking lexer it stands on (src/nexus/lex.ts). The lexer cases are the
// load-bearing ones: this repository's own sources are full of regex literals containing
// braces and comments containing the word `import`, and a lexer that misreads either would
// corrupt spans or mint false edges over the very tree the framework governs (spec 05 §1.4:
// deterministic, or it is a defect — and §2: a graph that is sometimes silent, never wrong).

import { describe, expect, it } from 'vitest';

import { blankSource, lineOfOffset, lineStartOffsets } from '../../src/nexus/lex.js';
import { extractModule } from '../../src/nexus/extract.js';

// ---------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------

describe('blankSource', () => {
  it('preserves length and newlines exactly, whatever it blanks', () => {
    const src = `const a = 'x{y}';\n/* {{{ */\nconst b = \`t\${a}u\`; // }}}\n`;
    const out = blankSource(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('blanks braces inside strings, comments and templates so depth counting is safe', () => {
    const src = `function f() {\n  const s = '}}}';\n  // }\n  /* } */\n  const t = \`}\`;\n  return s + t;\n}\n`;
    const out = blankSource(src);
    const opens = (out.match(/\{/g) ?? []).length;
    const closes = (out.match(/\}/g) ?? []).length;
    expect(opens).toBe(1);
    expect(closes).toBe(1);
  });

  it('blanks regex literals — including braces and quotes inside them', () => {
    // The exact shape src/core and the judges use constantly.
    const src = `const CLAUSE_OK = /^[\\sA-Za-z_$0-9{},*]*$/;\nconst Q = /don't{2}/;\nfunction g() { return 1; }\n`;
    const out = blankSource(src);
    expect(out).not.toContain('{},*');
    expect(out).not.toContain("don't");
    // The function's own braces survive.
    expect(out).toContain('{ return 1; }');
  });

  it('keeps division as division', () => {
    const src = 'const half = total / 2;\nconst ratio = a / b / c;\n';
    const out = blankSource(src);
    expect(out).toBe(src);
  });

  it('keeps code inside template ${…} expressions, at nested depth', () => {
    const src = 'const s = `a${call(1, `inner${deep(2)}`)}b`;\n';
    const out = blankSource(src);
    expect(out).toContain('call(1,');
    expect(out).toContain('deep(2)');
    expect(out).not.toContain('inner');
    expect(out.indexOf('a$')).toBe(-1);
  });

  it('keepQuotedStrings mode keeps specifiers readable while comments stay dead', () => {
    const src = `// import fake from 'octokit'\nimport real from './real.js';\n`;
    const kept = blankSource(src, { keepQuotedStrings: true });
    expect(kept).not.toContain('fake');
    expect(kept).toContain("'./real.js'");
    // But note the comment's QUOTED PART survives in this mode only if outside a comment —
    // which is why extract.ts cross-checks the keyword against the fully-blanked text.
    expect(blankSource(src)).not.toContain('./real.js');
  });

  it('recovers at the line break on an unterminated string', () => {
    const src = "const broken = 'oops\nconst fine = 1;\n";
    const out = blankSource(src);
    expect(out).toContain('const fine = 1;');
  });
});

describe('lineStartOffsets / lineOfOffset', () => {
  it('maps offsets to 1-based lines', () => {
    const text = 'ab\ncd\nef';
    const offsets = lineStartOffsets(text);
    expect(lineOfOffset(offsets, 0)).toBe(1);
    expect(lineOfOffset(offsets, 3)).toBe(2);
    expect(lineOfOffset(offsets, 7)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Definitions (spec 05 §3 P2)
// ---------------------------------------------------------------------------

describe('extractModule — definitions', () => {
  it('extracts functions, classes, methods, interfaces, type aliases, enums and consts with spans', () => {
    const src = [
      "export function alpha(x: number): number {", // 1
      '  return x + 1;', // 2
      '}', // 3
      'export class Beta {', // 4
      '  gamma(): void {', // 5
      '    alpha(2);', // 6
      '  }', // 7
      '}', // 8
      'interface Delta {', // 9
      '  readonly d: number;', // 10
      '}', // 11
      'export type Epsilon = { e: number };', // 12
      'enum Zeta { A, B }', // 13
      'export const eta = (n: number): number => n * 2;', // 14
      'const theta = 42;', // 15
    ].join('\n');
    const x = extractModule(src);
    const byName = new Map(x.definitions.map((d) => [d.name, d]));

    expect(byName.get('alpha')).toMatchObject({ form: 'function', start: 1, end: 3, exported: true });
    expect(byName.get('Beta')).toMatchObject({ form: 'class', start: 4, end: 8, exported: true });
    expect(byName.get('gamma')).toMatchObject({ form: 'method', start: 5, end: 7, memberOf: 'Beta@4' });
    expect(byName.get('Delta')).toMatchObject({ form: 'interface', start: 9, end: 11, exported: false });
    expect(byName.get('Epsilon')).toMatchObject({ form: 'type-alias', start: 12, end: 12, exported: true });
    expect(byName.get('Zeta')).toMatchObject({ form: 'enum', start: 13, end: 13 });
    expect(byName.get('eta')).toMatchObject({ form: 'function', start: 14, end: 14, exported: true });
    expect(byName.get('theta')).toMatchObject({ form: 'const', start: 15, end: 15 });
  });

  it('finds the body through an object-literal return type (the judge.ts shape)', () => {
    const src = [
      'function loadSeated(repo: string): { judges: readonly string[]; note: string | null } {',
      '  return { judges: [], note: null };',
      '}',
    ].join('\n');
    const x = extractModule(src);
    expect(x.definitions).toHaveLength(1);
    expect(x.definitions[0]).toMatchObject({ name: 'loadSeated', start: 1, end: 3 });
  });

  it('marks export-list and export-default names exported', () => {
    const src = [
      'function hidden() { return 1; }',
      'function shown() { return 2; }',
      'const alias = 3;',
      'export { shown, alias as visible };',
      'export default hidden;',
    ].join('\n');
    const x = extractModule(src);
    const byName = new Map(x.definitions.map((d) => [d.name, d]));
    expect(byName.get('shown')?.exported).toBe(true);
    expect(byName.get('alias')?.exported).toBe(true);
    expect(byName.get('hidden')?.exported).toBe(true);
    expect(x.defaultExportName).toBe('hidden');
  });

  it('multi-line arrow consts are functions and span to the statement end', () => {
    const src = [
      'export const widen = (',
      '  ring: string,',
      '): string | null => {',
      "  return ring === 'callers' ? null : ring;",
      '};',
    ].join('\n');
    const x = extractModule(src);
    expect(x.definitions[0]).toMatchObject({ name: 'widen', form: 'function', start: 1, end: 5 });
  });
});

// ---------------------------------------------------------------------------
// Imports (spec 05 §3 P3)
// ---------------------------------------------------------------------------

describe('extractModule — imports', () => {
  it('reads the four forms with bindings', () => {
    const src = [
      "import def, { named, orig as renamed, type T } from './a.js';",
      "import * as ns from './b.js';",
      "import type { OnlyTypes } from './c.js';",
      "import './side-effect.js';",
      "const dyn = await import('./d.js');",
      "export { re } from './e.js';",
    ].join('\n');
    const x = extractModule(src);
    const bySpec = new Map(x.imports.map((i) => [i.specifier, i]));

    expect(bySpec.get('./a.js')?.form).toBe('value');
    expect(bySpec.get('./a.js')?.bindings).toEqual([
      { local: 'def', imported: 'default', kind: 'default', typeOnly: false },
      { local: 'named', imported: 'named', kind: 'named', typeOnly: false },
      { local: 'renamed', imported: 'orig', kind: 'named', typeOnly: false },
      { local: 'T', imported: 'T', kind: 'named', typeOnly: true },
    ]);
    expect(bySpec.get('./b.js')?.bindings).toEqual([
      { local: 'ns', imported: '*', kind: 'namespace', typeOnly: false },
    ]);
    expect(bySpec.get('./c.js')?.form).toBe('type-only');
    expect(bySpec.get('./side-effect.js')?.form).toBe('value');
    expect(bySpec.get('./d.js')?.form).toBe('dynamic');
    expect(bySpec.get('./e.js')?.form).toBe('re-export');
  });

  it('an import mentioned in a comment or a string mints NO edge', () => {
    // This repository documents its own boundaries in prose constantly (Q-09's world); a
    // perception layer that read prose as code would be wrong, not merely noisy.
    const src = [
      "// import { Octokit } from '@octokit/rest'",
      '/*',
      " import probot from 'probot';",
      '*/',
      "const doc = \"import x from 'octokit'\";",
      "const tpl = `import y from 'github'`;",
      "import real from './real.js';",
    ].join('\n');
    const x = extractModule(src);
    expect(x.imports.map((i) => i.specifier)).toEqual(['./real.js']);
  });

  it('reports the line carrying the specifier, 1-based', () => {
    const src = ['', 'import {', '  a,', '  b,', "} from './multi.js';"].join('\n');
    const x = extractModule(src);
    expect(x.imports[0]?.at).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Calls (spec 05 §3 P4)
// ---------------------------------------------------------------------------

describe('extractModule — call sites', () => {
  it('collects bare and namespace-qualified calls inside definitions; skips keywords, receivers and declarations', () => {
    const src = [
      "import * as helpers from './helpers.js';",
      "import { imported } from './lib.js';",
      'function local(): number { return 1; }',
      'export function run(list: readonly number[]): number {',
      '  if (list.length > 0) {', // `if (` must not be a call
      '    local();', // bare call → same-file candidate
      '    imported(list);', // bare call → import-bound candidate
      '    helpers.deep(list);', // namespace-qualified
      '    list.map((n) => n + 1);', // receiver call — invisible on purpose
      '  }',
      '  return local();',
      '}',
    ].join('\n');
    const x = extractModule(src);
    const names = x.calls.map((c) => `${c.via === null ? '' : `${c.via}.`}${c.name}`).sort();
    expect(names).toEqual(['helpers.deep', 'imported', 'local', 'local']);
    // Every call attributes to the innermost enclosing definition — `run`, not the module.
    for (const c of x.calls) {
      expect(x.definitions[c.enclosing]?.name).toBe('run');
    }
  });

  it('a declaration is not a call of itself, and top-level calls attribute to nothing', () => {
    const src = ['function solo(): void {}', 'solo();'].join('\n');
    const x = extractModule(src);
    expect(x.calls).toEqual([]);
  });

  it('reads extends and implements clauses, including qualified ones', () => {
    const src = [
      "import * as base from './base.js';",
      'interface Shape { area(): number }',
      'class Square extends base.Rect implements Shape {',
      '  area(): number { return 1; }',
      '}',
    ].join('\n');
    const x = extractModule(src);
    const h = x.heritage.map((e) => `${e.kind}:${e.via === null ? '' : `${e.via}.`}${e.name}`).sort();
    expect(h).toEqual(['extends:base.Rect', 'implements:Shape']);
  });
});
