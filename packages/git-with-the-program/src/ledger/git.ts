// Implements: docs/spec/02-ledger.md §1 (substrate: a dedicated ref, event-sourced) and
// docs/adr/0006-reference-stack.md ("The engine shells out to the `git` CLI for history (no
// `libgit2`, no `nodegit`)"). THE PLUMBING SHELL, and nothing else.
//
// Two jobs, deliberately separated so the second is testable without the first:
//
//   1. EVERY `git` invocation in the ledger lives here, behind a small named function. Nothing
//      in src/ledger/store.ts spawns a process, so the store's decision logic — which blob is
//      new, which tree results, which ref moves — is unit-testable against a stub `GitExec`.
//   2. The PURE tree algebra (`parseTreeEntries`, `formatTreeEntries`, `unionTreeEntries`).
//      Set-union merge is the property that makes concurrent CI runs safe (spec 02 §1.1), and
//      it is arithmetic on tree entries, not a network operation. It is exported and tested on
//      its own.
//
// Only PLUMBING is used — `hash-object -w`, `mktree`, `commit-tree`, `update-ref`, `ls-tree`,
// `cat-file` — so a ledger write never touches the working tree, never stages anything, and
// never moves a branch. `mktree` is preferred over `update-index --index-info` because it needs
// no index at all; belt-and-braces, every invocation still runs with `GIT_INDEX_FILE` pointed
// at a scratch path, so even a command that DID want an index could not disturb the real one.
//
// INV-005: node builtins and src/core only. No forge API, no octokit, no HTTP client. A remote
// is a plain git remote name or URL; a repository with no remote degrades to local-only, which
// is docs/vision.md's "a bare git repo degrades gracefully to commits-only".
//
// INV-002: there is no `deleteRef`, no `hash-object` overwrite path, and no function here that
// replaces an existing blob. `updateRefCas` is the only ref writer and it is compare-and-swap.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Brand } from '../core/index.js';
import { fail, ok, type Parsed } from '../core/index.js';

// ---------------------------------------------------------------------------
// Object ids
// ---------------------------------------------------------------------------

/**
 * A git object id (blob, tree or commit) as git prints it. Deliberately NOT `CommitSha`:
 * `CommitSha` is a ledger-event field describing the SUBJECT of an observation, and blob and
 * tree ids are neither commits nor subjects. Widened to 40-or-64 hex so the ledger keeps
 * working on a sha256-object-format repository.
 */
export type GitObjectId = Brand<string, 'GitObjectId'>;

export const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

