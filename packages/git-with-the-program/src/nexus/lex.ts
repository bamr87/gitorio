// Implements: docs/spec/05-nexus.md §3 P2 ("comments and string/template bodies are blanked
// first (newlines preserved, so line numbers survive), then declarations and brace-matched
// spans are read from what remains") — the lexical ground the whole extractor stands on.
//
// WHY BLANKING AND NOT TOKENS. Extraction is structural (spec 05 §3): it needs brace depth,
// declaration heads and call sites, at stable line numbers, from text that may contain braces
// inside strings, template literals, comments and REGEX LITERALS — this repository's own
// sources are full of `/[{}]/`-shaped regexes that would corrupt any naive depth counter.
// Blanking replaces every such interior character with a space, preserving offsets and
// newlines exactly, so every later pass runs on same-length text and reports true lines.
//
// Two modes, one lexer (spec 05 §3 P3): structure scanning blanks EVERYTHING; import scanning
// keeps single-/double-quoted string bodies (a specifier lives in one) while still blanking
// comments, templates and regexes — and the extractor then cross-checks each import keyword
// against the fully-blanked text, so an `import` mentioned inside a string or comment (this
// repository documents imports in prose constantly) can never mint an edge.
//
// STATED GAP (spec 05 §3.1 posture): regex-vs-division is decided by the standard
// last-significant-character heuristic. A regex literal in the rare position this misreads
// (e.g. immediately after `)`) is treated as code; the consequence is bounded — a possibly
// skewed brace depth in one file — and deterministic.

/** What `blankSource` is allowed to keep. */
export interface BlankOptions {
  /** Keep `'…'` / `"…"` bodies (import-scanning mode). Default false: blank them too. */
  readonly keepQuotedStrings?: boolean;
}

const REGEX_ALLOWED_BEFORE = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '^',
  '~',
]);

const REGEX_ALLOWED_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'case',
  'in',
  'of',
  'do',
  'else',
  'void',
  'delete',
  'new',
  'await',
  'yield',
  'throw',
]);

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}

/**
 * Would a `/` at position `i` start a regex literal, given the emitted text so far? Reads
 * BACKWARD over the output (already blanked, so string/comment content cannot fool it).
 */
function slashStartsRegex(out: readonly string[], i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (out[j] === ' ' || out[j] === '\n' || out[j] === '\t' || out[j] === '\r')) j -= 1;
  if (j < 0) return true;
  const prev = out[j] as string;
  if (REGEX_ALLOWED_BEFORE.has(prev)) return true;
  if (!isWordChar(prev)) return false; // `)`, `]`, quote, `.` … → division / continuation
  let k = j;
  while (k >= 0 && isWordChar(out[k] as string)) k -= 1;
  const word = out.slice(k + 1, j + 1).join('');
  return REGEX_ALLOWED_KEYWORDS.has(word);
}

type TemplateCtx = { readonly kind: 'template' } | { kind: 'expr'; depth: number };

/**
 * Same-length transform: every character of a comment, a template body, a regex body — and,
 * unless `keepQuotedStrings`, a string body and its quotes — becomes a space; newlines and
 * everything else survive verbatim. Pure and total; malformed input (an unterminated string)
 * simply blanks to end of line or file rather than throwing — the extractor's duty is to
 * degrade, never to block (spec 05 §3 P1).
 */
export function blankSource(source: string, options: BlankOptions = {}): string {
  const keepStrings = options.keepQuotedStrings === true;
  const out: string[] = [];
  const stack: TemplateCtx[] = [];

  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex';
  let mode: Mode = 'code';
  let regexInClass = false;

  const emit = (c: string): void => {
    out.push(c === '\n' ? '\n' : c);
  };
  const blank = (c: string): void => {
    out.push(c === '\n' ? '\n' : ' ');
  };

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i] as string;
    const next = source[i + 1];

    switch (mode) {
      case 'line': {
        if (c === '\n') {
          emit(c);
          mode = 'code';
        } else blank(c);
        continue;
      }
      case 'block': {
        if (c === '*' && next === '/') {
          blank(c);
          blank(next);
          i += 1;
          mode = 'code';
        } else blank(c);
        continue;
      }
      case 'single':
      case 'double': {
        const close = mode === 'single' ? "'" : '"';
        const put = keepStrings ? emit : blank;
        if (c === '\\' && next !== undefined) {
          put(c);
          put(next);
          i += 1;
          continue;
        }
        if (c === close) {
          put(c);
          mode = 'code';
          continue;
        }
        if (c === '\n') {
          // Unterminated string: recover at the line break rather than swallowing the file.
          emit(c);
          mode = 'code';
          continue;
        }
        put(c);
        continue;
      }
      case 'template': {
        if (c === '\\' && next !== undefined) {
          blank(c);
          blank(next);
          i += 1;
          continue;
        }
        if (c === '`') {
          blank(c);
          stack.pop(); // this template's own ctx
          const parent = stack[stack.length - 1];
          mode = parent === undefined ? 'code' : parent.kind === 'expr' ? 'code' : 'template';
          continue;
        }
        if (c === '$' && next === '{') {
          blank(c);
          blank(next);
          i += 1;
          stack.push({ kind: 'expr', depth: 0 });
          mode = 'code';
          continue;
        }
        blank(c);
        continue;
      }
      case 'regex': {
        if (c === '\\' && next !== undefined) {
          blank(c);
          blank(next);
          i += 1;
          continue;
        }
        if (c === '[') regexInClass = true;
        if (c === ']') regexInClass = false;
        if (c === '/' && !regexInClass) {
          blank(c);
          // Flags ride along blanked, so `/x/gi` leaves no stray identifiers behind.
          let j = i + 1;
          while (j < source.length && /[a-z]/i.test(source[j] as string)) {
            blank(source[j] as string);
            j += 1;
          }
          i = j - 1;
          mode = 'code';
          continue;
        }
        if (c === '\n') {
          emit(c); // unterminated regex: recover
          mode = 'code';
          continue;
        }
        blank(c);
        continue;
      }
      case 'code': {
        if (c === '/' && next === '/') {
          blank(c);
          blank(next);
          i += 1;
          mode = 'line';
          continue;
        }
        if (c === '/' && next === '*') {
          blank(c);
          blank(next);
          i += 1;
          mode = 'block';
          continue;
        }
        if (c === "'") {
          (keepStrings ? emit : blank)(c);
          mode = 'single';
          continue;
        }
        if (c === '"') {
          (keepStrings ? emit : blank)(c);
          mode = 'double';
          continue;
        }
        if (c === '`') {
          blank(c);
          stack.push({ kind: 'template' });
          mode = 'template';
          continue;
        }
        if (c === '/' && slashStartsRegex(out, i)) {
          blank(c);
          mode = 'regex';
          regexInClass = false;
          continue;
        }
        const ctx = stack[stack.length - 1];
        if (ctx !== undefined && ctx.kind === 'expr') {
          if (c === '{') ctx.depth += 1;
          if (c === '}') {
            if (ctx.depth === 0) {
              blank(c);
              stack.pop();
              mode = 'template';
              continue;
            }
            ctx.depth -= 1;
          }
        }
        emit(c);
        continue;
      }
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Offsets ↔ lines (shared by every scanning pass)
// ---------------------------------------------------------------------------

/** Character offset at which each 1-based line starts. `offsets[0]` is line 1's start (0). */
export function lineStartOffsets(text: string): readonly number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

/** 1-based line containing character offset `at`. Binary search; total for any `at >= 0`. */
export function lineOfOffset(offsets: readonly number[], at: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] as number) <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
