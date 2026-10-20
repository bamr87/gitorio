// Implements: docs/spec/06-upkeep.md §2 (the facets' local half: what the tree and its history
// say) and §1.3 (identity-free observation).
//
// Every `git` call goes through the GitExec seam from src/ledger/git.ts (ADR-0006: shell out to
// the git CLI), and every one is READ-ONLY: rev-parse, for-each-ref, log, show, ls-tree, diff.
// Nothing here stages, commits, tags or moves a ref — tags are created through the forge by
// `apply`, never by this gatherer.
//
// IDENTITY-FREE BY CONSTRUCTION. No format string below asks git for %an/%ae/%cn/%ce, so no
// author or committer ever enters a CommitSummary, a brief, or a release note. Upkeep is not a
// blind module under INV-003's scope, but release notes are PUBLICATION, and the house posture
// (ADR-0003) is that who wrote a change is not evidence of what it did.
//
// The parsers are exported and pure; `gatherLocalFacts` is the only function that does I/O.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { globToRegExp } from '../core/paths.js';
import type { GitExec } from '../ledger/git.js';
import { compareSemVer, parseSemVer, semverTags } from './semver.js';
import type {
  CommitSummary,
  DocFile,
  LocalFacts,
  ReferenceFact,
  TagFact,
  TagHistory,
  UpkeepConfig,
  VersionFileFact,
} from './types.js';

/** Cap on commits carried per range: a brief is context, not an archive. */
export const MAX_COMMITS_PER_RANGE = 200;

const US = '\x1f';
const RS = '\x1e';

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

/** `for-each-ref refs/tags --format=%(refname:strip=2)%1f%(objectname)%1f%(*objectname)`. */
export function parseTagRefs(text: string): readonly TagFact[] {
  const out: TagFact[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const [name, object, peeled] = line.split(US);
    if (name === undefined || object === undefined) continue;
    out.push({ name, sha: peeled !== undefined && peeled !== '' ? peeled : object });
  }
  return out;
}

/** `log --format=%H%x1f%s%x1f%b%x1e`. Bodies are read only for `BREAKING CHANGE:`, then dropped. */
export function parseLog(text: string): readonly CommitSummary[] {
  const out: CommitSummary[] = [];
  for (const record of text.split(RS)) {
    const trimmed = record.replace(/^\n+/, '');
    if (trimmed.trim() === '') continue;
    const [sha, subject, body] = trimmed.split(US);
    if (sha === undefined || subject === undefined) continue;
    out.push({
      sha: sha.trim(),
      subject: subject.trim(),
      breaking: /^BREAKING[ -]CHANGE:/m.test(body ?? ''),
    });
  }
  return out;
}

