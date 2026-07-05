// A small, dependency-free Markdown → block-AST parser. GitFactory renders its own `_docs/`
// content (which it controls) into the Docs view; we parse to a typed AST and render it as
// React elements (no dangerouslySetInnerHTML). Covers the block + inline forms our docs use:
// headings, paragraphs, ordered/unordered lists, fenced code, blockquotes, rules, and inline
// code / bold / italic / links. PURE and total — never throws.

export type Span =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'link'; v: string; href: string };

export type Block =
  | { t: 'heading'; level: number; spans: Span[] }
  | { t: 'para'; spans: Span[] }
  | { t: 'list'; ordered: boolean; items: Span[][] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; spans: Span[] }
  | { t: 'hr' };

// Inline tokens, tried in priority order: code span, bold, link, italic. Non-global; we
// re-scan from each match's end. Code first so `*`/`_` inside backticks stays literal.
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)/;

/** Parse inline markdown in a single logical line into styled spans. */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let rest = text;
  let guard = 0;
  while (rest.length > 0 && guard++ < 10_000) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      spans.push({ t: 'text', v: rest });
      break;
    }
    if (m.index > 0) spans.push({ t: 'text', v: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith('`')) {
      spans.push({ t: 'code', v: tok.slice(1, -1) });
    } else if (tok.startsWith('**')) {
      spans.push({ t: 'strong', v: tok.slice(2, -2) });
    } else if (tok.startsWith('[')) {
      const close = tok.indexOf(']');
      const label = tok.slice(1, close);
      const href = tok.slice(close + 2, -1);
      spans.push({ t: 'link', v: label, href });
    } else {
      spans.push({ t: 'em', v: tok.slice(1, -1) });
    }
    rest = rest.slice(m.index + tok.length);
  }
  return spans.filter((s) => !(s.t === 'text' && s.v === ''));
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^(?:---|\*\*\*|___)\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+\.\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

/** Parse Markdown text into a block AST. */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      blocks.push({ t: 'code', lang, text: buf.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (HR.test(line.trim())) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ t: 'heading', level: h[1].length, spans: parseInline(h[2].trim()) });
      i++;
      continue;
    }

    // unordered / ordered list — collect consecutive matching lines
    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line) && !UL.test(line);
      const re = ordered ? OL : UL;
      const items: Span[][] = [];
      while (i < lines.length && re.test(lines[i])) {
        const m = re.exec(lines[i])!;
        items.push(parseInline(m[1].trim()));
        i++;
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    // blockquote — collect consecutive `>` lines
    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push(QUOTE.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ t: 'quote', spans: parseInline(buf.join(' ').trim()) });
      continue;
    }

    // paragraph — collect consecutive "plain" lines until a blank or a block starter
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i].trim()) &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !QUOTE.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: 'para', spans: parseInline(buf.join(' ')) });
  }

  return blocks;
}