export function parseGitObjectId(raw: unknown, at?: string): Parsed<GitObjectId> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string git object id', at);
  if (!GIT_OBJECT_ID_PATTERN.test(raw)) {
    return fail('invalid-id', `expected a git object id, got ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as GitObjectId);
}

// ---------------------------------------------------------------------------
// The exec seam
// ---------------------------------------------------------------------------

export interface GitResult {
  readonly args: readonly string[];
  readonly code: number;
  readonly stdout: string;
  /** Raw bytes. `cat-file --batch` frames its payloads by BYTE length, not character count. */
  readonly stdoutBytes: Buffer;
  readonly stderr: string;
}

export class GitError extends Error {
  readonly result: GitResult;

  constructor(result: GitResult) {
    const detail = result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim();
    super(`git ${result.args.join(' ')} failed (exit ${result.code}): ${detail || '<no output>'}`);
    this.name = 'GitError';
    this.result = result;
  }
}

export interface GitExecOptions {
  /** Written to the child's stdin and closed. */
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Return the non-zero result instead of throwing. The caller then owns the exit code. */
  readonly allowFailure?: boolean;
}

/**
 * The single seam every other function in this module goes through. A test can substitute a
 * function that records calls and replays canned output, which is how store.ts stays
 * unit-testable without a repository.
 */
export type GitExec = (args: readonly string[], options?: GitExecOptions) => Promise<GitResult>;

export interface GitEnvironment {
  readonly cwd: string;
  readonly gitBin?: string;
  /**
   * Where a stray index-touching command would write. Defaults to a per-process scratch path
   * under the OS temp directory, which is never created because no command used here writes an
   * index — the point is that if one ever did, it could not be the repository's own.
   */
  readonly indexFile?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export function createGitExec(environment: GitEnvironment): GitExec {
  const bin = environment.gitBin ?? 'git';
  const indexFile =
    environment.indexFile ?? join(tmpdir(), `gwtp-ledger-index-${randomUUID()}`);

  return (args, options = {}) =>
    new Promise<GitResult>((resolve, reject) => {
      const child = spawn(bin, [...args], {
        cwd: environment.cwd,
        env: {
          ...process.env,
          // Never block a CI run on a credential prompt: fail fast and let push-with-retry
          // report it.
          GIT_TERMINAL_PROMPT: '0',
          GIT_INDEX_FILE: indexFile,
          ...environment.env,
          ...options.env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => outChunks.push(c));
      child.stderr.on('data', (c: Buffer) => errChunks.push(c));

      child.on('error', (e) => {
        reject(
          new GitError({
            args,
            code: -1,
            stdout: '',
            stdoutBytes: Buffer.alloc(0),
            stderr: `cannot spawn ${bin}: ${e.message}`,
          }),
        );
      });

      child.on('close', (code) => {
        const stdoutBytes = Buffer.concat(outChunks);
        const result: GitResult = {
          args,
          code: code ?? -1,
          stdout: stdoutBytes.toString('utf8'),
          stdoutBytes,
          stderr: Buffer.concat(errChunks).toString('utf8'),
        };
        if (result.code !== 0 && options.allowFailure !== true) {
          reject(new GitError(result));
          return;
        }
        resolve(result);
      });

      // A child that rejects its input and exits early (a bad `mktree` line, a missing object)
      // makes the write end EPIPE. That is reported through the exit code we are already
      // waiting on, so swallowing the stream error here turns a crash into the GitError the
      // caller can actually read.
      child.stdin.on('error', () => {});
      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    });
}

// ---------------------------------------------------------------------------
// Tree entries — the pure algebra
// ---------------------------------------------------------------------------

export const BLOB_MODE = '100644';
export const TREE_MODE = '040000';

export type TreeEntryType = 'blob' | 'tree' | 'commit' | 'tag';

/** One line of `git ls-tree` output: `<mode> SP <type> SP <id> TAB <name>`. */
export interface TreeEntry {
  readonly mode: string;
  readonly type: TreeEntryType;
  readonly id: GitObjectId;
  /** A single path SEGMENT. `git mktree` rejects a name containing a slash. */
  readonly name: string;
}

const LS_TREE_LINE = /^([0-7]{6}) (blob|tree|commit|tag) ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/;

export function parseTreeEntries(text: string): Parsed<readonly TreeEntry[]> {
  const entries: TreeEntry[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] as string).replace(/\r$/, '');
    if (line === '') continue;
    const m = LS_TREE_LINE.exec(line);
    if (m === null) {
      return fail('wrong-type', `unparseable ls-tree line: ${JSON.stringify(line)}`, `/${i}`);
    }
    entries.push({
      mode: m[1] as string,
      type: m[2] as TreeEntryType,
      id: m[3] as GitObjectId,
      name: m[4] as string,
    });
  }
  return ok(entries);
}

/** `git mktree` input. Sorted by name so the same entry SET always produces the same bytes. */
export function formatTreeEntries(entries: readonly TreeEntry[]): string {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.mode} ${e.type} ${e.id}\t${e.name}\n`)
    .join('');
}

/** Same name, different object. Under `events/` this cannot happen unless something lied. */
export interface TreeCollision {
  readonly name: string;
  readonly ours: GitObjectId;
  readonly theirs: GitObjectId;
}

export interface TreeUnion {
  readonly entries: readonly TreeEntry[];
  readonly collisions: readonly TreeCollision[];
}

/**
 * SET UNION of two tree levels, keyed by entry name (spec 02 §1.1: "Concurrent CI runs pushing
 * simultaneously merge as set union — content-addressed events cannot conflict").
 *
 * Pure, and TOTAL over well-formed event trees: an event's filename IS the hash of its body and
 * its bytes are a pure function of that body, so the same name always carries the same blob id
 * and the two inputs agree wherever they overlap. That is exactly why union needs no merge
 * driver and why the result does not depend on the order of the arguments.
 *
 * A same-name-different-id pair is therefore not a merge conflict but EVIDENCE: either a
 * tampered blob or a non-pure serializer. It is REPORTED in `collisions` and resolved in favour
 * of `ours`, so that a caller which must not tolerate one (the `events/` level) can fail loud
 * while a caller for which the level is a derived cache (`accumulators/`, `epochs/` — "never
 * authoritative", ADR-0002) can carry on and let the next fold regenerate it. The spec says
 * nothing about the non-event levels; see docs/spec/OPEN-QUESTIONS.md Q-49.
 */
