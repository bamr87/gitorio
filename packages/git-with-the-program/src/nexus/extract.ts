// Implements: docs/spec/05-nexus.md §3 P2 (definitions with spans and exportedness), P3
// (import forms and bindings), P4 (call sites), and §3.1 (the stated recall gaps) — the v0
// TypeScript/JavaScript extractor, LEXICAL BY DESIGN per ADR-0007: hand-written,
// dependency-free, deterministic, precision over recall. Everything scanned here runs over
// `blankSource` output (src/nexus/lex.ts), so braces inside strings, templates, comments and
// regex literals cannot skew a span, and an `import` mentioned in prose cannot mint an edge.
//
// A FOURTH import reader now exists in this repository, and the module headers of the other
// three (scripts/check-inv003.ts, src/judge/deterministic/imports.ts) say a new one appearing
// is the thing to notice — so, noticed, and distinguished: check-inv003 reads WHOLE FILES to
// fail CI closed; the import-boundary judge reads DIFF HUNKS to cite offences; this file reads
// whole files to build PERCEPTION — edges with lines, plus per-clause bindings so pass P4 can
// resolve calls, which neither of the others needs. The regex shapes are deliberately the
// same family so a reader of one recognises the others; the semantics are not interchangeable.
//
// Recall gaps are LISTED in spec 05 §3.1 rather than hidden here. Each one shrinks the graph;
// none can add a false edge.

import type { DefinitionForm, NexusImportForm } from './types.js';
import { blankSource, lineOfOffset, lineStartOffsets } from './lex.js';

// ---------------------------------------------------------------------------
// The extraction result (consumed by src/nexus/build.ts)
// ---------------------------------------------------------------------------

export interface ExtractedDefinition {
  readonly name: string;
  readonly form: DefinitionForm;
  /** 1-based inclusive lines (spec 05 §2). */
  readonly start: number;
  readonly end: number;
  exported: boolean;
  /** For methods: `name@start` of the enclosing class; null for top-level definitions. */
  readonly memberOf: string | null;
}

export interface ImportBinding {
  /** The local name this module uses. */
  readonly local: string;
  /** The exported name in the target module: a name, `default`, or `*`. */
  readonly imported: string;
  readonly kind: 'default' | 'namespace' | 'named';
  readonly typeOnly: boolean;
}

export interface ExtractedImport {
  readonly specifier: string;
  readonly form: NexusImportForm;
  /** 1-based line carrying the specifier. */
  readonly at: number;
  readonly bindings: readonly ImportBinding[];
}

export interface ExtractedCallSite {
  /** The callee: a bare identifier, or the property name when qualified through a namespace. */
  readonly name: string;
  /** The qualifying local name (`ns` in `ns.f()`), or null for a bare call. */
  readonly via: string | null;
  readonly at: number;
  /** Index into `definitions` of the innermost enclosing definition. */
  readonly enclosing: number;
}

export interface ExtractedHeritage {
  readonly kind: 'extends' | 'implements';
  readonly name: string;
  readonly via: string | null;
  readonly at: number;
  /** Index into `definitions` of the declaring definition. */
  readonly from: number;
}

export interface ModuleExtraction {
  readonly definitions: readonly ExtractedDefinition[];
  readonly imports: readonly ExtractedImport[];
  readonly calls: readonly ExtractedCallSite[];
  readonly heritage: readonly ExtractedHeritage[];
  /** Local definition name exported as the module's default, when one is. */
  readonly defaultExportName: string | null;
}

// ---------------------------------------------------------------------------
// Character-level helpers over the blanked text
// ---------------------------------------------------------------------------

