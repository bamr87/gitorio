import { describe, expect, it } from 'vitest';
import { splitPrompt, joinPrompt } from './frontmatter';

describe('frontmatter split/join', () => {
  it('splits a file with frontmatter into object + body', () => {
    const text = `---\ntitle: Triage\ndraft: true\n---\nHello body\nline 2`;
    const r = splitPrompt(text);
    expect(r.frontmatter).toEqual({ title: 'Triage', draft: true });
    expect(r.body).toBe('Hello body\nline 2');
    expect(r.raw).toBe(text);
  });

  it('treats a file with no frontmatter as all body', () => {
    const r = splitPrompt('just markdown\nno header');
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe('just markdown\nno header');
  });

  it('round-trips: join(split(x)) preserves structure', () => {
    const text = `---\ntitle: X\n---\nbody here`;
    const r = splitPrompt(text);
    const back = joinPrompt(r.frontmatter, r.body);
    expect(splitPrompt(back)).toMatchObject({ frontmatter: { title: 'X' }, body: 'body here' });
  });

  it('join with null/empty frontmatter returns body only', () => {
    expect(joinPrompt(null, 'body')).toBe('body');
    expect(joinPrompt({}, 'body')).toBe('body');
  });

  it('malformed YAML frontmatter falls back to body (never loses content)', () => {
    const text = `---\n: : bad\n---\nbody`;
    const r = splitPrompt(text);
    expect(r.body).toContain('body');
  });
});