/** Changed or tracked paths, counted per top-level directory (`.` for root files). */
export function countAreas(paths: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const p of paths) {
    if (p.trim() === '') continue;
    const slash = p.indexOf('/');
    const area = slash === -1 ? '.' : p.slice(0, slash);
    counts[area] = (counts[area] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** Markdown inline syntax stripped to the words a reader would see. */
export function plainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The README's tagline: the first prose paragraph after the first H1 — badges, images, HTML
 * comments and blockquotes skipped. This is what a human reads first, which is what a
 * repository description is for.
 */
export function readmeTagline(md: string): string | null {
  const lines = md.split('\n');
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  let i = h1 === -1 ? 0 : h1 + 1;
  let inComment = false;
  const para: string[] = [];
  for (; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }
    if (line === '') {
      if (para.length > 0) break;
      continue;
    }
    if (/^(#|>|\||```|---|\*\*\*|- |\* |\d+\. )/.test(line)) {
      if (para.length > 0) break;
      continue;
    }
    const text = plainText(line);
    if (text === '') continue; // a badge row
    para.push(text);
  }
  const out = para.join(' ').trim();
  return out === '' ? null : out;
}

/** The first match of a one-group pattern, with the 1-based line it starts on. */
export function captureVersion(path: string, text: string | null, pattern: string): VersionFileFact {
  if (text === null) return { path, value: null, line: null };
  const m = new RegExp(pattern, 'm').exec(text);
  if (m === null || m[1] === undefined) return { path, value: null, line: null };
  const line = text.slice(0, m.index).split('\n').length;
  return { path, value: m[1], line };
}

/** Items named by a reference rule, sorted and de-duplicated. */
export function extractItems(
  items: UpkeepConfig['references'][number]['items'],
  trackedPaths: readonly string[],
  readText: (path: string) => string | null,
): readonly string[] {
  const found = new Set<string>();
  if ('glob' in items) {
    const re = globToRegExp(items.glob);
    const capture = items.capture !== undefined ? new RegExp(items.capture) : null;
    for (const p of trackedPaths) {
      if (!re.test(p)) continue;
      if (capture === null) {
        found.add(p);
      } else {
        const m = capture.exec(p);
        if (m?.[1] !== undefined) found.add(m[1]);
      }
    }
  } else {
    const text = readText(items.file);
    if (text !== null) {
      const re = new RegExp(items.pattern, 'gm');
      for (const m of text.matchAll(re)) if (m[1] !== undefined) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** Items whose mention the document lacks. Case-insensitive substring — deliberately forgiving. */
export function missingMentions(
  doc: string,
  items: readonly string[],
  mention: string,
): readonly string[] {
  const hay = doc.toLowerCase();
  return items.filter((item) => !hay.includes(mention.replaceAll('{item}', item).toLowerCase()));
}

export function docFile(path: string, text: string, maxChars: number): DocFile {
  const truncated = text.length > maxChars;
  const body = truncated ? text.slice(0, maxChars) : text;
  return { path, lines: body.split('\n'), truncated };
}

// ---------------------------------------------------------------------------
// The gatherer (the only I/O in this module)
// ---------------------------------------------------------------------------

export interface GatherOptions {
  readonly root: string;
  readonly git: GitExec;
  readonly config: UpkeepConfig;
}

async function gitText(git: GitExec, args: readonly string[]): Promise<string | null> {
  const r = await git(args, { allowFailure: true });
  return r.code === 0 ? r.stdout : null;
}

async function commitsIn(git: GitExec, from: string | null, to: string): Promise<readonly CommitSummary[]> {
  const range = from === null ? to : `${from}..${to}`;
  const text = await gitText(git, [
    'log',
    '--no-merges',
    `-n`,
    String(MAX_COMMITS_PER_RANGE),
    `--format=%H${US}%s${US}%b${RS}`,
    range,
  ]);
  return text === null ? [] : parseLog(text);
}

/**
 * Where the source file's CURRENT version began: walk the commits that touched the file, newest
 * first, and keep going while the file still held this value. Tagging that commit (not HEAD)
 * keeps a backfilled tag honest about what the version actually shipped.
 */
async function versionIntroducedAt(
  git: GitExec,
  path: string,
  pattern: string,
  value: string,
  depth: number,
): Promise<string | null> {
  const log = await gitText(git, ['log', '--format=%H', '-n', String(depth), '--', path]);
  if (log === null) return null;
  let oldest: string | null = null;
  for (const sha of log.split('\n').map((s) => s.trim()).filter((s) => s !== '')) {
    const text = await gitText(git, ['show', `${sha}:${path}`]);
    const fact = captureVersion(path, text, pattern);
    if (fact.value !== value) break;
    oldest = sha;
  }
  return oldest;
}

export async function gatherLocalFacts(opts: GatherOptions): Promise<LocalFacts> {
  const { git, root, config } = opts;
  const readText = (p: string): string | null => {
    const full = join(root, p);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
  };

  const head = (await gitText(git, ['rev-parse', 'HEAD']))?.trim() ?? '';
  const branchRaw = (await gitText(git, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null;
  const branch = branchRaw === null || branchRaw === 'HEAD' ? null : branchRaw;

  // `ls-tree`, not `ls-files`: the ledger's GitExec points GIT_INDEX_FILE at a scratch path, and
  // the committed tree is the honest subject anyway — what a release would ship.
  const tracked = (await gitText(git, ['ls-tree', '-r', '--name-only', 'HEAD']))
    ?.split('\n')
    .filter((p) => p !== '') ?? [];

  // --- package.json, README, LICENSE --------------------------------------
  let pkg: LocalFacts['package'] = null;
  const pkgText = readText('package.json');
  if (pkgText !== null) {
    try {
      const j = JSON.parse(pkgText) as Record<string, unknown>;
      pkg = {
        name: typeof j['name'] === 'string' ? j['name'] : null,
        description: typeof j['description'] === 'string' ? j['description'] : null,
        keywords: Array.isArray(j['keywords']) ? j['keywords'].filter((k): k is string => typeof k === 'string') : [],
        license: typeof j['license'] === 'string' ? j['license'] : null,
      };
    } catch {
      pkg = null;
    }
  }
  const readmePath = tracked.find((p) => /^readme(\.md|\.markdown|\.txt)?$/i.test(p)) ?? null;
  const readmeText = readmePath === null ? null : readText(readmePath);
  const readme = readmePath === null ? null : { path: readmePath, tagline: readmeText === null ? null : readmeTagline(readmeText) };
  const licenseFile = tracked.find((p) => /^(licen[cs]e|copying)(\.[a-z]+)?$/i.test(p)) ?? null;

  // --- tags and version ---------------------------------------------------
  const tags = parseTagRefs(
    (await gitText(git, ['for-each-ref', 'refs/tags', `--format=%(refname:strip=2)${US}%(objectname)${US}%(*objectname)`])) ?? '',
  );
  const tagSha = new Map(tags.map((t) => [t.name, t.sha]));

  let version: LocalFacts['version'] = null;
  let unreleased: readonly CommitSummary[] = [];
  const history: TagHistory[] = [];
  const v = config.versioning;
  if (v !== undefined && v.files.length > 0) {
    const [sourceSpec, ...otherSpecs] = v.files;
    const source = captureVersion(sourceSpec!.path, readText(sourceSpec!.path), sourceSpec!.pattern);
    const others = otherSpecs.map((f) => captureVersion(f.path, readText(f.path), f.pattern));
    const tagName = source.value === null ? null : `${v.tag_prefix}${source.value}`;
    const existing = tagName === null ? undefined : tagSha.get(tagName);
    const introduced =
      source.value === null || existing !== undefined
        ? null
        : await versionIntroducedAt(git, sourceSpec!.path, sourceSpec!.pattern, source.value, v.history_depth);
    version = { source, others, introduced_at: introduced };

    const since = existing ?? introduced;
    if (since !== null && head !== '') unreleased = await commitsIn(git, since, head);

    // Release candidates: existing semver tags, plus the version's own tag when it is pending and
    // would be the newest. A pending tag OLDER than the latest is a regression the planner
    // reports; it is not something to backfill a release for.
    const ordered = semverTags(tags.map((t) => t.name), v.tag_prefix).map((t) => ({
      tag: t.tag,
      version: t.version,
      sha: tagSha.get(t.tag) as string,
      pending: false,
    }));
    const sv = source.value === null ? null : parseSemVer(source.value);
    const latest = ordered.at(-1);
    if (tagName !== null && sv !== null && existing === undefined && (latest === undefined || compareSemVer(sv, latest.version) > 0)) {
      ordered.push({ tag: tagName, version: sv, sha: introduced ?? head, pending: true });
    }
    const backfill = config.releases?.backfill ?? 0;
    const start = Math.max(0, ordered.length - backfill);
    for (let i = start; i < ordered.length; i++) {
      const cur = ordered[i]!;
      const prev = i > 0 ? ordered[i - 1]! : null;
      const commits = await commitsIn(git, prev?.sha ?? null, cur.sha);
      const changed =
        prev === null
          ? await gitText(git, ['ls-tree', '-r', '--name-only', cur.sha])
          : await gitText(git, ['diff', '--name-only', prev.sha, cur.sha]);
      history.push({
        tag: cur.tag,
        sha: cur.sha,
        previous: prev?.tag ?? null,
        pending: cur.pending,
        commits,
        areas: countAreas(changed?.split('\n') ?? []),
      });
    }
  }

  // --- references and docs ------------------------------------------------
  const references: ReferenceFact[] = config.references.map((r) => {
    const doc = readText(r.doc);
    const items = extractItems(r.items, tracked, readText);
    return {
      id: r.id,
      doc: r.doc,
      doc_exists: doc !== null,
      items,
      mention: r.mention,
      missing: doc === null ? items : missingMentions(doc, items, r.mention),
    };
  });

  const docs: DocFile[] = [];
  for (const p of config.docs_review?.files ?? []) {
    const text = readText(p);
    if (text !== null) docs.push(docFile(p, text, config.ai.max_chars_per_file));
  }

  return {
    head,
    branch,
    package: pkg,
    readme,
    license_file: licenseFile,
    version,
    tags,
    unreleased,
    history,
    references,
    docs,
    tree: countAreas(tracked),
  };
}