const WORD = /[A-Za-z0-9_$#]/;

function isWs(c: string): boolean {
  return c === ' ' || c === '\n' || c === '\t' || c === '\r';
}

/** Index of the previous non-whitespace character before `i`, or -1. */
function prevSignificant(text: string, i: number): number {
  let j = i - 1;
  while (j >= 0 && isWs(text[j] as string)) j -= 1;
  return j;
}

/** Index of the next non-whitespace character at/after `i`, or text.length. */
function nextSignificant(text: string, i: number): number {
  let j = i;
  while (j < text.length && isWs(text[j] as string)) j += 1;
  return j;
}

/** The identifier ending at index `end` (inclusive), read backward. */
function wordEndingAt(text: string, end: number): string {
  let k = end;
  while (k >= 0 && WORD.test(text[k] as string)) k -= 1;
  return text.slice(k + 1, end + 1);
}

interface BraceIndex {
  /** close index for each open `{` index. Unbalanced opens map to text end. */
  readonly closeOf: ReadonlyMap<number, number>;
  /** Brace depth at the START of each 1-based line. */
  readonly depthAtLine: readonly number[];
}

function indexBraces(text: string): BraceIndex {
  const closeOf = new Map<number, number>();
  const stack: number[] = [];
  const depthAtLine: number[] = [0, 0]; // [0] unused; line 1 starts at depth 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (c === '{') stack.push(i);
    else if (c === '}') {
      const open = stack.pop();
      if (open !== undefined) closeOf.set(open, i);
    } else if (c === '\n') depthAtLine.push(stack.length);
  }
  for (const open of stack) closeOf.set(open, text.length - 1);
  return { closeOf, depthAtLine };
}

/**
 * Statement end: the first `;` at zero combined ()/[]/{} depth scanning from `i`, or text end.
 * Good enough for a codebase with semicolons; an ASI-reliant statement spans long, never short
 * — the gap direction spec 05 §3.1 permits.
 */
function statementEnd(text: string, i: number): number {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j] as string;
    if (c === '(') paren += 1;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (c === '[') bracket += 1;
    else if (c === ']') bracket = Math.max(0, bracket - 1);
    else if (c === '{') brace += 1;
    else if (c === '}') brace = Math.max(0, brace - 1);
    else if (c === ';' && paren === 0 && bracket === 0 && brace === 0) return j;
  }
  return text.length - 1;
}

/**
 * From just after a declaration's parameter list, find the body `{` — skipping a return-type
 * annotation, where `{` can open an OBJECT TYPE rather than the body. The disambiguation rule:
 * inside the annotation, a `{` at zero depth is a type brace when the previous significant
 * token continues a type (`:`, `|`, `&`, or a `=>` arrow); anything else at zero depth is the
 * body. Returns the body's `{` index, or `null` for a bodyless declaration (overload
 * signature, abstract member) whose statement ends at `;`.
 */
function findBodyBrace(text: string, afterParams: number): number | null {
  let j = nextSignificant(text, afterParams);
  if (text[j] === '{') return j;
  if (text[j] === ';' || j >= text.length) return null;
  if (text[j] !== ':') return null; // `=`, `,`, `)` … — not a body-bearing declaration
  j += 1;
  let depth = 0;
  for (; j < text.length; j += 1) {
    const c = text[j] as string;
    if (c === '=' && text[j + 1] === '>') {
      j += 1; // an arrow inside a function TYPE; its `>` is not a generic close
      continue;
    }
    if (c === '(' || c === '[' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '>') depth = Math.max(0, depth - 1);
    else if (c === '{') {
      if (depth > 0) {
        depth += 1;
        continue;
      }
      const p = prevSignificant(text, j);
      const prev = p >= 0 ? (text[p] as string) : '';
      const arrow = p >= 1 && text[p - 1] === '=' && prev === '>';
      if (prev === ':' || prev === '|' || prev === '&' || arrow) {
        depth += 1; // object TYPE literal
        continue;
      }
      return j; // the body
    } else if (c === '}') {
      if (depth > 0) depth -= 1;
    } else if (c === ';' && depth === 0) return null;
  }
  return null;
}

/** From an open `(` index, the index of its matching `)` (brace-blind; strings are blanked). */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let j = open; j < text.length; j += 1) {
    const c = text[j] as string;
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return text.length - 1;
}

