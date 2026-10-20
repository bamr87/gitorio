// Implements: docs/spec/04-distillation.md §2 (pass one — the deterministic fact base,
// exhaustive: "Walk every commit; no LLM"), §5 (empirical precision seeding: the violation-free
// span the negative-space prover produces) and §8 (the watermark: "the last SHA walked"). This is
// SEED-04 deliverable 1 — the fact miner. Zero model calls: pass one is deterministic and cheap,
// and "never let the expensive pass do the cheap pass's job" (spec 04 §0).
//
// GIT ACCESS goes THROUGH the injected `GitExec` seam from src/ledger/git.ts and reuses its
// readers (`revParse`, `catFileBatch`, `parseTreeEntries`). It re-shells NOTHING of its own and
// issues ONLY read subcommands (`rev-list`, `log`, `diff-tree`, `ls-tree`, `cat-file`,
// `rev-parse`), so it cannot mutate the repository it walks (SEED-04 constraint 7). Every test
// injects a real `GitExec` pointed at a THROWAWAY repo under $TMPDIR.
//
// INV-005: imports src/core, src/ledger/git.ts and one pure helper from a deterministic judge —
// nothing provider-specific, no @anthropic-ai/sdk. INV-003: the miner makes no model calls at all;
// author identity is captured ONLY into the dispersion partition (`AuthorFileMatrix`) and the
// message body has its identity trailers stripped at the plumbing boundary before any fact reads
// it (see `readCommitMetas`).

import {
  committerTimeFromEpochMillis,
  compareCommitterTime,
  contentHash,
  err,
  hashBlob,
  matchesGlob,
  ok,
  parseCommitSha,
  parseEpochId,
  parseRepoPath,
  unwrap,
} from '../core/index.js';
import type {
  CommitSha,
  CommitterTime,
  EpochId,
  PathGlob,
  RepoPath,
  Result,
  Sha256Ref,
} from '../core/index.js';
import {
  catFileBatch,
  createGitExec,
  parseTreeEntries,
  revParse,
} from '../ledger/git.js';
import type { GitEnvironment, GitExec, GitObjectId } from '../ledger/git.js';
// Pure, forge-list reuse (spec 04 §2's `forge-import` probe): the SAME `FORGE_MODULE_PATTERNS`
// the deterministic import judge uses, so "what counts as a forge" has ONE definition.
import { forgeModuleOf, normalizeImportSpecifier } from '../judge/deterministic/imports.js';

import {
  DEFAULT_FACT_BASE_CONFIG,
  DISPERSION_MARKER,
  authorHandle,
  configDigest,
  regularityKey,
} from './factbase.js';
import type {
  AuthorFileCell,
  AuthorFileMatrix,
  AuthorHandle,
  BoundaryProbe,
  BudgetExceeded,
  CoChangeEdge,
  CoChangeGraph,
  DependencyDelta,
  DirectoryEvent,
  DirectoryFacts,
  DirectoryLifecycle,
  DocFacts,
  DocSnapshot,
  Ecosystem,
  EpochBoundary,
  FactBase,
  FactBaseConfig,
  ImportEdge,
  ImportGraphSnapshot,
  IssueLink,
  LitigationFacts,
  ManifestEvent,
  ManifestTimeline,
  NegativeSpaceProof,
  RevertFact,
  WalkBudget,
} from './factbase.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  Public walk types
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface CommitRange {
  /** Exclusive lower-bound rev, or null to walk from the root commit. */
  readonly from: string | null;
  /** Inclusive upper-bound rev; a resume passes the watermark's `last_walked` here. */
  readonly to: string;
}

export type CommitOrder = 'oldest-first' | 'newest-first';

/** git diff name-status letters. `R`/`C` carry `oldPath` + `similarity`. */
export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface FileChange {
  readonly status: FileChangeStatus;
  readonly path: RepoPath;
  readonly oldPath?: RepoPath;
  readonly similarity?: number;
}

export interface CommitMeta {
  readonly sha: CommitSha;
  readonly parents: readonly CommitSha[];
  readonly committerTime: CommitterTime;
  readonly authorTime: CommitterTime;
  readonly subject: string;
  /** Body with identity trailers (`Co-Authored-By:` / `Signed-off-by:`) STRIPPED (INV-003, Q-09). */
  readonly body: string;
  /** DISPERSION-ONLY. Never enters a synthesizable fact or a model prompt (INV-003). */
  readonly author: AuthorHandle;
  readonly committer: AuthorHandle;
  readonly isMerge: boolean;
}

export interface WalkedCommit {
  readonly meta: CommitMeta;
  /** name-status vs first parent; empty for merges (no own content under git's default). */
  readonly changes: readonly FileChange[];
}

export interface MineInput {
  readonly range: CommitRange;
  /** Epoch boundaries from segmentation (SEED-04 deliverable 2). Defaults to a single tip epoch. */
  readonly boundaries?: readonly EpochBoundary[];
  readonly config?: FactBaseConfig;
}

export type MineOutcome = Result<FactBase, BudgetExceeded>;

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  Cost guard (spec 04 §7): internal exception, external Result
// ═══════════════════════════════════════════════════════════════════════════════════════════

class BudgetError extends Error {
  readonly info: BudgetExceeded;
  constructor(info: BudgetExceeded) {
    super(`walk budget exceeded: ${info.limit} (${info.seen} > ${info.cap})`);
    this.name = 'BudgetError';
    this.info = info;
  }
}