export function unionTreeEntries(
  ours: readonly TreeEntry[],
  theirs: readonly TreeEntry[],
): TreeUnion {
  const merged = new Map<string, TreeEntry>();
  for (const e of ours) merged.set(e.name, e);

  const collisions: TreeCollision[] = [];
  for (const e of theirs) {
    const mine = merged.get(e.name);
    if (mine === undefined) {
      merged.set(e.name, e);
      continue;
    }
    if (mine.id === e.id && mine.mode === e.mode && mine.type === e.type) continue;
    collisions.push({ name: e.name, ours: mine.id, theirs: e.id });
  }

  const entries = [...merged.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return {
    entries,
    collisions: collisions.sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

/** Replaces (or inserts) one entry by name. Used to swap a rebuilt `events` subtree in. */
export function withTreeEntry(
  entries: readonly TreeEntry[],
  entry: TreeEntry,
): readonly TreeEntry[] {
  return [...entries.filter((e) => e.name !== entry.name), entry].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Is there a repository here at all?
 *
 * Worth its own call because every read below answers ABSENCE the same way it answers "no such
 * repository": `revParse` returns `null` for a ref that does not exist and for a directory that
 * is not a repository, and `lsTree` returns `[]` for both. Those are the right answers for a
 * ledger that has not been written yet, and the wrong answer to "you pointed me at the wrong
 * directory" — so a caller that can tell the difference has to ask.
 */
export async function isGitRepository(git: GitExec): Promise<boolean> {
  const r = await git(['rev-parse', '--git-dir'], { allowFailure: true });
  return r.code === 0;
}

/** Resolves a revision to an object id, or `null` when it does not exist. */
export async function revParse(git: GitExec, rev: string): Promise<GitObjectId | null> {
  const r = await git(['rev-parse', '--verify', '--quiet', rev], { allowFailure: true });
  if (r.code !== 0) return null;
  const parsed = parseGitObjectId(r.stdout.trim());
  return parsed.ok ? parsed.value : null;
}

/**
 * A path GENUINELY ABSENT from the tree: git could not resolve the name to any object at all.
 * An empty ledger and a ledger without an `events/` subtree both legitimately answer "no
 * entries", and git spells that (depending on version) `Not a valid object name`,
 * `unknown revision`, `path '…' does not exist in …` or `… exists on disk, but not in …`.
 *
 * `not a tree object` is DELIBERATELY NOT HERE. That message is NEVER absence — the name
 * resolved to an object that is simply not a listable tree: a corrupt/missing tree object still
 * referenced by its parent, or an `events` entry that is a blob rather than a subtree. Reading
 * either as `[]` would report a broken ledger as empty, and `append` would then rebuild
 * `events/` from scratch and `pushWithRetry` would fast-forward the truncation onto the remote —
 * an INV-002 breach reached through a READ path (docs/spec/OPEN-QUESTIONS.md Q-48; the audit's
 * probe a5/a6/a7).
 */
const ABSENT_PATH = /not a valid object name|unknown revision|does not exist|exists on disk, but not in/i;

export async function lsTree(git: GitExec, treeish: string): Promise<readonly TreeEntry[]> {
  const r = await git(['ls-tree', '--full-tree', treeish], { allowFailure: true });
  if (r.code !== 0) {
    // The stderr text alone is not trustworthy across git versions, so CONFIRM the absence:
    // `rev-parse --verify --quiet` resolves a path that exists-but-is-unreadable (a corrupt
    // tree, a blob where a tree belongs) and fails only when the name is truly not in the tree.
    // A failure that could not be confirmed as absence propagates — an intact-but-broken ledger
    // must never read as empty.
    if (ABSENT_PATH.test(r.stderr) && (await revParse(git, treeish)) === null) return [];
    throw new GitError(r);
  }
  const parsed = parseTreeEntries(r.stdout);
  if (!parsed.ok) {
    throw new GitError({ ...r, code: r.code, stderr: parsed.error.message });
  }
  return parsed.value;
}

export async function catFileBlob(git: GitExec, id: GitObjectId): Promise<string> {
  const r = await git(['cat-file', 'blob', id]);
  return r.stdout;
}

/**
 * One subprocess for the whole ledger instead of one per event. `git cat-file --batch` frames
 * each object as `<id> SP <type> SP <size>\n<payload>\n`, where `size` is in BYTES — hence the
 * Buffer arithmetic. A `<id> SP missing\n` line carries no payload and is simply absent from
 * the result, which the caller reports as unreadable rather than as an empty event.
 */
export async function catFileBatch(
  git: GitExec,
  ids: readonly GitObjectId[],
): Promise<ReadonlyMap<GitObjectId, string>> {
  const out = new Map<GitObjectId, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;

  const r = await git(['cat-file', '--batch'], { input: `${unique.join('\n')}\n` });
  const buf = r.stdoutBytes;
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    if (nl === -1) break;
    const header = buf.toString('utf8', i, nl);
    const parts = header.split(' ');
    if (parts.length < 3) {
      // `<id> missing` / `<id> ambiguous`: no payload follows.
      i = nl + 1;
      continue;
    }
    const size = Number.parseInt(parts[2] as string, 10);
    if (!Number.isFinite(size) || size < 0) break;
    const start = nl + 1;
    const end = start + size;
    out.set(parts[0] as GitObjectId, buf.toString('utf8', start, end));
    i = end + 1;
  }
  return out;
}

export async function isAncestor(
  git: GitExec,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const r = await git(['merge-base', '--is-ancestor', ancestor, descendant], {
    allowFailure: true,
  });
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new GitError(r);
}

// ---------------------------------------------------------------------------
// Writes (objects and refs only — never the index, never the working tree)
// ---------------------------------------------------------------------------

/**
 * Writes a blob into the object database. Content-addressed and therefore idempotent: writing
 * the same bytes twice yields the same id and overwrites nothing, which is the object-store
 * half of INV-002.
 */
export async function hashObjectWrite(git: GitExec, content: string): Promise<GitObjectId> {
  const r = await git(['hash-object', '-w', '-t', 'blob', '--stdin'], { input: content });
  const parsed = parseGitObjectId(r.stdout.trim());
  if (!parsed.ok) throw new GitError({ ...r, stderr: parsed.error.message });
  return parsed.value;
}

/**
 * The blob id `content` WOULD have, without writing it. Side-effect free (`hash-object` with no
 * `-w`), so a dedupe check can ask "is the blob already at this content-addressed name actually
 * this event?" before trusting a filename-only match. Uses the repository's own object-format,
 * so it stays correct on a sha256 repo.
 */
export async function hashObject(git: GitExec, content: string): Promise<GitObjectId> {
  const r = await git(['hash-object', '-t', 'blob', '--stdin'], { input: content });
  const parsed = parseGitObjectId(r.stdout.trim());
  if (!parsed.ok) throw new GitError({ ...r, stderr: parsed.error.message });
  return parsed.value;
}

export async function mktree(git: GitExec, entries: readonly TreeEntry[]): Promise<GitObjectId> {
  const r = await git(['mktree'], { input: formatTreeEntries(entries) });
  const parsed = parseGitObjectId(r.stdout.trim());
  if (!parsed.ok) throw new GitError({ ...r, stderr: parsed.error.message });
  return parsed.value;
}

export interface CommitIdentity {
  readonly name: string;
  readonly email: string;
  /** ISO 8601. Both author and committer dates are set, so the commit is reproducible. */
  readonly date: string;
}

export interface CommitTreeInput {
  readonly tree: GitObjectId;
  readonly parents: readonly GitObjectId[];
  readonly message: string;
  readonly identity: CommitIdentity;
}

/**
 * Identity comes from the caller, never from ambient `user.email` — a CI runner frequently has
 * none configured, and a ledger commit that fails because a workstation is misconfigured is a
 * governance outage.
 */
export async function commitTree(git: GitExec, input: CommitTreeInput): Promise<GitObjectId> {
  const args = ['commit-tree', input.tree];
  for (const p of input.parents) args.push('-p', p);
  args.push('-m', input.message);

  const r = await git(args, {
    env: {
      GIT_AUTHOR_NAME: input.identity.name,
      GIT_AUTHOR_EMAIL: input.identity.email,
      GIT_AUTHOR_DATE: input.identity.date,
      GIT_COMMITTER_NAME: input.identity.name,
      GIT_COMMITTER_EMAIL: input.identity.email,
      GIT_COMMITTER_DATE: input.identity.date,
    },
  });
  const parsed = parseGitObjectId(r.stdout.trim());
  if (!parsed.ok) throw new GitError({ ...r, stderr: parsed.error.message });
  return parsed.value;
}

export type RefUpdateOutcome =
  | { readonly ok: true }
  /** Another writer moved the ref between our read and our write. Retry from the new tip. */
  | { readonly ok: false; readonly reason: 'stale'; readonly message: string }
  /** Another writer holds the ref lock right now. Transient; retry. */
  | { readonly ok: false; readonly reason: 'locked'; readonly message: string };

const REF_LOCKED = /cannot lock ref|unable to (?:create|lock)|reference already exists|file exists/i;

/**
 * The ONLY ref writer in the ledger, and it is compare-and-swap: `expected` is the tip we read
 * and built against, and git refuses the update if the ref has moved. That single primitive is
 * what makes concurrent local appends safe without a lock of our own — a loser sees `stale`,
 * re-reads the new tip, and re-derives its append against it.
 *
 * `expected: null` means "the ref must not exist yet", spelled to git as the empty old-value.
 */
export async function updateRefCas(
  git: GitExec,
  ref: string,
  next: GitObjectId,
  expected: GitObjectId | null,
): Promise<RefUpdateOutcome> {
  const r = await git(['update-ref', ref, next, expected ?? ''], { allowFailure: true });
  if (r.code === 0) return { ok: true };
  const message = r.stderr.trim();
  if (REF_LOCKED.test(message)) return { ok: false, reason: 'locked', message };
  return { ok: false, reason: 'stale', message };
}

// ---------------------------------------------------------------------------
// Remote traffic
// ---------------------------------------------------------------------------

/** `null` when the remote has no such ref — the normal state before a repo's first push. */
export async function lsRemoteRef(
  git: GitExec,
  remote: string,
  ref: string,
): Promise<GitObjectId | null> {
  const r = await git(['ls-remote', '--exit-code', remote, ref], { allowFailure: true });
  if (r.code !== 0) return null;
  const first = r.stdout.split('\n')[0] ?? '';
  const parsed = parseGitObjectId(first.split('\t')[0] ?? '');
  return parsed.ok ? parsed.value : null;
}

/**
 * Fetches one ref into `FETCH_HEAD` and returns its id. Deliberately refspec-less on the local
 * side: it creates no remote-tracking ref, so a fetch of the ledger leaves no trace in the
 * caller's ref namespace. "Non-default refs don't fetch by default" (spec 02 §8) cuts both ways.
 */
export async function fetchRefToFetchHead(
  git: GitExec,
  remote: string,
  ref: string,
): Promise<GitObjectId | null> {
  const r = await git(['fetch', '--quiet', '--no-tags', remote, ref], { allowFailure: true });
  if (r.code !== 0) return null;
  return revParse(git, 'FETCH_HEAD');
}

export type PushOutcome =
  | { readonly ok: true }
  /** Not a fast-forward: the remote moved. The caller must re-merge and retry (spec 02 §1.1). */
  | { readonly ok: false; readonly rejected: true; readonly message: string }
  /** Auth, network, missing remote. Retrying will not help; the caller should surface it. */
  | { readonly ok: false; readonly rejected: false; readonly message: string };

const PUSH_REJECTED = /\brejected\b|non-fast-forward|fetch first|stale info|cannot lock ref/i;

/**
 * Non-forced by construction: there is no `--force` anywhere in this module. A rejected push is
 * the signal to fetch and union-merge, never to overwrite — which is INV-002 at the transport
 * layer.
 */
export async function pushRef(
  git: GitExec,
  remote: string,
  local: GitObjectId,
  remoteRef: string,
): Promise<PushOutcome> {
  const r = await git(['push', '--quiet', remote, `${local}:${remoteRef}`], {
    allowFailure: true,
  });
  if (r.code === 0) return { ok: true };
  const message = `${r.stderr}\n${r.stdout}`.trim();
  return { ok: false, rejected: PUSH_REJECTED.test(message), message };
}
