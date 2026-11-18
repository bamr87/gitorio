// @vitest-environment node
// The head/meta block (UPS-FE-25, issue #167): links to the app unfurl with a description and
// a card, search shows a snippet, and the browser chrome takes the console's dark surface.
// Vite copies app/index.html's <head> into dist/index.html, so guarding the source guards the build.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/** The attribute values of every tag in <head> whose `key` attribute equals `value`. */
function tagAttr(tag: 'meta' | 'link', key: string, value: string, attr: string): string[] {
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  const tags = head.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];
  return tags
    .filter((t) => new RegExp(`\\b${key}="${value}"`).test(t))
    .map((t) => new RegExp(`\\b${attr}="([^"]*)"`).exec(t)?.[1] ?? '');
}

const meta = (name: string) => tagAttr('meta', 'name', name, 'content');
const prop = (property: string) => tagAttr('meta', 'property', property, 'content');
const PUBLIC_URL = 'https://bamr87.github.io/gitorio/';

describe('index.html head/meta block (UPS-FE-25)', () => {
  it('has a non-empty description and og:description', () => {
    expect(meta('description')).toHaveLength(1);
    expect(meta('description')[0].trim()).not.toBe('');
    expect(prop('og:description')).toHaveLength(1);
    expect(prop('og:description')[0].trim()).not.toBe('');
  });

  it('declares the canonical URL, and og:url is the same absolute address', () => {
    const canonical = tagAttr('link', 'rel', 'canonical', 'href');
    expect(canonical).toEqual([PUBLIC_URL]);
    expect(prop('og:url')).toEqual(canonical);
  });

  it('carries the Open Graph and Twitter card tags', () => {
    expect(prop('og:title')[0]?.trim()).toBeTruthy();
    expect(prop('og:type')).toEqual(['website']);
    expect(prop('og:site_name')[0]?.trim()).toBeTruthy();
    // No og:image asset yet, so the card stays `summary` (BACKLOG follow-up).
    expect(meta('twitter:card')).toEqual(['summary']);
  });

  it('sets theme-color to the console surface', () => {
    expect(meta('theme-color')).toEqual(['#020617']);
  });
});