/**
 * Threads the two blob/tree caps through the walk. `maxCommits` is enforced up front in
 * `walkCommits`. A cap trip throws `BudgetError`, caught at `mineFactBase`'s boundary and turned
 * into `Err(BudgetExceeded)` — loud and typed, and distinct from a `GitError` (which propagates).
 */
class Guard {
  private blobBytes = 0;
  private treeEntries = 0;
  constructor(private readonly budget: WalkBudget) {}

  blobs(n: number): void {
    this.blobBytes += n;
    if (this.blobBytes > this.budget.maxBlobBytes) {
      throw new BudgetError({
        reason: 'budget-exceeded',
        limit: 'maxBlobBytes',
        seen: this.blobBytes,
        cap: this.budget.maxBlobBytes,
      });
    }
  }

  tree(n: number): void {
    this.treeEntries += n;
    if (this.treeEntries > this.budget.maxTreeEntries) {
      throw new BudgetError({
        reason: 'budget-exceeded',
        limit: 'maxTreeEntries',
        seen: this.treeEntries,
        cap: this.budget.maxTreeEntries,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  Read-only git plumbing (through the GitExec seam)
// ═══════════════════════════════════════════════════════════════════════════════════════════

const FIELD = '\x1f';
const RECORD = '\x1e';
const LOG_FORMAT =
  ['%H', '%P', '%ct', '%at', '%an <%ae>', '%cn <%ce>', '%s', '%b'].join(FIELD) + RECORD;

/** Full history in a FIXED, deterministic order — never git's default topo-then-whatever. */
export async function revListRange(
  git: GitExec,
  range: CommitRange,
  order: CommitOrder,
): Promise<readonly CommitSha[]> {
  const spec = range.from === null ? range.to : `${range.from}..${range.to}`;
  const args = ['rev-list', '--topo-order'];
  if (order === 'oldest-first') args.push('--reverse');
  args.push(spec);
  const r = await git(args);
  const out: CommitSha[] = [];
  for (const line of r.stdout.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    const p = parseCommitSha(t);
    if (p.ok) out.push(p.value);
  }
  return out;
}

/** `Co-Authored-By:` / `Signed-off-by:` lines removed — the pass-one enforcement of INV-003. */
function stripIdentityTrailers(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*(co-authored-by|signed-off-by)\s*:/i.test(line))
    .join('\n')
    .replace(/\s+$/, '');
}

/** One `git log` invocation per chunk, NOT one per commit. Returns a map keyed by sha. */
export async function readCommitMetas(
  git: GitExec,
  shas: readonly CommitSha[],
): Promise<ReadonlyMap<CommitSha, CommitMeta>> {
  const out = new Map<CommitSha, CommitMeta>();
  const CHUNK = 400;
  for (let start = 0; start < shas.length; start += CHUNK) {
    const chunk = shas.slice(start, start + CHUNK);
    const r = await git(['log', '--no-walk=unsorted', `--format=${LOG_FORMAT}`, ...chunk]);
    for (const rec of r.stdout.split(RECORD)) {
      const trimmed = rec.replace(/^\n/, '');
      if (trimmed.trim() === '') continue;
      const f = trimmed.split(FIELD);
      if (f.length < 8) continue;
      const shaP = parseCommitSha((f[0] ?? '').trim());
      if (!shaP.ok) continue;
      const parents: CommitSha[] = [];
      for (const raw of (f[1] ?? '').trim().split(/\s+/)) {
        if (raw === '') continue;
        const pp = parseCommitSha(raw);
        if (pp.ok) parents.push(pp.value);
      }
      const ct = committerTimeFromEpochMillis(Number(f[2]) * 1000);
      const at = committerTimeFromEpochMillis(Number(f[3]) * 1000);
      if (!ct.ok || !at.ok) continue;
      // A stray FIELD byte in a body is vanishingly unlikely; rejoin defensively so it never
      // truncates the body.
      const body = f.slice(7).join(FIELD);
      out.set(shaP.value, {
        sha: shaP.value,
        parents,
        committerTime: ct.value,
        authorTime: at.value,
        subject: f[6] ?? '',
        body: stripIdentityTrailers(body),
        author: authorHandle((f[4] ?? '').trim()),
        committer: authorHandle((f[5] ?? '').trim()),
        isMerge: parents.length > 1,
      });
    }
  }
  return out;
}

/** `git diff-tree -r --name-status [-M] <sha>` against the first parent (`--root` for a root commit). */
export async function diffAgainstFirstParent(
  git: GitExec,
  sha: CommitSha,
  detectRenames: boolean,
): Promise<readonly FileChange[]> {
  const args = ['diff-tree', '-r', '--no-commit-id', '--name-status', '-z', '--root'];
  if (detectRenames) args.push('-M');
  args.push(sha);
  const r = await git(args);
  return parseNameStatusZ(r.stdout);
}

/** Parse the NUL-delimited `--name-status -z` stream. R/C consume three tokens; others two. */
function parseNameStatusZ(stdout: string): readonly FileChange[] {
  const toks = stdout.split('\0');
  const out: FileChange[] = [];
  let i = 0;
  while (i < toks.length) {
    const status = toks[i] ?? '';
    if (status === '') {
      i += 1;
      continue;
    }
    const letter = status[0] as FileChangeStatus;
    if (letter === 'R' || letter === 'C') {
      const oldRaw = toks[i + 1];
      const newRaw = toks[i + 2];
      i += 3;
      if (oldRaw === undefined || newRaw === undefined) continue;
      const oldP = parseRepoPath(oldRaw);
      const newP = parseRepoPath(newRaw);
      if (!oldP.ok || !newP.ok) continue;
      const sim = Number.parseInt(status.slice(1), 10);
      out.push({
        status: letter,
        path: newP.value,
        oldPath: oldP.value,
        ...(Number.isFinite(sim) ? { similarity: sim } : {}),
      });
      continue;
    }
    const pathRaw = toks[i + 1];
    i += 2;
    if (pathRaw === undefined) continue;
    if (letter !== 'A' && letter !== 'M' && letter !== 'D' && letter !== 'T') continue;
    const p = parseRepoPath(pathRaw);
    if (p.ok) out.push({ status: letter, path: p.value });
  }
  return out;
}

/**
 * Blob ids for either the whole tree (`paths === null`, recursive) or a targeted set of paths, in
 * ONE `ls-tree` call. `-c core.quotePath=false` keeps unicode paths unquoted so `parseTreeEntries`
 * reads them. Reuses git.ts's `parseTreeEntries` — no re-implemented plumbing.
 */
async function treeBlobIds(
  git: GitExec,
  rev: string,
  paths: readonly RepoPath[] | null,
  guard: Guard,
): Promise<ReadonlyMap<RepoPath, GitObjectId>> {
  const base = ['-c', 'core.quotePath=false', 'ls-tree'];
  const args =
    paths === null
      ? [...base, '-r', '--full-tree', rev]
      : paths.length === 0
        ? null
        : [...base, rev, '--', ...paths];
  const out = new Map<RepoPath, GitObjectId>();
  if (args === null) return out;
  const r = await git(args);
  const parsed = parseTreeEntries(r.stdout);
  if (!parsed.ok) return out;
  for (const e of parsed.value) {
    if (e.type !== 'blob') continue;
    const p = parseRepoPath(e.name);
    if (p.ok) out.set(p.value, e.id);
  }
  guard.tree(out.size);
  return out;
}

/** Batch-read blob contents for an id map, counting bytes against the budget. */
async function readBlobContents(
  git: GitExec,
  idMap: ReadonlyMap<RepoPath, GitObjectId>,
  guard: Guard,
): Promise<ReadonlyMap<RepoPath, string>> {
  const ids = [...new Set(idMap.values())];
  const byId = await catFileBatch(git, ids);
  let bytes = 0;
  for (const id of ids) {
    const c = byId.get(id);
    if (c !== undefined) bytes += Buffer.byteLength(c, 'utf8');
  }
  guard.blobs(bytes);
  const out = new Map<RepoPath, string>();
  for (const [p, id] of idMap) {
    const c = byId.get(id);
    if (c !== undefined) out.set(p, c);
  }
  return out;
}

/** One blob at a rev, or `''` when the path is absent there (a deleted or not-yet-added file). */
async function readBlobAt(git: GitExec, rev: string, path: RepoPath, guard: Guard): Promise<string> {
  const idMap = await treeBlobIds(git, rev, [path], guard);
  if (idMap.size === 0) return '';
  const contents = await readBlobContents(git, idMap, guard);
  return contents.get(path) ?? '';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  walkCommits — the single per-commit fact-atom stream
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * `revListRange` + `readCommitMetas` + `diffAgainstFirstParent`, assembled into `WalkedCommit[]`.
 * Enforces the `maxCommits` half of the cost guard: past the cap it returns `Err(BudgetExceeded)`
 * rather than continuing.
 */
export async function walkCommits(
  git: GitExec,
  range: CommitRange,
  opts: { readonly order: CommitOrder; readonly detectRenames: boolean; readonly maxCommits: number },
): Promise<Result<readonly WalkedCommit[], BudgetExceeded>> {
  const shas = await revListRange(git, range, opts.order);
  if (shas.length > opts.maxCommits) {
    return err({ reason: 'budget-exceeded', limit: 'maxCommits', seen: shas.length, cap: opts.maxCommits });
  }
  const metas = await readCommitMetas(git, shas);
  const out: WalkedCommit[] = [];
  for (const sha of shas) {
    const meta = metas.get(sha);
    if (meta === undefined) continue;
    const changes = meta.isMerge ? [] : await diffAgainstFirstParent(git, sha, opts.detectRenames);
    out.push({ meta, changes });
  }
  return ok(out);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  Whole-range folds (author-free where they must be)
// ═══════════════════════════════════════════════════════════════════════════════════════════

function changedPathsOf(c: WalkedCommit): readonly RepoPath[] {
  const seen = new Set<string>();
  const out: RepoPath[] = [];
  for (const ch of c.changes) {
    if (!seen.has(ch.path)) {
      seen.add(ch.path);
      out.push(ch.path);
    }
  }
  return out;
}

/**
 * A mega-commit changing N files contributes N·(N−1)/2 co-change pairs. A commit above this
 * threshold still counts its files' individual change totals but contributes NO pairs — a
 * reviewable cap on quadratic fan-out. Least-committal (the spec states no cap);
 * docs/spec/OPEN-QUESTIONS.md Q-63.
 */
const COCHANGE_MAX_FILES = 200;

function buildCoChange(commits: readonly WalkedCommit[]): CoChangeGraph {
  const changeCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  let commitsConsidered = 0;

  for (const c of commits) {
    if (c.meta.isMerge) continue;
    const paths = changedPathsOf(c);
    if (paths.length === 0) continue;
    commitsConsidered += 1;
    for (const p of paths) changeCount.set(p, (changeCount.get(p) ?? 0) + 1);
    if (paths.length > COCHANGE_MAX_FILES) continue;
    const sorted = [...paths].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = `${sorted[i]}\0${sorted[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: CoChangeEdge[] = [];
  for (const [key, co] of pairCount) {
    const sep = key.indexOf('\0');
    const a = key.slice(0, sep) as RepoPath;
    const b = key.slice(sep + 1) as RepoPath;
    const aChanges = changeCount.get(a) ?? 0;
    const bChanges = changeCount.get(b) ?? 0;
    edges.push({
      a,
      b,
      coChanges: co,
      aChanges,
      bChanges,
      support: commitsConsidered === 0 ? 0 : co / commitsConsidered,
      confidence: Math.min(aChanges, bChanges) === 0 ? 0 : co / Math.min(aChanges, bChanges),
    });
  }
  edges.sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b));

  const nodes = [...changeCount.keys()].sort().map((p) => p as RepoPath);
  return { nodes, edges, commitsConsidered };
}

function resolveShaPrefix(prefix: string, all: readonly CommitSha[]): CommitSha | null {
  const p = prefix.toLowerCase();
  for (const sha of all) {
    if (sha.startsWith(p) || p.startsWith(sha)) return sha;
  }
  return null;
}

function buildLitigation(commits: readonly WalkedCommit[], allShas: readonly CommitSha[]): LitigationFacts {
  const reverts: RevertFact[] = [];
  const issueLinks: IssueLink[] = [];

  for (const c of commits) {
    const text = `${c.meta.subject}\n${c.meta.body}`;

    const rm = /this reverts commit ([0-9a-f]{7,40})/i.exec(text);
    if (rm) {
      const revertedRaw = (rm[1] ?? '').toLowerCase();
      const revertedP = parseCommitSha(revertedRaw);
      if (revertedP.ok) {
        reverts.push({
          revert: c.meta.sha,
          reverted: revertedP.value,
          revertedResolved: resolveShaPrefix(revertedRaw, allShas),
          committerTime: c.meta.committerTime,
          subject: c.meta.subject,
          // Run-independent: keyed by the reverted content, not by the (rebase-fragile) revert sha.
          regularity: regularityKey({ kind: 'revert', reverted: revertedRaw }),
        });
      }
    }

    const rel = new Map<number, 'fixes' | 'closes' | 'refs'>();
    for (const m of text.matchAll(/\bfix(?:es|ed)?\s+#(\d+)/gi)) rel.set(Number(m[1]), 'fixes');
    for (const m of text.matchAll(/\bclose(?:s|d)?\s+#(\d+)/gi)) {
      const n = Number(m[1]);
      if (rel.get(n) !== 'fixes') rel.set(n, 'closes');
    }
    for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_])#(\d+)/g)) {
      const n = Number(m[1]);
      if (!rel.has(n)) rel.set(n, 'refs');
    }
    for (const issue of [...rel.keys()].sort((a, b) => a - b)) {
      issueLinks.push({
        at: c.meta.sha,
        committerTime: c.meta.committerTime,
        issue,
        relation: rel.get(issue) as 'fixes' | 'closes' | 'refs',
        subject: c.meta.subject,
      });
    }
  }

  reverts.sort((a, b) => compareCommitterTime(a.committerTime, b.committerTime) || cmp(a.revert, b.revert));
  issueLinks.sort(
    (a, b) => compareCommitterTime(a.committerTime, b.committerTime) || a.issue - b.issue || cmp(a.at, b.at),
  );
  return { reverts, issueLinks };
}

function ancestorDirs(path: string): readonly string[] {
  const segs = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < segs.length; i += 1) out.push(segs.slice(0, i).join('/'));
  return out;
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/**
 * Directory lifecycles (spec 04 §2): simulate file membership across the oldest-first walk.
 * `created` = the commit that made a directory non-empty; `deleted` = the commit that emptied it;
 * `renamed` = an `R` change whose parent directory moved. A directory rename between epochs is a
 * structural break the segmenter reads (spec 04 §1).
 */
function buildDirectories(commits: readonly WalkedCommit[]): DirectoryFacts {
  const live = new Set<string>();
  const dirCount = new Map<string, number>();
  const createdAt = new Map<string, CommitSha>();
  const deletedAt = new Map<string, CommitSha>();
  const events: DirectoryEvent[] = [];
  const renamesByDir = new Map<string, DirectoryEvent[]>();

  const add = (path: string, sha: CommitSha, t: CommitterTime): void => {
    if (live.has(path)) return;
    live.add(path);
    for (const d of ancestorDirs(path)) {
      const n = (dirCount.get(d) ?? 0) + 1;
      dirCount.set(d, n);
      if (n === 1) {
        if (!createdAt.has(d)) createdAt.set(d, sha);
        deletedAt.delete(d);
        events.push({ kind: 'created', at: sha, committerTime: t, dir: d as RepoPath });
      }
    }
  };
  const remove = (path: string, sha: CommitSha, t: CommitterTime): void => {
    if (!live.has(path)) return;
    live.delete(path);
    for (const d of ancestorDirs(path)) {
      const n = Math.max(0, (dirCount.get(d) ?? 0) - 1);
      dirCount.set(d, n);
      if (n === 0) {
        deletedAt.set(d, sha);
        events.push({ kind: 'deleted', at: sha, committerTime: t, dir: d as RepoPath });
      }
    }
  };

  for (const c of commits) {
    if (c.meta.isMerge) continue;
    const sha = c.meta.sha;
    const t = c.meta.committerTime;
    const renamePairs = new Set<string>();
    for (const ch of c.changes) {
      if (ch.status === 'R' && ch.oldPath !== undefined) {
        const fromDir = posixDirname(ch.oldPath);
        const toDir = posixDirname(ch.path);
        if (fromDir !== toDir) {
          const key = `${fromDir}\0${toDir}`;
          if (!renamePairs.has(key)) {
            renamePairs.add(key);
            const ev: DirectoryEvent = {
              kind: 'renamed',
              at: sha,
              committerTime: t,
              dir: (toDir || '.') as RepoPath,
              ...(fromDir !== '' ? { fromDir: fromDir as RepoPath } : {}),
            };
            events.push(ev);
            const list = renamesByDir.get(toDir) ?? [];
            list.push(ev);
            renamesByDir.set(toDir, list);
          }
        }
      }
    }
    // Apply membership: removals (D + rename-old) before adds, so counts settle correctly.
    for (const ch of c.changes) {
      if (ch.status === 'D') remove(ch.path, sha, t);
      else if (ch.status === 'R' && ch.oldPath !== undefined) remove(ch.oldPath, sha, t);
    }
    for (const ch of c.changes) {
      if (ch.status === 'A' || ch.status === 'C' || ch.status === 'R') add(ch.path, sha, t);
    }
  }

  const lifecycles: DirectoryLifecycle[] = [];
  for (const dir of new Set(dirCount.keys())) {
    const alive = (dirCount.get(dir) ?? 0) > 0;
    lifecycles.push({
      dir: dir as RepoPath,
      createdAt: createdAt.get(dir) ?? null,
      deletedAt: alive ? null : (deletedAt.get(dir) ?? null),
      renames: renamesByDir.get(dir) ?? [],
      alive,
    });
  }
  lifecycles.sort((a, b) => cmp(a.dir, b.dir));
  events.sort(
    (a, b) =>
      compareCommitterTime(a.committerTime, b.committerTime) ||
      cmp(a.dir, b.dir) ||
      cmp(a.kind, b.kind) ||
      cmp(a.fromDir ?? '', b.fromDir ?? ''),
  );
  return { lifecycles, events };
}

/**
 * The author-file matrix (spec 04 §2). DISPERSION-SIDE: author identity lives ONLY in this
 * partition and never crosses into a synthesizable fact or a model prompt (INV-003).
 */
function buildAuthorMatrix(commits: readonly WalkedCommit[]): AuthorFileMatrix {
  const cells = new Map<string, { author: AuthorHandle; path: RepoPath; touches: number; first: CommitterTime; last: CommitterTime }>();
  for (const c of commits) {
    if (c.meta.isMerge) continue;
    const author = c.meta.author;
    const t = c.meta.committerTime;
    for (const ch of c.changes) {
      const key = `${author}\0${ch.path}`;
      const cell = cells.get(key);
      if (cell === undefined) {
        cells.set(key, { author, path: ch.path, touches: 1, first: t, last: t });
      } else {
        cell.touches += 1;
        if (compareCommitterTime(t, cell.first) < 0) cell.first = t;
        if (compareCommitterTime(t, cell.last) > 0) cell.last = t;
      }
    }
  }
  const arr: AuthorFileCell[] = [...cells.values()]
    .map((c) => ({ author: c.author, path: c.path, touches: c.touches, firstTouch: c.first, lastTouch: c.last }))
    .sort((a, b) => cmp(a.author, b.author) || cmp(a.path, b.path));
  return {
    cells: arr,
    authors: new Set(arr.map((c) => c.author)).size,
    paths: new Set(arr.map((c) => c.path)).size,
  };
}

// ── dependency-manifest diffs over time ───────────────────────────────────────────────────────

function safeJsonObject(text: string): Record<string, unknown> {
  if (text.trim() === '') return {};
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** npm package.json: the four dependency maps → typed deltas. */
function npmDeltas(oldText: string, newText: string): DependencyDelta[] {
  const oldPkg = safeJsonObject(oldText);
  const newPkg = safeJsonObject(newText);
  const groups: readonly [string, DependencyDelta['kind']][] = [
    ['dependencies', 'runtime'],
    ['devDependencies', 'dev'],
    ['peerDependencies', 'peer'],
    ['optionalDependencies', 'optional'],
  ];
  const deltas: DependencyDelta[] = [];
  for (const [field, kind] of groups) {
    const oldMap = safeJsonObject(JSON.stringify(oldPkg[field] ?? {}));
    const newMap = safeJsonObject(JSON.stringify(newPkg[field] ?? {}));
    for (const name of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
      const o = typeof oldMap[name] === 'string' ? (oldMap[name] as string) : oldMap[name] === undefined ? null : String(oldMap[name]);
      const n = typeof newMap[name] === 'string' ? (newMap[name] as string) : newMap[name] === undefined ? null : String(newMap[name]);
      if (o === null && n !== null) deltas.push({ name, change: 'added', from: null, to: n, kind });
      else if (o !== null && n === null) deltas.push({ name, change: 'removed', from: o, to: null, kind });
      else if (o !== null && n !== null && o !== n) deltas.push({ name, change: 'version-changed', from: o, to: n, kind });
    }
  }
  return deltas;
}

/** Generic (all non-npm ecosystems for v1, Q-62): a line-set diff, `kind: unknown`. */
function genericDeltas(oldText: string, newText: string): DependencyDelta[] {
  const lines = (t: string): Set<string> =>
    new Set(t.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')));
  const oldSet = lines(oldText);
  const newSet = lines(newText);
  const deltas: DependencyDelta[] = [];
  for (const l of oldSet) if (!newSet.has(l)) deltas.push({ name: l, change: 'removed', from: l, to: null, kind: 'unknown' });
  for (const l of newSet) if (!oldSet.has(l)) deltas.push({ name: l, change: 'added', from: null, to: l, kind: 'unknown' });
  return deltas;
}

function manifestDeltas(ecosystem: Ecosystem, oldText: string, newText: string): DependencyDelta[] {
  const deltas = ecosystem === 'npm' ? npmDeltas(oldText, newText) : genericDeltas(oldText, newText);
  return deltas.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.name, b.name) || cmp(a.change, b.change));
}

async function buildManifestTimeline(
  git: GitExec,
  commits: readonly WalkedCommit[],
  config: FactBaseConfig,
  guard: Guard,
): Promise<ManifestTimeline> {
  const manifestsSeen = new Set<string>();
  const events: ManifestEvent[] = [];
  for (const c of commits) {
    if (c.meta.isMerge) continue;
    const parent = c.meta.parents[0] ?? null;
    for (const ch of c.changes) {
      const matcher = config.manifestFiles.find((m) => matchesGlob(m.glob, ch.path));
      if (matcher === undefined) continue;
      manifestsSeen.add(ch.path);
      const oldPath = ch.oldPath ?? ch.path;
      const oldText = parent === null ? '' : await readBlobAt(git, parent, oldPath, guard);
      const newText = ch.status === 'D' ? '' : await readBlobAt(git, c.meta.sha, ch.path, guard);
      const deltas = manifestDeltas(matcher.ecosystem, oldText, newText);
      if (deltas.length === 0) continue;
      events.push({
        at: c.meta.sha,
        committerTime: c.meta.committerTime,
        manifest: ch.path,
        ecosystem: matcher.ecosystem,
        deltas,
        churn: deltas.length,
      });
    }
  }
  events.sort(
    (a, b) => compareCommitterTime(a.committerTime, b.committerTime) || cmp(a.manifest, b.manifest) || cmp(a.at, b.at),
  );
  return { manifests: [...manifestsSeen].sort().map((p) => p as RepoPath), events };
}

// ── imports: whole-file scanner (shape mirrors the deterministic judge's diff scanner) ────────

interface ScannedImport {
  readonly specifier: string;
  readonly kind: ImportEdge['kind'];
  readonly line: number;
}

const CLAUSE_OK = /^[\sA-Za-z_$0-9{},*]*$/;
const STATIC_RE = /(?:^|[\s;}])(import|export)([\s\S]*?)\sfrom\s*(['"])([^'"]*)\3/g;
const BARE_RE = /(?:^|[\s;}])import\s*(['"])([^'"]*)\1/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*(['"])([^'"]*)\1/g;

function scanImports(text: string): readonly ScannedImport[] {
  const found: ScannedImport[] = [];
  const lineOf = (idx: number): number => {
    let n = 1;
    const end = Math.min(idx, text.length);
    for (let i = 0; i < end; i += 1) if (text.charCodeAt(i) === 10) n += 1;
    return n;
  };

  STATIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATIC_RE.exec(text)) !== null) {
    const clause = m[2] ?? '';
    if (!CLAUSE_OK.test(clause)) {
      STATIC_RE.lastIndex = m.index + 1;
      continue;
    }
    const specifier = m[4] ?? '';
    const typeOnly = /^\s*type[\s{*]/.test(clause);
    const kind: ImportEdge['kind'] = typeOnly ? 'type-only' : m[1] === 'export' ? 're-export' : 'value';
    found.push({ specifier, kind, line: lineOf(m.index + m[0].lastIndexOf(specifier)) });
  }
  BARE_RE.lastIndex = 0;
  while ((m = BARE_RE.exec(text)) !== null) {
    const specifier = m[2] ?? '';
    found.push({ specifier, kind: 'value', line: lineOf(m.index + m[0].lastIndexOf(specifier)) });
  }
  DYNAMIC_RE.lastIndex = 0;
  while ((m = DYNAMIC_RE.exec(text)) !== null) {
    const specifier = m[2] ?? '';
    found.push({ specifier, kind: 'dynamic', line: lineOf(m.index + m[0].lastIndexOf(specifier)) });
  }
  return found;
}

/** Relative (`.`/`/`) → intra-repo; a bare package or `node:` builtin → external. */
function isExternalSpecifier(spec: string): boolean {
  const s = normalizeImportSpecifier(spec);
  if (s.length === 0) return false;
  return !(s.startsWith('.') || s.startsWith('/'));
}

function resolveRelative(
  fromPath: string,
  specifier: string,
  treePaths: ReadonlySet<string>,
  exts: readonly string[],
): RepoPath | null {
  const clean = specifier.replace(/[?#].*$/, '');
  if (!(clean.startsWith('.') || clean.startsWith('/'))) return null;
  const segs = clean.startsWith('/') ? [] : posixDirname(fromPath).split('/').filter((s) => s !== '');
  for (const seg of (clean.startsWith('/') ? clean.slice(1) : clean).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (segs.length === 0) return null;
      segs.pop();
      continue;
    }
    segs.push(seg);
  }
  const joined = segs.join('/');
  const stripped = joined.replace(/\.(m|c)?[jt]sx?$/, '');
  const candidates = [joined, stripped];
  for (const base of [joined, stripped]) {
    for (const e of exts) {
      candidates.push(base + e);
      candidates.push(`${base}/index${e}`);
    }
  }
  for (const cand of candidates) {
    if (treePaths.has(cand)) return cand as RepoPath;
  }
  return null;
}

async function buildImportGraphForBoundary(
  b: EpochBoundary,
  treeMap: ReadonlyMap<RepoPath, GitObjectId>,
  contents: ReadonlyMap<RepoPath, string>,
  config: FactBaseConfig,
): Promise<ImportGraphSnapshot> {
  const treePaths = new Set<string>([...treeMap.keys()]);
  const edges: ImportEdge[] = [];
  let unresolved = 0;
  for (const [p, text] of contents) {
    for (const imp of scanImports(text)) {
      const external = isExternalSpecifier(imp.specifier);
      let toPath: RepoPath | null = null;
      if (!external) {
        toPath = resolveRelative(p, imp.specifier, treePaths, config.sourceExtensions);
        if (toPath === null) unresolved += 1;
      }
      edges.push({ from: p, toSpecifier: imp.specifier, toPath, kind: imp.kind, external });
    }
  }
  edges.sort((x, y) => cmp(x.from, y.from) || cmp(x.toSpecifier, y.toSpecifier) || cmp(x.kind, y.kind));
  return { epoch: b.epoch, at: b.at, edges, modulesScanned: contents.size, unresolvedSpecifiers: unresolved };
}

function buildDocsForBoundary(
  b: EpochBoundary,
  docContents: ReadonlyMap<RepoPath, string>,
  matchedKinds: ReadonlyMap<RepoPath, DocSnapshot['kind']>,
): readonly DocSnapshot[] {
  const snapshots: DocSnapshot[] = [];
  for (const [path, kind] of matchedKinds) {
    const text = docContents.get(path) ?? null;
    snapshots.push({
      epoch: b.epoch,
      at: b.at,
      path,
      kind,
      present: text !== null,
      contentHash: text === null ? null : hashBlob(text),
      text,
    });
  }
  return snapshots.sort((a, b2) => cmp(a.path, b2.path) || cmp(a.kind, b2.kind));
}

// ── negative space: the marquee (spec 04 §2, §5) ──────────────────────────────────────────────

/**
 * Proves (or refutes) each `BoundaryProbe` EXHAUSTIVELY over the walk. A scoped source file's
 * content is only ever introduced by a commit that changed it, so scanning the post-image of every
 * ADDED/MODIFIED scoped file across the whole history covers every distinct state that file ever
 * held — the deterministic pass proving an absence (spec 04 §2).
 *
 * A `type-only` external import is ERASED at runtime (verbatimModuleSyntax) and does NOT refute the
 * boundary — it "grazes" (the deterministic judge's ladder, Q-58). Least-committal for the proof;
 * docs/spec/OPEN-QUESTIONS.md Q-64.
 */
async function proveNegativeSpaceForProbe(
  git: GitExec,
  commits: readonly WalkedCommit[],
  probe: BoundaryProbe,
  config: FactBaseConfig,
  guard: Guard,
  tipTime: CommitterTime | null,
): Promise<NegativeSpaceProof> {
  const forbidden = (spec: string): boolean =>
    probe.forbid === 'external-import' ? isExternalSpecifier(spec) : forgeModuleOf(spec) !== null;

  let held = true;
  let firstBreach: NegativeSpaceProof['firstBreach'] = null;
  let filesScanned = 0;
  let firstScopeTime: CommitterTime | null = null;

  for (const c of commits) {
    const scoped = c.changes.filter(
      (ch) =>
        (ch.status === 'A' || ch.status === 'M' || ch.status === 'R' || ch.status === 'C' || ch.status === 'T') &&
        matchesGlob(probe.scope, ch.path) &&
        config.sourceExtensions.some((e) => ch.path.endsWith(e)),
    );
    if (scoped.length === 0) continue;
    if (firstScopeTime === null) firstScopeTime = c.meta.committerTime;

    const idMap = await treeBlobIds(git, c.meta.sha, scoped.map((s) => s.path), guard);
    const contents = await readBlobContents(git, idMap, guard);
    for (const ch of scoped) {
      const text = contents.get(ch.path);
      if (text === undefined) continue;
      filesScanned += 1;
      for (const imp of scanImports(text)) {
        if (imp.kind === 'type-only') continue;
        if (!forbidden(imp.specifier)) continue;
        held = false;
        const breach = {
          at: c.meta.sha,
          committerTime: c.meta.committerTime,
          path: ch.path,
          line: imp.line,
          specifier: imp.specifier,
        };
        if (firstBreach === null || compareCommitterTime(breach.committerTime, firstBreach.committerTime) < 0) {
          firstBreach = breach;
        }
      }
    }
  }

  const spanFrom = firstScopeTime;
  const spanTo = held ? (firstScopeTime === null ? null : tipTime) : (firstBreach?.committerTime ?? null);
  return {
    probe,
    held,
    commitsChecked: commits.length,
    filesScanned,
    spanFrom,
    spanTo,
    firstBreach,
    // Run-independent: keyed by the probe's identity, so a human's rejection tombstones it (spec 04 §6).
    regularity: regularityKey({ kind: 'negative-space', id: probe.id, scope: probe.scope, forbid: probe.forbid }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  mineFactBase — the orchestrator
// ═══════════════════════════════════════════════════════════════════════════════════════════

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The whole of pass one: walk the range, fold every fact, prove the negative-space boundaries, and
 * emit a replayable `FactBase`. A PURE function of (repo, range, boundaries, config): two runs with
 * the same inputs produce byte-identical `serializeFactBase` output. Model calls: zero.
 */
export async function mineFactBase(git: GitExec, input: MineInput): Promise<MineOutcome> {
  const config = input.config ?? DEFAULT_FACT_BASE_CONFIG;
  const guard = new Guard(config.budget);
  try {
    const tipId = await revParse(git, input.range.to);
    if (tipId === null) throw new Error(`distillation: cannot resolve range.to=${JSON.stringify(input.range.to)}`);
    const tipP = parseCommitSha(tipId);
    if (!tipP.ok) throw new Error(`distillation: range.to resolved to an unsupported object id ${tipId}`);
    const tip = tipP.value;

    const walked = await walkCommits(git, input.range, {
      order: 'oldest-first',
      detectRenames: config.detectRenames,
      maxCommits: config.budget.maxCommits,
    });
    if (!walked.ok) return walked;
    const commits = walked.value;
    guard.tree(commits.reduce((sum, c) => sum + c.changes.length, 0));

    const shas = commits.map((c) => c.meta.sha);

    let firstWalked: CommitSha | null = null;
    if (input.range.from !== null) {
      const f = await revParse(git, input.range.from);
      if (f !== null) {
        const fp = parseCommitSha(f);
        if (fp.ok) firstWalked = fp.value;
      }
    }

    const boundaries: readonly EpochBoundary[] =
      input.boundaries !== undefined && input.boundaries.length > 0
        ? input.boundaries
        : [{ epoch: unwrap(parseEpochId('e0')), at: tip }];

    const tipTime = commits.length > 0 ? (commits[commits.length - 1] as WalkedCommit).meta.committerTime : null;

    // Whole-range folds.
    const coChange = buildCoChange(commits);
    const litigation = buildLitigation(commits, shas);
    const directories = buildDirectories(commits);
    const authorFileMatrix = buildAuthorMatrix(commits);
    const manifests = await buildManifestTimeline(git, commits, config, guard);

    const negativeSpace: NegativeSpaceProof[] = [];
    for (const probe of config.boundaryProbes) {
      negativeSpace.push(await proveNegativeSpaceForProbe(git, commits, probe, config, guard, tipTime));
    }
    negativeSpace.sort((a, b) => cmp(a.probe.id, b.probe.id));

    // Boundary-dependent folds — one tree snapshot per boundary, shared by imports and docs.
    const importGraphs: ImportGraphSnapshot[] = [];
    const docSnapshots: DocSnapshot[] = [];
    for (const b of boundaries) {
      const treeMap = await treeBlobIds(git, b.at, null, guard);

      const sourcePaths = [...treeMap.keys()].filter((p) => config.sourceExtensions.some((e) => p.endsWith(e)));
      const srcIdMap = new Map<RepoPath, GitObjectId>();
      for (const p of sourcePaths) {
        const id = treeMap.get(p);
        if (id !== undefined) srcIdMap.set(p, id);
      }
      const srcContents = await readBlobContents(git, srcIdMap, guard);
      importGraphs.push(await buildImportGraphForBoundary(b, treeMap, srcContents, config));

      const matchedKinds = new Map<RepoPath, DocSnapshot['kind']>();
      const docIdMap = new Map<RepoPath, GitObjectId>();
      for (const matcher of config.docPaths) {
        for (const p of treeMap.keys()) {
          if (!matchesGlob(matcher.glob, p)) continue;
          if (!matchedKinds.has(p)) matchedKinds.set(p, matcher.kind);
          const id = treeMap.get(p);
          if (id !== undefined) docIdMap.set(p, id);
        }
      }
      const docContents = await readBlobContents(git, docIdMap, guard);
      docSnapshots.push(...buildDocsForBoundary(b, docContents, matchedKinds));
    }
    importGraphs.sort((a, b) => cmp(a.epoch, b.epoch) || cmp(a.at, b.at));
    docSnapshots.sort((a, b) => cmp(a.epoch, b.epoch) || cmp(a.path, b.path) || cmp(a.kind, b.kind));

    const rangeDigest: Sha256Ref = unwrap(contentHash([...shas]));
    const factBase: FactBase = {
      version: 1,
      configDigest: configDigest(config),
      range: { from: firstWalked, to: tip },
      boundaries: [...boundaries].sort((a, b) => cmp(a.epoch, b.epoch) || cmp(a.at, b.at)),
      watermark: {
        firstWalked,
        lastWalked: tip,
        commitsWalked: commits.length,
        mergesWalked: commits.filter((c) => c.meta.isMerge).length,
        rangeDigest,
      },
      synthesizable: {
        coChange,
        importGraphs,
        negativeSpace,
        manifests,
        litigation,
        directories,
        docs: { snapshots: docSnapshots } satisfies DocFacts,
      },
      dispersion: { marker: DISPERSION_MARKER, authorFileMatrix },
    };
    return ok(factBase);
  } catch (e) {
    if (e instanceof BudgetError) return err(e.info);
    throw e;
  }
}

/**
 * Convenience entry that builds the `GitExec` through git.ts's `createGitExec` (the same isolated,
 * read-only seam the ledger uses) and mines. Nothing here writes the repository it walks.
 */
export async function mineRepo(env: GitEnvironment, input: MineInput): Promise<MineOutcome> {
  return mineFactBase(createGitExec(env), input);
}
