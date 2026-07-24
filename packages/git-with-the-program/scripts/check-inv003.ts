#!/usr/bin/env node
// Implements: .program/invariants.yaml INV-003 ("The judge is blind to authorship and to the
// accumulator"), docs/adr/0003-judge-blindness.md, docs/spec/03-judge.md §2, and the
// deterministic PRESCREEN half of INV-003's `enforcement: hybrid` that src/core/index.ts and
// src/core/sentencing.ts have described in their headers since SEED-01.
//
// WHAT THIS CHECKS, AND WHY A TYPE CHECKER CANNOT
//
// `Blind<T>` (src/core/blindness.ts) proves that no `ActorId` and no `Surprise` can sit in an
// evidence bundle. It says nothing about a plain `number` obtained by UNWRAPPING one, because
// by the time that value is named it is just a number and every numeric field will take it.
// The structural defence is therefore three things at once: the unwrapping functions live in
// exactly three modules, they are withheld from the `src/core` barrel, and each takes a
// `SentencingWarrant` that only `withSentencingWarrant` can mint. Which leaves ONE thing to
// check textually —
//
//     does anything under src/judge/** or src/evidence/** VALUE-import them?
//
// — and that is one greppable line per offence. `verbatimModuleSyntax` is what makes it
// decidable: an erased `import type { Surprise }` is textually distinct from a value import,
// so naming a sentencing type stays legal (a judge may be handed types it cannot read) while
// importing the machinery to read one does not.
//
// This is a PRESCREEN, not a proof, and it is deliberately deterministic, fast and dumb:
// precision over recall. It reads source text, never executes it, and everything it flags is a
// specific line a reviewer can look at. The rest of INV-003's recall — identity flattened into
// free text, an `as unknown as` cast, a value arriving from a subprocess — is the LLM half of
// `enforcement: hybrid` plus `assertBlind`'s runtime walk. See docs/spec/OPEN-QUESTIONS.md
// Q-09 and Q-39.
//
// Exit codes: 0 = clean, 1 = INV-003 prescreen violated, 2 = the check could not run.
// 2 is distinct from 1 on purpose, exactly as in check-inv001: "I found nothing" and "I could
// not look" must never be the same signal on a governance check.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

// ────────────────────────────────────────────────────────────────────────────────────────
// The rules, as data
// ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The directories INV-003 makes blind: the evidence assembler and the bench, i.e. the whole
 * verdict branch of ADR-0003. `src/ledger/**` is deliberately ABSENT — it is the one module
 * permitted to read authorship, and only at firing time (src/ledger/index.ts header).
 */
export const BLIND_DIRS = ['src/judge/', 'src/evidence/'] as const;

/**
 * Modules whose VALUES untaint. Suffix-matched on the specifier with the extension stripped,
 * so `../core/sentencing.js`, `../../src/core/sentencing.ts` and `#core/sentencing` all match
 * while `core/sentencing-notes` does not.
 */
export const SENTENCING_MODULES = [
  'core/sentencing',
  'core/accumulator',
  'core/dispersion',
] as const;

/**
 * `src/ledger/**` is the sentencing-side WALK: it holds the SightedCommitPort and the firing
 * assembly, and it re-exports declassifiers like `atFiringTime` and `describeEvidenceLocus`
 * through its own barrel (src/ledger/index.ts). A blind module can therefore untaint author
 * identity by reaching THROUGH the ledger barrel with names that never appear in
 * SENTENCING_VALUES (that list is the src/core registry). So the boundary is drawn at the module
 * itself: a blind file may `import type` from the ledger (naming a type it cannot read) but may
 * never value-import it. tests/ledger/blindness-boundary.test.ts asserts the same fact
 * structurally; this rule makes the deterministic prescreen agree rather than trust a unit test.
 */
export function isLedgerModule(spec: string): boolean {
  return normalizeSpecifier(spec)
    .split('/')
    .includes('ledger');
}

/**
 * The individual names that untaint, wherever they are imported from. Belt to
 * SENTENCING_MODULES' braces: this survives a re-export appearing somewhere unexpected, and it
 * is what catches a regression that puts a declassifier back on the `src/core` barrel.
 *
 * tests/check-inv003.test.ts asserts this list against the barrel's actual export surface, so
 * it cannot silently drift from tests/core/barrel-surface.test.ts.
 */
