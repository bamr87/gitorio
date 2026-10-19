// Implements: docs/spec/05-nexus.md §4 (storage: `.gwtp/nexus/`, gitignored, derived,
// rebuildable — a cache with a contract, never a store of record) and §1.1 (the builder's
// input is TREE BYTES ONLY: this module walks a directory; it never runs git, never reads
// commit metadata, and has no way to hand the builder an author).
//
// The fs seam of src/nexus — everything else in the package is pure. `.gwtp/` rather than a
// new dotdir on purpose: it is already the home of machine outputs that are observations
// ABOUT the repository rather than part of it (bare-mode proposals, Q-53), and it is exactly
// where GitNexus keeps its own index (`.gitnexus/`, gitignored) — the concept adapted intact.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { RepoPath } from '../core/paths.js';
import { parseRepoPath } from '../core/paths.js';
import { fail, type Parsed } from '../core/result.js';
import type { FileSnapshot } from './build.js';
import {
  type NexusDocument,
  decodeNexusDocument,
  encodeNexusDocument,
} from './serialize.js';

export const DEFAULT_NEXUS_DIR = '.gwtp/nexus';
export const DEFAULT_NEXUS_FILE = 'graph.json';

/** Where a repo's cached artifact lives (spec 05 §4). */
export function nexusCachePath(repoRoot: string): string {
  return join(repoRoot, DEFAULT_NEXUS_DIR, DEFAULT_NEXUS_FILE);
}

/**
 * Directories a tree walk never enters. Fixed and small: dependency trees and build output
 * are not the repository's own program, and `.gwtp/` would make the cache perceive itself.
 */
export const SNAPSHOT_SKIP_DIRS: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.gwtp',
];

/**
 * One tree state as `(path, content)` pairs, sorted by path. Every regular file is included —
 * spec 05 §3 P1's "no file is skipped" — but a file that is not valid text for perception
 * purposes (it contains NUL) contributes an empty content, so it still gets a module node and
 * simply serves no ring. Deterministic for a given tree; the ONLY fs read the nexus does.
 */
export function collectTreeSnapshot(repoRoot: string): readonly FileSnapshot[] {
  const out: FileSnapshot[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs).sort()) {
      if (SNAPSHOT_SKIP_DIRS.includes(entry)) continue;
      const child = join(abs, entry);
      const st = statSync(child, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) {
        walk(child);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = relative(repoRoot, child).split(sep).join('/');
      const parsed = parseRepoPath(rel);
      if (!parsed.ok) continue;
      let content = '';
      try {
        content = readFileSync(child, 'utf8');
        if (content.includes('\u0000')) content = '';
      } catch {
        content = '';
      }
      out.push({ path: parsed.value, content });
    }
  };
  walk(repoRoot);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Overwrite-at-will (spec 05 politics table): the one write path src/nexus has. */
export function writeNexusCache(repoRoot: string, doc: NexusDocument): string {
  const dir = join(repoRoot, DEFAULT_NEXUS_DIR);
  mkdirSync(dir, { recursive: true });
  const path = nexusCachePath(repoRoot);
  writeFileSync(path, encodeNexusDocument(doc), 'utf8');
  return path;
}

export interface NexusCacheRead {
  readonly path: string;
  readonly doc: NexusDocument;
}

/**
 * Read the cached artifact back, or null when none exists. A cache that exists but cannot be
 * decoded is a FAILURE, not a null: silence and unreadability must stay distinct signals
 * (the exit-code rule of check-inv001, applied to a cache).
 */
export function readNexusCache(repoRoot: string): Parsed<NexusCacheRead> | null {
  const path = nexusCachePath(repoRoot);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return fail('wrong-type', `${path} is not valid JSON: ${(e as Error).message}`);
  }
  const doc = decodeNexusDocument(raw);
  if (!doc.ok) return doc;
  return { ok: true, value: { path, doc: doc.value } };
}

/** The ring assembler's file accessor (spec 05 §5 rule 3), keyed by repo-relative path. */
export function snapshotMap(files: readonly FileSnapshot[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const f of files) map.set(f.path, f.content);
  return map;
}
