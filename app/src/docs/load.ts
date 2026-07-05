// Load the repo's `_docs/*.md` collection for the Docs view. The content is bundled at build
// time via `import.meta.glob` (raw), so whatever the Docs Gardener factory improves and you
// merge is what the next GitHub Pages deploy renders — a visible content loop. The frontmatter
// split + sort are pure (tested); `loadDocs()` is the thin Vite-glob wrapper.

import { parse as parseYaml } from 'yaml';

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  /** Markdown body (frontmatter stripped). */
  body: string;
  /** Source path, e.g. `_docs/machines.md`. */
  path: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** Split `---\n…\n---` frontmatter from the body. Never throws; bad YAML → empty data. */
export function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const m = FRONTMATTER.exec(raw);
  if (!m) return { data: {}, body: raw };
  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    /* malformed frontmatter — treat as none */
  }
  return { data, body: raw.slice(m[0].length) };
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const titleCase = (slug: string): string =>
  slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Parse one doc file into a DocEntry, deriving a title from the slug when frontmatter lacks one. */
export function parseDoc(path: string, raw: string): DocEntry {
  const slug = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
  const { data, body } = splitFrontmatter(raw);
  return {
    slug,
    title: str(data.title).trim() || titleCase(slug),
    description: str(data.description).trim(),
    body: body.trimStart(),
    path,
  };
}

/** Sort docs by an optional numeric `order` if present in the map, else alphabetically by title. */
export function sortDocs(entries: DocEntry[], orderBySlug: Record<string, number> = {}): DocEntry[] {
  return [...entries].sort((a, b) => {
    const oa = orderBySlug[a.slug];
    const ob = orderBySlug[b.slug];
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if (oa != null && ob == null) return -1;
    if (oa == null && ob != null) return 1;
    return a.title.localeCompare(b.title);
  });
}

// Eager raw glob of the repo-root `_docs/` collection (three levels up from app/src/docs/).
// Bundled into the client at build time → rendered on GitHub Pages.
const RAW = import.meta.glob('../../../_docs/*.md', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** All docs in `_docs/`, parsed + ordered by frontmatter `order` then title. Empty if none exist. */
export function loadDocs(): DocEntry[] {
  const entries: DocEntry[] = [];
  const orderBySlug: Record<string, number> = {};
  for (const [absPath, raw] of Object.entries(RAW)) {
    const path = `_docs/${absPath.split('/').pop() ?? absPath}`;
    const entry = parseDoc(path, raw);
    const { data } = splitFrontmatter(raw);
    const order = Number(data.order);
    if (Number.isFinite(order)) orderBySlug[entry.slug] = order;
    entries.push(entry);
  }
  return sortDocs(entries, orderBySlug);
}
