import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';
import { splitFrontmatter, parseDoc, sortDocs, type DocEntry } from './load';

describe('parseInline', () => {
  it('parses code, bold, italic, and links', () => {
    expect(parseInline('a `x` b')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'code', v: 'x' },
      { t: 'text', v: ' b' },
    ]);
    expect(parseInline('**bold** and *em*')).toEqual([
      { t: 'strong', v: 'bold' },
      { t: 'text', v: ' and ' },
      { t: 'em', v: 'em' },
    ]);
    expect(parseInline('see [docs](https://x/y)')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', v: 'docs', href: 'https://x/y' },
    ]);
  });

  it('leaves markup inside code spans literal', () => {
    expect(parseInline('`a*b*c`')).toEqual([{ t: 'code', v: 'a*b*c' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists, code fences, quotes, and rules', () => {
    const md = [
      '# Title',
      '',
      'A para with **bold**.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '> a quote',
      '',
      '---',
    ].join('\n');
    const blocks = parseMarkdown(md);
    expect(blocks[0]).toMatchObject({ t: 'heading', level: 1 });
    expect(blocks[1].t).toBe('para');
    expect(blocks[2]).toMatchObject({ t: 'list', ordered: false });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[3]).toMatchObject({ t: 'list', ordered: true });
    expect(blocks[4]).toMatchObject({ t: 'code', lang: 'ts', text: 'const x = 1;' });
    expect(blocks[5].t).toBe('quote');
    expect(blocks[6]).toEqual({ t: 'hr' });
  });

  it('joins wrapped paragraph lines and is total on empty input', () => {
    expect(parseMarkdown('line one\nline two')).toEqual([
      { t: 'para', spans: [{ t: 'text', v: 'line one line two' }] },
    ]);
    expect(parseMarkdown('')).toEqual([]);
  });

  it('does not treat markup inside a code fence as blocks', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: 'code', text: '# not a heading\n- not a list' });
  });
});

describe('frontmatter + doc parsing', () => {
  it('splits frontmatter and never throws on bad yaml', () => {
    expect(splitFrontmatter('---\ntitle: X\n---\nbody here')).toEqual({
      data: { title: 'X' },
      body: 'body here',
    });
    expect(splitFrontmatter('no frontmatter').data).toEqual({});
    expect(splitFrontmatter('---\n: : bad\n---\nb').data).toEqual({});
  });

  it('parseDoc derives a title from the slug when frontmatter lacks one', () => {
    expect(parseDoc('_docs/feedback-loops.md', '# Body').title).toBe('Feedback Loops');
    expect(parseDoc('_docs/x.md', '---\ntitle: Custom\ndescription: d\n---\nbody').title).toBe('Custom');
  });

  it('sortDocs honors a numeric order map, then title', () => {
    const d = (slug: string, title: string): DocEntry => ({ slug, title, description: '', body: '', path: `_docs/${slug}.md` });
    const sorted = sortDocs([d('b', 'B'), d('a', 'A'), d('c', 'C')], { c: 1, a: 2 });
    expect(sorted.map((x) => x.slug)).toEqual(['c', 'a', 'b']); // ordered first (1,2), then unordered by title
  });
});