export const SENTENCING_VALUES = [
  // Identity (ADR-0003 clause 1)
  'actorId',
  'revealActor',
  'actorGroupKey',
  // The meter (ADR-0003 clause 2)
  'surprise',
  'parseSurprise',
  'revealSurprise',
  'addSurprise',
  'scaleSurprise',
  'surpriseFrom',
  'compareSurprise',
  'surpriseReachesBudget',
  'surpriseBelowFraction',
  'ZERO_SURPRISE',
  // The warrant, and the raw symbols a forger would need
  'withSentencingWarrant',
  'SENTENCING_TAG',
  'SENTENCING_WARRANT',
  // The declassifiers
  'rawSurprise',
  'toAccumulatorSnapshot',
  'computeDispersion',
  'toDispersionSnapshot',
] as const;

/**
 * `Symbol.for` reads a GLOBAL registry, so `Symbol.for("gwtp" + ".sentencing.warrant")`
 * returns the very symbol `SENTENCING_WARRANT` holds — a forged warrant that no import
 * touches and no type rejects. The same trick against the tag key strips the marker
 * `assertBlind` looks for. Naming either key outside the module that owns them is an offence
 * in its own right, repo-wide.
 */
export const SENTENCING_SYMBOL_KEYS = ['gwtp.sentencing.warrant', 'gwtp.sentencing'] as const;

/** The module that owns the registry keys. */
export const SYMBOL_KEY_OWNER = 'src/core/sentencing.ts';

/**
 * The two files allowed to write the key text: the module that DECLARES the symbols, and this
 * check, which cannot ban a string without naming it. Stated as data rather than special-cased
 * in the loop, because a self-exemption should be visible in a diff. It is not a hole worth
 * closing further: `scripts/**` is not a blind directory, and an edit to the check that bans
 * forged warrants is the single most closely read diff in the repository.
 */
export const SYMBOL_KEY_DECLARERS = [SYMBOL_KEY_OWNER, 'scripts/check-inv003.ts'] as const;

export type Inv003Code =
  | 'sentencing-module-value-import'
  | 'sentencing-value-import'
  | 'sentencing-dynamic-import'
  | 'blind-imports-ledger'
  | 'forged-warrant-symbol';

export interface Inv003Violation {
  /** Repo-relative, POSIX separators. */
  readonly file: string;
  /** 1-indexed. */
  readonly line: number;
  readonly code: Inv003Code;
  readonly detail: string;
  /** The offending source line, trimmed, for the report. */
  readonly source: string;
}

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

// ────────────────────────────────────────────────────────────────────────────────────────
// Lexing, such as it is
// ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Blanks COMMENTS to spaces, preserving every byte offset and every newline, and leaves string
 * literals alone (their contents are what carries an import specifier).
 *
 * String awareness is not optional even though strings survive: without it, a `//` inside a
 * string literal would blank the rest of the line, and the very rule that reads specifiers
 * would start eating them.
 *
 * NOT a lexer. Regex literals are not tracked — a `//` inside one (`/\/\//`) is written with
 * escapes in practice, and the failure mode is a blanked tail of one line, which can only cause
 * a MISSED violation on that line, never a false one. A prescreen that fails open on an exotic
 * line and closed on every ordinary one is the right trade for `enforcement: hybrid`.
 */
export function stripComments(text: string): string {
  const out: string[] = [];
  const n = text.length;
  let i = 0;
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');

  while (i < n) {
    const c = text[i] as string;
    const two = text.slice(i, i + 2);

    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        const d = text[j] as string;
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === c) break;
        j += 1;
      }
      const stop = Math.min(j + 1, n);
      out.push(text.slice(i, stop));
      i = stop;
      continue;
    }
    out.push(c);
    i += 1;
  }
  return out.join('');
}

const lineOf = (text: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
};

/**
 * FROM_RE/BARE_RE open with `(?:^|[\s;}])`, so `match.index` can point at the NEWLINE before
 * the keyword — which reports the statement one line early, and a governance report that
 * quotes the wrong line is worse than no report. Re-anchor on the keyword itself.
 */
const keywordLine = (text: string, match: RegExpExecArray): number => {
  const offset = match[0].search(/import|export/);
  return lineOf(text, match.index + (offset === -1 ? 0 : offset));
};

