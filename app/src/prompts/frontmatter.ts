// Split/join YAML frontmatter (--- delimited) at the top of a markdown prompt. Pure; parses
// with the `yaml` package already in deps. Tolerates files with no frontmatter.

import { parse, stringify } from 'yaml';

export interface SplitPrompt {
  /** Parsed frontmatter object, or null when the file has none. */
  frontmatter: Record<string, unknown> | null;
  /** The markdown body (everything after the closing ---). */
  body: string;
  /** The original text, verbatim. */
  raw: string;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function splitPrompt(text: string): SplitPrompt {
  const m = FM.exec(text);
  if (!m) return { frontmatter: null, body: text, raw: text };
  let frontmatter: Record<string, unknown> | null;
  try {
    const parsed = parse(m[1]);
    frontmatter = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Malformed YAML — treat the whole thing as body so the editor never loses content.
    return { frontmatter: null, body: text, raw: text };
  }
  return { frontmatter, body: m[2], raw: text };
}

/** Reverse of splitPrompt: null frontmatter → body only; otherwise a fenced YAML block + body. */
export function joinPrompt(frontmatter: Record<string, unknown> | null, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return body;
  const yaml = stringify(frontmatter).replace(/\n$/, '');
  return `---\n${yaml}\n---\n${body}`;
}