// ---------------------------------------------------------------------------
// Definitions (spec 05 §3 P2)
// ---------------------------------------------------------------------------

const TOP_FUNCTION =
  /^(\s*)(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*[(<]/;
const TOP_CLASS = /^(\s*)(export\s+)?(default\s+)?(abstract\s+)?class\b\s*([A-Za-z_$][\w$]*)?/;
const TOP_INTERFACE = /^(\s*)(export\s+)?interface\s+([A-Za-z_$][\w$]*)/;
const TOP_TYPE = /^(\s*)(export\s+)?type\s+([A-Za-z_$][\w$]*)/;
const TOP_ENUM = /^(\s*)(export\s+)?(declare\s+)?(const\s+)?enum\s+([A-Za-z_$][\w$]*)/;
const TOP_CONST = /^(\s*)(export\s+)?const\s+([A-Za-z_$][\w$]*)/;

const MEMBER_METHOD =
  /^(\s*)((?:(?:public|private|protected|static|readonly|abstract|override|async|declare)\s+)*)(?:(?:get|set)\s+)?\*?\s*([A-Za-z_$#][\w$]*)\s*(?:<|\()/;
const MEMBER_PROPERTY_FN =
  /^(\s*)((?:(?:public|private|protected|static|readonly|override)\s+)*)([A-Za-z_$#][\w$]*)\s*(?::[^=;\n]*)?=/;

const CALL_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'instanceof',
  'new',
  'delete',
  'void',
  'await',
  'yield',
  'do',
  'else',
  'case',
  'throw',
  'in',
  'of',
  'super',
  'this',
  'constructor',
  'function',
  'import',
  'require',
]);

interface LineView {
  /** 1-based. */
  readonly n: number;
  readonly start: number;
  readonly text: string;
}

function lines(text: string, offsets: readonly number[]): readonly LineView[] {
  const out: LineView[] = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i] as number;
    const end = i + 1 < offsets.length ? (offsets[i + 1] as number) - 1 : text.length;
    out.push({ n: i + 1, start, text: text.slice(start, end) });
  }
  return out;
}

/** Is the `const` initializer starting after `=` a function (arrow or function expression)? */
function initializerIsFunction(text: string, eq: number): boolean {
  let j = nextSignificant(text, eq + 1);
  if (/^async[\s(]/.test(text.slice(j, j + 7))) j = nextSignificant(text, j + 5);
  if (text.startsWith('function', j)) return true;
  if (text[j] === '(') {
    const close = matchParen(text, j);
    let k = nextSignificant(text, close + 1);
    if (text[k] === ':') {
      // Skip the return-type annotation to whatever follows it.
      const body = findBodyBrace(text, close + 1);
      if (body !== null) return false; // `: T { …` cannot follow a paren initializer; defensive
      // No body brace: look for the arrow textually within the annotation's reach.
      const stop = statementEnd(text, close);
      return text.slice(close, stop).includes('=>');
    }
    return text[k] === '=' && text[k + 1] === '>';
  }
  if (WORD.test(text[j] ?? '')) {
    // Single-parameter arrow without parens: `x => …`
    let k = j;
    while (k < text.length && WORD.test(text[k] as string)) k += 1;
    k = nextSignificant(text, k);
    return text[k] === '=' && text[k + 1] === '>';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Imports (spec 05 §3 P3) — the reader family of imports.ts / check-inv003
// ---------------------------------------------------------------------------

const CLAUSE_OK = /^[\sA-Za-z_$0-9{},*]*$/;
const STATIC_RE = /(?:^|[\s;}])(import|export)([\s\S]*?)\sfrom\s*(['"])([^'"]*)\3/g;
const BARE_RE = /(?:^|[\s;}])import\s*(['"])([^'"]*)\1/g;
const DYNAMIC_RE = /\b(import|require)\s*\(\s*(['"])([^'"]*)\2/g;

function parseBindings(clause: string, wholeTypeOnly: boolean): readonly ImportBinding[] {
  const out: ImportBinding[] = [];
  const braceStart = clause.indexOf('{');
  let head = braceStart === -1 ? clause : clause.slice(0, braceStart);
  if (wholeTypeOnly) head = head.replace(/^\s*type\b/, ' ');

  const ns = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(head);
  if (ns !== null) {
    out.push({ local: ns[1] as string, imported: '*', kind: 'namespace', typeOnly: wholeTypeOnly });
    head = head.replace(ns[0], ' '); // so the namespace's local cannot be misread as a default
  }
  const def = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(head.trim().length > 0 ? head.trimStart() : '');
  if (def !== null && def[1] !== undefined) {
    out.push({ local: def[1], imported: 'default', kind: 'default', typeOnly: wholeTypeOnly });
  }
  if (braceStart !== -1) {
    const braceEnd = clause.indexOf('}', braceStart);
    const inner = clause.slice(braceStart + 1, braceEnd === -1 ? undefined : braceEnd);
    for (const raw of inner.split(',')) {
      const m = /^\s*(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(raw);
      if (m === null) continue;
      out.push({
        local: (m[3] ?? m[2]) as string,
        imported: m[2] as string,
        kind: 'named',
        typeOnly: wholeTypeOnly || m[1] !== undefined,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The extractor
// ---------------------------------------------------------------------------

export function extractModule(source: string): ModuleExtraction {
  const structure = blankSource(source);
  const importScan = blankSource(source, { keepQuotedStrings: true });
  const offsets = lineStartOffsets(structure);
  const braces = indexBraces(structure);
  const allLines = lines(structure, offsets);

  const definitions: ExtractedDefinition[] = [];
  let defaultExportName: string | null = null;

  const endLineOfBrace = (open: number): number =>
    lineOfOffset(offsets, braces.closeOf.get(open) ?? structure.length - 1);

  const pushDef = (
    name: string,
    form: DefinitionForm,
    start: number,
    end: number,
    exported: boolean,
    memberOf: string | null,
  ): number => {
    definitions.push({ name, form, start, end, exported, memberOf });
    return definitions.length - 1;
  };

  interface PendingClass {
    readonly defIndex: number;
    readonly bodyOpen: number;
    readonly headerStart: number;
  }
  const classes: PendingClass[] = [];
  const heritage: ExtractedHeritage[] = [];

  // First `{` at zero <>-depth from `i` — a class/interface header's body brace.
  const headerBodyBrace = (i: number): number => {
    let angle = 0;
    for (let j = i; j < structure.length; j += 1) {
      const c = structure[j] as string;
      if (c === '=' && structure[j + 1] === '>') {
        j += 1;
        continue;
      }
      if (c === '<') angle += 1;
      else if (c === '>') angle = Math.max(0, angle - 1);
      else if (c === '{' && angle === 0) return j;
      else if (c === ';' && angle === 0) return structure.length - 1;
    }
    return structure.length - 1;
  };

  const readHeritage = (headerStart: number, bodyOpen: number, defIndex: number): void => {
    const header = structure.slice(headerStart, bodyOpen);
    const at = lineOfOffset(offsets, headerStart);
    const ext = /\bextends\s+([^{]*?)(?:\bimplements\b|$)/.exec(header);
    if (ext !== null) {
      for (const raw of (ext[1] as string).split(',')) {
        const m = /^\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/.exec(raw);
        if (m === null || m[1] === undefined || m[0].trim().length === 0) continue;
        const via = m[2] === undefined ? null : m[1];
        const name = m[2] ?? m[1];
        heritage.push({ kind: 'extends', name, via, at, from: defIndex });
      }
    }
    const impl = /\bimplements\s+([^{]*)$/.exec(header);
    if (impl !== null) {
      for (const raw of (impl[1] as string).split(',')) {
        const m = /^\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/.exec(raw);
        if (m === null || m[1] === undefined || m[0].trim().length === 0) continue;
        const via = m[2] === undefined ? null : m[1];
        const name = m[2] ?? m[1];
        heritage.push({ kind: 'implements', name, via, at, from: defIndex });
      }
    }
  };

  // ── top-level pass ──────────────────────────────────────────────────────────
  for (const line of allLines) {
    if ((braces.depthAtLine[line.n] ?? 0) !== 0) continue;

    let m: RegExpExecArray | null;
    if ((m = TOP_FUNCTION.exec(line.text)) !== null) {
      const exported = m[2] !== undefined;
      const isDefault = m[3] !== undefined;
      const name = m[5] ?? (isDefault ? 'default' : null);
      if (name === null) continue;
      const parenAt = structure.indexOf('(', line.start + m[0].length - 1);
      if (parenAt === -1) continue;
      const afterParams = matchParen(structure, parenAt) + 1;
      const body = findBodyBrace(structure, afterParams);
      const end =
        body === null
          ? lineOfOffset(offsets, statementEnd(structure, line.start))
          : endLineOfBrace(body);
      const idx = pushDef(name, 'function', line.n, end, exported, null);
      if (isDefault) {
        defaultExportName = name;
        (definitions[idx] as ExtractedDefinition).exported = true;
      }
      continue;
    }
    if ((m = TOP_CLASS.exec(line.text)) !== null) {
      const exported = m[2] !== undefined || m[3] !== undefined;
      const name = m[5] ?? 'default';
      const headerStart = line.start;
      const bodyOpen = headerBodyBrace(line.start + m[0].length);
      const idx = pushDef(name, 'class', line.n, endLineOfBrace(bodyOpen), exported, null);
      if (m[3] !== undefined) defaultExportName = name;
      classes.push({ defIndex: idx, bodyOpen, headerStart });
      readHeritage(headerStart, bodyOpen, idx);
      continue;
    }
    if ((m = TOP_INTERFACE.exec(line.text)) !== null) {
      const headerStart = line.start;
      const bodyOpen = headerBodyBrace(line.start + m[0].length);
      const idx = pushDef(
        m[3] as string,
        'interface',
        line.n,
        endLineOfBrace(bodyOpen),
        m[2] !== undefined,
        null,
      );
      readHeritage(headerStart, bodyOpen, idx);
      continue;
    }
    if ((m = TOP_ENUM.exec(line.text)) !== null) {
      const bodyOpen = structure.indexOf('{', line.start + m[0].length - 1);
      if (bodyOpen === -1) continue;
      pushDef(m[5] as string, 'enum', line.n, endLineOfBrace(bodyOpen), m[2] !== undefined, null);
      continue;
    }
    if ((m = TOP_TYPE.exec(line.text)) !== null) {
      const end = lineOfOffset(offsets, statementEnd(structure, line.start));
      pushDef(m[3] as string, 'type-alias', line.n, end, m[2] !== undefined, null);
      continue;
    }
    if ((m = TOP_CONST.exec(line.text)) !== null) {
      const eq = structure.indexOf('=', line.start + m[0].length - 1);
      const end = lineOfOffset(offsets, statementEnd(structure, line.start));
      const form: DefinitionForm =
        eq !== -1 && initializerIsFunction(structure, eq) ? 'function' : 'const';
      pushDef(m[3] as string, form, line.n, end, m[2] !== undefined, null);
      continue;
    }
  }

  // ── class-member pass ───────────────────────────────────────────────────────
  for (const cls of classes) {
    const owner = definitions[cls.defIndex] as ExtractedDefinition;
    const memberKey = `${owner.name}@${owner.start}`;
    const bodyDepth = (braces.depthAtLine[lineOfOffset(offsets, cls.bodyOpen)] ?? 0) + 1;
    for (const line of allLines) {
      if (line.n <= owner.start || line.n >= owner.end) continue;
      if ((braces.depthAtLine[line.n] ?? 0) !== bodyDepth) continue;
      if (/^\s*@/.test(line.text)) continue; // decorators

      const mm = MEMBER_METHOD.exec(line.text);
      // `constructor` is a legitimate METHOD NAME even though it is a forbidden CALLEE.
      if (mm !== null && (mm[3] === 'constructor' || !CALL_KEYWORDS.has(mm[3] as string))) {
        const parenAt = structure.indexOf('(', line.start + mm[0].length - 1);
        if (parenAt !== -1) {
          const afterParams = matchParen(structure, parenAt) + 1;
          const body = findBodyBrace(structure, afterParams);
          const end =
            body === null
              ? lineOfOffset(offsets, statementEnd(structure, line.start))
              : endLineOfBrace(body);
          pushDef(mm[3] as string, 'method', line.n, end, false, memberKey);
          continue;
        }
      }
      const mp = MEMBER_PROPERTY_FN.exec(line.text);
      if (mp !== null && !CALL_KEYWORDS.has(mp[3] as string)) {
        const eq = line.start + (mp[0].length - 1);
        if (structure[eq] === '=' && initializerIsFunction(structure, eq)) {
          const end = lineOfOffset(offsets, statementEnd(structure, line.start));
          pushDef(mp[3] as string, 'method', line.n, end, false, memberKey);
        }
      }
    }
  }

  // ── export-list pass (marks exportedness after the fact) ────────────────────
  const byName = new Map<string, ExtractedDefinition[]>();
  for (const d of definitions) {
    if (d.memberOf !== null) continue;
    const list = byName.get(d.name) ?? [];
    list.push(d);
    byName.set(d.name, list);
  }
  const markExported = (local: string, as: string): void => {
    for (const d of byName.get(local) ?? []) d.exported = true;
    if (as === 'default' && (byName.get(local) ?? []).length > 0) defaultExportName = local;
  };
  const EXPORT_LIST = /(?:^|[\s;}])export\s*\{([^}]*)\}(?!\s*from)/g;
  EXPORT_LIST.lastIndex = 0;
  let em: RegExpExecArray | null;
  while ((em = EXPORT_LIST.exec(structure)) !== null) {
    for (const raw of (em[1] as string).split(',')) {
      const p = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(raw);
      if (p === null) continue;
      markExported(p[1] as string, p[2] ?? (p[1] as string));
    }
  }
  const EXPORT_DEFAULT = /(?:^|[\s;}])export\s+default\s+([A-Za-z_$][\w$]*)\s*;/g;
  EXPORT_DEFAULT.lastIndex = 0;
  while ((em = EXPORT_DEFAULT.exec(structure)) !== null) {
    markExported(em[1] as string, 'default');
  }

  // ── imports (over importScan, keyword cross-checked against structure) ──────
  const imports: ExtractedImport[] = [];
  const keywordIsCode = (matchStart: number, matched: string, keyword: string): boolean => {
    const k = matchStart + matched.indexOf(keyword);
    return structure.startsWith(keyword, k);
  };

  STATIC_RE.lastIndex = 0;
  let im: RegExpExecArray | null;
  while ((im = STATIC_RE.exec(importScan)) !== null) {
    const clause = im[2] ?? '';
    if (!CLAUSE_OK.test(clause)) {
      STATIC_RE.lastIndex = im.index + 1; // rewind so a swallowed statement is still scanned
      continue;
    }
    const keyword = im[1] as string;
    if (!keywordIsCode(im.index, im[0], keyword)) continue;
    const specifier = im[4] ?? '';
    const at = lineOfOffset(offsets, im.index + im[0].lastIndexOf(specifier));
    const wholeTypeOnly = /^\s*type[\s{*]/.test(clause);
    const form: NexusImportForm = wholeTypeOnly
      ? 'type-only'
      : keyword === 'export'
        ? 're-export'
        : 'value';
    const bindings = keyword === 'import' ? parseBindings(clause, wholeTypeOnly) : [];
    imports.push({ specifier, form, at, bindings });
  }
  BARE_RE.lastIndex = 0;
  while ((im = BARE_RE.exec(importScan)) !== null) {
    if (!keywordIsCode(im.index, im[0], 'import')) continue;
    const specifier = im[2] ?? '';
    imports.push({
      specifier,
      form: 'value',
      at: lineOfOffset(offsets, im.index + im[0].lastIndexOf(specifier)),
      bindings: [],
    });
  }
  DYNAMIC_RE.lastIndex = 0;
  while ((im = DYNAMIC_RE.exec(importScan)) !== null) {
    if (!keywordIsCode(im.index, im[0], im[1] as string)) continue;
    const specifier = im[3] ?? '';
    imports.push({
      specifier,
      form: 'dynamic',
      at: lineOfOffset(offsets, im.index + im[0].lastIndexOf(specifier)),
      bindings: [],
    });
  }
  imports.sort((a, b) => a.at - b.at || (a.specifier < b.specifier ? -1 : 1));

  // ── call sites (spec 05 §3 P4), inside innermost definition spans only ──────
  const declAt = new Set<string>(definitions.map((d) => `${d.start}:${d.name}`));
  const innermostAt = (n: number): number => {
    let best = -1;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let i = 0; i < definitions.length; i += 1) {
      const d = definitions[i] as ExtractedDefinition;
      const size = d.end - d.start;
      if (d.start <= n && n <= d.end && size < bestSize) {
        best = i;
        bestSize = size;
      }
    }
    return best;
  };

  const calls: ExtractedCallSite[] = [];
  const qualifiedNameStarts = new Set<number>();

  // Only a namespace import makes a qualified call resolvable; every other receiver call is
  // invisible on purpose — not counted, not guessed (spec 05 §3.1).
  const namespaceLocals = new Set<string>();
  for (const imp of imports) {
    for (const b of imp.bindings) {
      if (b.kind === 'namespace' && !b.typeOnly) namespaceLocals.add(b.local);
    }
  }

  const QUAL_CALL = /([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  QUAL_CALL.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = QUAL_CALL.exec(structure)) !== null) {
    const propStart = cm.index + cm[0].lastIndexOf(cm[2] as string);
    qualifiedNameStarts.add(propStart);
    if (!namespaceLocals.has(cm[1] as string)) continue;
    const p = prevSignificant(structure, cm.index);
    if (p >= 0 && ((structure[p] as string) === '.' || WORD.test(structure[p] as string))) continue;
    const line = lineOfOffset(offsets, cm.index);
    const enclosing = innermostAt(line);
    if (enclosing === -1) continue;
    calls.push({ name: cm[2] as string, via: cm[1] as string, at: line, enclosing });
  }

  const BARE_CALL = /([A-Za-z_$#][\w$]*)\s*\(/g;
  BARE_CALL.lastIndex = 0;
  while ((cm = BARE_CALL.exec(structure)) !== null) {
    const name = cm[1] as string;
    if (CALL_KEYWORDS.has(name)) continue;
    if (qualifiedNameStarts.has(cm.index)) continue; // handled (or rejected) as a property call
    const p = prevSignificant(structure, cm.index);
    if (p >= 0) {
      const prev = structure[p] as string;
      if (prev === '.') continue; // receiver call — invisible on purpose (spec 05 §3.1)
      if (WORD.test(prev)) {
        const word = wordEndingAt(structure, p);
        if (word === 'function' || word === 'class' || word === 'interface' || word === 'enum') {
          continue; // a declaration head, not a call
        }
      }
    }
    const line = lineOfOffset(offsets, cm.index);
    if (declAt.has(`${line}:${name}`)) continue; // its own declaration line
    const enclosing = innermostAt(line);
    if (enclosing === -1) continue; // top-level statement — outside every definition span
    calls.push({ name, via: null, at: line, enclosing });
  }
  calls.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { definitions, imports, calls, heritage, defaultExportName };
}