/** Drops the extension and any query/fragment, and normalizes separators. */
export function normalizeSpecifier(spec: string): string {
  return spec
    .replace(/[?#].*$/, '')
    .replace(/\.(m|c)?[jt]sx?$/, '')
    .replace(/\\/g, '/');
}

export function isSentencingModule(spec: string): boolean {
  const normalized = normalizeSpecifier(spec);
  return SENTENCING_MODULES.some((m) => normalized === m || normalized.endsWith('/' + m));
}

export function isBlindFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return BLIND_DIRS.some((d) => normalized.startsWith(d));
}

export interface ImportRecord {
  readonly specifier: string;
  /** `import type {...}` / `export type {...}`: erased entirely, so it declassifies nothing. */
  readonly typeOnly: boolean;
  /** Named bindings, each with its per-specifier `type` modifier already folded in. */
  readonly named: readonly { readonly name: string; readonly typeOnly: boolean }[];
  /** `import * as ns`, `export *`, or a default import: the whole module, as a value. */
  readonly wholeModule: boolean;
  readonly line: number;
  readonly source: string;
}

/**
 * The clause between `import`/`export` and `from` can only contain identifiers, braces, stars,
 * commas and whitespace. Validating that is what keeps the lazy `[\s\S]*?` from spanning two
 * statements and mis-attributing one statement's bindings to another's specifier.
 */
const CLAUSE_OK = /^[\sA-Za-z_$0-9{},*]*$/;
const FROM_RE = /(?:^|[\s;}])(?:import|export)([\s\S]*?)\sfrom\s*(['"])([^'"]*)\2/g;
const BARE_RE = /(?:^|[\s;}])import\s*(['"])([^'"]*)\1/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*(['"])([^'"]*)\1/g;

export function parseNamedBindings(
  inner: string,
  clauseTypeOnly: boolean,
): readonly { name: string; typeOnly: boolean }[] {
  const out: { name: string; typeOnly: boolean }[] = [];
  for (const part of inner.split(',')) {
    const t = part.trim();
    if (t.length === 0) continue;
    const perSpecifierType = /^type\s/.test(t);
    const name = (t.replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '').trim();
    if (name.length === 0) continue;
    out.push({ name, typeOnly: clauseTypeOnly || perSpecifierType });
  }
  return out;
}

/**
 * A deliberately small import reader: enough to tell a type-only import from a value import
 * and to name the bindings, and no more. It is not a TypeScript parser and does not pretend to
 * be one; it runs on comment-blanked source, and anything it cannot confidently read it skips
 * rather than guesses at.
 */
export function parseImports(rawText: string): readonly ImportRecord[] {
  const text = stripComments(rawText);
  const lines = rawText.split('\n');
  const records: ImportRecord[] = [];

  FROM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FROM_RE.exec(text)) !== null) {
    const clause = m[1] ?? '';
    if (!CLAUSE_OK.test(clause)) {
      // The lazy clause spanned into a later statement (a bare `import './x.js';` followed by
      // a real one does exactly this). Rewind to just past this match's start so the statement
      // it swallowed is still scanned — a skipped statement is a MISSED violation, and this
      // check must not fail open on adjacency.
      FROM_RE.lastIndex = m.index + 1;
      continue;
    }
    const line = keywordLine(text, m);
    const typeOnly = /^\s*type[\s{]/.test(clause);
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    const named = braces === null ? [] : parseNamedBindings(braces[1] ?? '', typeOnly);
    const wholeModule =
      !typeOnly && (/\*/.test(clause) || /^\s*[A-Za-z_$][\w$]*\s*(?:,|$)/.test(clause));
    records.push({
      specifier: m[3] ?? '',
      typeOnly,
      named,
      wholeModule,
      line,
      source: (lines[line - 1] ?? '').trim(),
    });
  }

  BARE_RE.lastIndex = 0;
  while ((m = BARE_RE.exec(text)) !== null) {
    const line = keywordLine(text, m);
    records.push({
      specifier: m[2] ?? '',
      typeOnly: false,
      named: [],
      // `import './x.js'` runs the module for effect but binds nothing. It cannot untaint a
      // value, so it is not "the whole module as a value" — but it IS still a value import of
      // the module, which Rule 1 reports on its own grounds.
      wholeModule: false,
      line,
      source: (lines[line - 1] ?? '').trim(),
    });
  }

  return records.sort((a, b) => a.line - b.line);
}

// ────────────────────────────────────────────────────────────────────────────────────────
// The pure decision procedure
// ────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE CHECK. Pure: no fs, no clock, no env, no subprocess. Same sources, same violations.
 *
 * Rules 1-3 judge only files under BLIND_DIRS. Rule 4 (the symbol registry) is repo-wide,
 * because forging a warrant anywhere hands one to everywhere.
 */
export function findInv003Violations(files: readonly SourceFile[]): readonly Inv003Violation[] {
  const violations: Inv003Violation[] = [];
  const banned = new Set<string>(SENTENCING_VALUES);

  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    const text = stripComments(file.text);
    const lines = file.text.split('\n');

    // ── Rule 4, repo-wide: only the owner may name the global symbol-registry keys ────────
    if (!(SYMBOL_KEY_DECLARERS as readonly string[]).includes(path)) {
      for (const key of SENTENCING_SYMBOL_KEYS) {
        let idx = text.indexOf(key);
        while (idx !== -1) {
          // Exact key, not a prefix of a longer one: 'gwtp.sentencing' must not fire on
          // 'gwtp.sentencing.warrant', which has its own entry and its own message.
          const after = text[idx + key.length] ?? '';
          if (!/[.\w-]/.test(after)) {
            const line = lineOf(text, idx);
            violations.push({
              file: path,
              line,
              code: 'forged-warrant-symbol',
              detail:
                `names the global symbol-registry key "${key}". Symbol.for() is a GLOBAL ` +
                'registry, so naming this key hands out the real sentencing symbol — enough ' +
                'to forge a warrant, or to strip the tag assertBlind() looks for. Only ' +
                `${SYMBOL_KEY_OWNER} may name it.`,
              source: (lines[line - 1] ?? '').trim(),
            });
          }
          idx = text.indexOf(key, idx + 1);
        }
      }
    }

    if (!isBlindFile(path)) continue;

    // ── Rule 3: dynamic import / require, which static import analysis would not see ──────
    DYNAMIC_RE.lastIndex = 0;
    let d: RegExpExecArray | null;
    while ((d = DYNAMIC_RE.exec(text)) !== null) {
      const spec = d[2] ?? '';
      if (!isSentencingModule(spec)) continue;
      const line = lineOf(text, d.index);
      violations.push({
        file: path,
        line,
        code: 'sentencing-dynamic-import',
        detail:
          `dynamically loads ${JSON.stringify(spec)}. A blind module may not reach the ` +
          'sentencing branch at runtime either (ADR-0003).',
        source: (lines[line - 1] ?? '').trim(),
      });
    }

    for (const imp of parseImports(file.text)) {
      // ── Rule 1: a value import of a sentencing module, in any shape ────────────────────
      if (isSentencingModule(imp.specifier) && !imp.typeOnly) {
        const valueNames = imp.named.filter((b) => !b.typeOnly).map((b) => b.name);
        if (imp.wholeModule || valueNames.length > 0 || imp.named.length === 0) {
          violations.push({
            file: path,
            line: imp.line,
            code: 'sentencing-module-value-import',
            detail:
              `value-imports ${JSON.stringify(imp.specifier)}` +
              (valueNames.length > 0 ? ` (${valueNames.join(', ')})` : ' as a whole module') +
              '. A blind module may `import type` from the sentencing branch — naming a type ' +
              'it cannot read is exactly the point — but never value-import it ' +
              '(ADR-0003, INV-003).',
            source: imp.source,
          });
          continue;
        }
      }

      // ── Rule 1b: a blind module may not value-import the ledger walk in any shape ──────
      // Closes the barrel route: src/ledger re-exports `atFiringTime` / `describeEvidenceLocus`,
      // which untaint but are NOT in SENTENCING_VALUES, so Rule 2 alone would miss them.
      if (isLedgerModule(imp.specifier) && !imp.typeOnly) {
        const valueNames = imp.named.filter((b) => !b.typeOnly).map((b) => b.name);
        if (imp.wholeModule || valueNames.length > 0 || imp.named.length === 0) {
          violations.push({
            file: path,
            line: imp.line,
            code: 'blind-imports-ledger',
            detail:
              `value-imports ${JSON.stringify(imp.specifier)}` +
              (valueNames.length > 0 ? ` (${valueNames.join(', ')})` : ' as a whole module') +
              '. src/ledger is the sentencing-side walk (SightedCommitPort, firing assembly, and ' +
              'the declassifiers it re-exports). A blind module may `import type` from it but ' +
              'never value-import it (ADR-0003, INV-003).',
            source: imp.source,
          });
          continue;
        }
      }

      // ── Rule 2: a value import of a declassifier by NAME, from anywhere at all ─────────
      for (const binding of imp.named) {
        if (binding.typeOnly) continue;
        if (!banned.has(binding.name)) continue;
        violations.push({
          file: path,
          line: imp.line,
          code: 'sentencing-value-import',
          detail:
            `value-imports \`${binding.name}\` from ${JSON.stringify(imp.specifier)}. That ` +
            'name untaints author identity or the accumulator, and no module in the verdict ' +
            'branch may hold it (ADR-0003, INV-003).',
          source: imp.source,
        });
      }
    }
  }

  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code),
  );
}

export function formatInv003Violations(violations: readonly Inv003Violation[]): string {
  const lines: string[] = [];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line}  [${v.code}]`);
    lines.push(`    ${v.source}`);
    lines.push(`    ${v.detail}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────────────────
// fs I/O — the thin shell
// ────────────────────────────────────────────────────────────────────────────────────────

export class CheckError extends Error {}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

export function collectSources(root: string, dirs: readonly string[]): readonly SourceFile[] {
  const files: SourceFile[] = [];

  const walk = (abs: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(abs).sort();
    } catch (e) {
      throw new CheckError(`cannot read ${abs}: ${(e as Error).message}`);
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const child = join(abs, entry);
      if (statSync(child).isDirectory()) {
        walk(child);
        continue;
      }
      if (!/\.(m|c)?tsx?$/.test(entry)) continue;
      files.push({
        path: relative(root, child).split(sep).join('/'),
        text: readFileSync(child, 'utf8'),
      });
    }
  };

  for (const d of dirs) {
    const abs = resolve(root, d);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      throw new CheckError(
        `${d} is not a directory under ${root}. INV-003's prescreen must never report ` +
          '"clean" because it could not find the tree it was meant to read.',
      );
    }
    walk(abs);
  }
  return files;
}

const USAGE = `check-inv003 — INV-003: the judge is blind to authorship and to the accumulator

The deterministic PRESCREEN half of INV-003's \`enforcement: hybrid\`. Fails when anything
under ${BLIND_DIRS.join(' or ')} value-imports the sentencing branch, and when any module
outside ${SYMBOL_KEY_OWNER} names the sentencing symbol-registry keys.

Usage:
  tsx scripts/check-inv003.ts [--root <dir>] [--help]

Exit codes:
  0  no blind module reaches the sentencing branch
  1  INV-003 prescreen violated
  2  the check could not run (missing tree, unreadable file)
`;

export function main(argv: readonly string[], cwd: string): number {
  let flags: { root?: string | undefined; help?: boolean | undefined };
  try {
    ({ values: flags } = parseArgs({
      args: [...argv],
      options: { root: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`check-inv003: ${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (flags.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const root = resolve(cwd, flags.root ?? '.');
  let files: readonly SourceFile[];
  try {
    // BLIND_DIRS are what Rules 1-3 judge; the whole of src/ and scripts/ is what Rule 4 does.
    files = collectSources(root, ['src', 'scripts']);
  } catch (e) {
    if (e instanceof CheckError) {
      process.stderr.write(`check-inv003: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const blind = files.filter((f) => isBlindFile(f.path));
  if (blind.length === 0) {
    process.stderr.write(
      `check-inv003: no source files found under ${BLIND_DIRS.join(', ')}. ` +
        'A prescreen that scanned nothing has not passed; it has failed to look.\n',
    );
    return 2;
  }

  const violations = findInv003Violations(files);
  if (violations.length === 0) {
    process.stdout.write(
      `check-inv003: ${blind.length} file(s) under ${BLIND_DIRS.join(', ')}; ` +
        `${files.length} file(s) scanned for a forged warrant; ` +
        'no value import of the sentencing branch. INV-003 prescreen OK.\n',
    );
    return 0;
  }

  process.stderr.write(
    `check-inv003: INV-003 PRESCREEN VIOLATED — ${violations.length} offending line(s).\n\n` +
      formatInv003Violations(violations) +
      'The judge is blind by construction (ADR-0003): author identity and the accumulator are\n' +
      'opaque values, every function that untaints one takes a SentencingWarrant, and none of\n' +
      'them is reachable from the src/core barrel. `import type` from the sentencing branch is\n' +
      'legal — naming a type you cannot read is the point. A VALUE import is not.\n',
  );
  return 1;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return entry.endsWith('check-inv003.ts') || entry.endsWith('check-inv003.js');
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
