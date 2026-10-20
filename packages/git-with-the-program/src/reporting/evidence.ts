// Repository journalism: deterministic observational facts, not governance verdicts.
// Separate from docs/spec/03-judge.md §2-§3 and its blind evidence assembler.
// This adapter-side reporting boundary may read git/gh; it never writes program or ledger.
// All collected prose, paths, and patches are UNTRUSTED DATA, never instructions.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

export interface RepositoryEvidenceOptions {
  repo: string;
  ref?: string;
  since?: string;
  limit?: number;
  github?: string;
  prs?: number[];
  issues?: number[];
}

export const EVIDENCE_LIMITS = Object.freeze({
  defaultCommits: 20, maxCommits: 100, refsPerKind: 256, pathsPerCommit: 256,
  patchChars: 16_384, totalPatchChars: 49_152, subjectChars: 2_048, forgeItemsPerKind: 20,
  forgeTextChars: 8_192, commandBytes: 1_048_576, commandTimeoutMs: 15_000,
});

export interface EvidenceError { operation: string; code: string }
export interface CommitEvidence {
  id: string; sha: string; authoredAt: string; committedAt: string; subject: string;
  subjectTruncated: boolean; paths: string[]; pathsTruncated: boolean;
  patch: string; patchTruncated: boolean; url: string | null;
}
export interface RefEvidence { id: string; name: string; sha: string; commit: string | null }
export interface ForgeEvidence {
  id: string; number: number; title: string; body: string; state: string;
  createdAt: string; updatedAt: string; url: string; truncated: boolean;
}
export interface RepositoryEvidence {
  schemaVersion: 1;
  trust: 'untrusted';
  selection: { ref: string; resolvedCommit: string | null; since: string | null; limit: number; github: string | null };
  limits: typeof EVIDENCE_LIMITS;
  shallow: boolean;
  commits: CommitEvidence[];
  branches: RefEvidence[];
  tags: RefEvidence[];
  truncation: { history: boolean; branches: boolean; tags: boolean };
  trends: {
    scope: 'sampled-commits-only'; commits: number; uniquePaths: number;
    pathsIncomplete: boolean; commitsByDay: { day: string; commits: number }[];
    topPaths: { path: string; commits: number }[];
  };
  github: {
    status: 'not-requested' | 'ok' | 'partial' | 'error';
    prs: ForgeEvidence[]; issues: ForgeEvidence[]; errors: EvidenceError[];
    truncated: { prs: boolean; issues: boolean };
  };
  warnings: string[];
  errors: EvidenceError[];
}

interface CommandOutput { text: string; error: string | null; truncated: boolean }

// Never return stderr or Error.message: either can contain credentials, remotes, or local paths.
function command(file: 'git' | 'gh', args: string[], cwd: string): Promise<CommandOutput> {
  // Inherited GIT_DIR/GIT_WORK_TREE/config overrides must not redirect the selected repo.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return new Promise((done) => {
    execFile(file, args, {
      cwd, encoding: 'utf8', maxBuffer: EVIDENCE_LIMITS.commandBytes,
      timeout: EVIDENCE_LIMITS.commandTimeoutMs,
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
        GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C', GH_PROMPT_DISABLED: '1', GH_HOST: 'github.com' },
    }, (error, stdout) => {
      const overflow = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      done({ text: stdout ?? '', truncated: overflow,
        error: !error ? null : overflow ? 'output-limit' : error.killed ? 'timeout' : 'command-failed' });
    });
  });
}

function validate(options: RepositoryEvidenceOptions): number {
  if (!options || typeof options.repo !== 'string' || !options.repo || options.repo.includes('\0')) {
    throw new Error('repo must select a local repository directory');
  }
  const limit = options.limit === undefined ? EVIDENCE_LIMITS.defaultCommits : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > EVIDENCE_LIMITS.maxCommits) {
    throw new Error(`limit must be an integer from 1 to ${EVIDENCE_LIMITS.maxCommits}`);
  }
  if (options.ref !== undefined && (typeof options.ref !== 'string' || !options.ref ||
    options.ref.length > 1_024 || /^[\s-]/.test(options.ref) || /[\x00-\x20\x7f]/.test(options.ref))) {
    throw new Error('ref must be a non-option commit revision');
  }
  if (options.since !== undefined && (typeof options.since !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(options.since) ||
    !Number.isFinite(Date.parse(options.since)) ||
    new Date(options.since).toISOString().slice(0, 10) !== options.since.slice(0, 10))) {
    throw new Error('since must be an ISO UTC date or timestamp');
  }
  if (options.github !== undefined && (typeof options.github !== 'string' ||
    options.github.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.github))) {
    throw new Error('github must be an explicit owner/repo slug');
  }
  for (const selector of [options.prs, options.issues]) {
    if (selector !== undefined && (!options.github || !Array.isArray(selector) ||
      selector.length > EVIDENCE_LIMITS.forgeItemsPerKind ||
      Array.from(selector).some((n) => !Number.isSafeInteger(n) || n < 1))) {
      throw new Error('PR/issue selectors require github and at most 20 positive safe integers');
    }
  }
  return limit;
}

/**
 * Fixed inputs and unchanged git/forge snapshots yield identical JSON; no wall-clock fields.
 * Invalid options/repository/revision reject; subsequent collection failures are recorded.
 * Omitted forge selectors fetch recent items; [] explicitly disables that kind.
 * Merge paths include all parents; merge patches compare against the first parent only.
 */
export async function collectRepositoryEvidence(options: RepositoryEvidenceOptions): Promise<RepositoryEvidence> {
  const limit = validate(options);
  const cwd = resolve(options.repo);
  const git = (...args: string[]) => command('git', ['--no-pager', '-c', 'color.ui=false', ...args], cwd);
  const inside = await git('rev-parse', '--git-dir');
  if (inside.error) throw new Error('Cannot read selected local Git repository');
  const ref = options.ref ?? 'HEAD';
  const revision = await git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
  const sha: string | null = revision.error ? null : revision.text.trim();
  if (sha === null) {
    const anyCommit = await git('rev-list', '--all', '--max-count=1');
    const unborn = await git('symbolic-ref', '-q', 'HEAD');
    if (options.ref !== undefined || anyCommit.error || anyCommit.text.trim() || unborn.error) {
      throw new Error('Selected ref does not resolve to a commit');
    }
  } else if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
    throw new Error('Selected ref did not resolve to a full commit SHA');
  }
  const shallow = await git('rev-parse', '--is-shallow-repository');
  const result: RepositoryEvidence = {
    schemaVersion: 1, trust: 'untrusted',
    selection: { ref, resolvedCommit: sha, since: options.since ?? null, limit, github: options.github ?? null },
    limits: EVIDENCE_LIMITS, shallow: shallow.text.trim() === 'true',
    commits: [], branches: [], tags: [], truncation: { history: false, branches: false, tags: false },
    trends: { scope: 'sampled-commits-only', commits: 0, uniquePaths: 0, pathsIncomplete: false, commitsByDay: [], topPaths: [] },
    github: { status: 'not-requested', prs: [], issues: [], errors: [], truncated: { prs: false, issues: false } },
    warnings: [], errors: [],
  };
  if (shallow.error) result.errors.push({ operation: 'shallow', code: shallow.error });
  if (result.shallow) result.warnings.push('Shallow repository: history and trends may be incomplete.');
  if (sha === null) result.warnings.push('Repository has no commits.');
  for (const [kind, prefixes] of [['branches', ['refs/heads', 'refs/remotes']], ['tags', ['refs/tags']]] as const) {
    const refs = await git('for-each-ref', '--sort=refname', `--count=${EVIDENCE_LIMITS.refsPerKind + 1}`,
      '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)', ...prefixes);
    if (refs.error) { result.errors.push({ operation: kind, code: refs.error }); result.truncation[kind] = true; continue; }
    const lines = refs.text.trimEnd().split('\n').filter(Boolean);
    result.truncation[kind] = lines.length > EVIDENCE_LIMITS.refsPerKind;
    result[kind] = lines.slice(0, EVIDENCE_LIMITS.refsPerKind).map((line) => {
      const [name = '', object = '', type, peeled = '', peeledType] = line.split('\0');
      return { id: `git-ref:${name}`, name, sha: object, commit: type === 'commit' ? object : peeledType === 'commit' ? peeled : null };
    });
  }
  if (sha !== null) {
    const history = await git('rev-list', '--topo-order', `--max-count=${limit + 1}`,
      ...(options.since ? [`--since-as-filter=${new Date(options.since).toISOString()}`] : []), sha, '--');
    if (history.error) { result.errors.push({ operation: 'history', code: history.error }); result.truncation.history = true; }
    else {
      const hashes = history.text.trim().split('\n').filter(Boolean);
      result.truncation.history = hashes.length > limit;
      let patchBudget = EVIDENCE_LIMITS.totalPatchChars;
      for (const hash of hashes.slice(0, limit)) {
        const metadata = await git('show', '-s', '--format=%aI%x00%cI%x00%s', hash, '--');
        if (metadata.error) { result.errors.push({ operation: `commit:${hash}`, code: metadata.error }); continue; }
        const [authoredAt = '', committedAt = '', ...subjectParts] = metadata.text.trimEnd().split('\0');
        const subject = subjectParts.join('\0');
        const paths = await git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', '--no-renames', hash, '--');
        const patch = await git('show', '--format=', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', '--diff-merges=first-parent', hash, '--');
        for (const [operation, output] of [['paths', paths], ['patch', patch]] as const) {
          if (output.error) result.errors.push({ operation: `${operation}:${hash}`, code: output.error });
        }
        const allPaths = paths.error ? [] : [...new Set(paths.text.split('\0').filter(Boolean))].sort();
        const patchLimit = Math.min(patchBudget, EVIDENCE_LIMITS.patchChars);
        const patchText = patch.error && !patch.truncated ? '' : patch.text.slice(0, patchLimit);
        patchBudget -= patchText.length;
        result.commits.push({ id: `git-commit:${hash}`, sha: hash, authoredAt, committedAt,
          subject: subject.slice(0, EVIDENCE_LIMITS.subjectChars), subjectTruncated: subject.length > EVIDENCE_LIMITS.subjectChars,
          paths: allPaths.slice(0, EVIDENCE_LIMITS.pathsPerCommit), pathsTruncated: !!paths.error || allPaths.length > EVIDENCE_LIMITS.pathsPerCommit,
          patch: patchText, patchTruncated: !!patch.error || patch.text.length > patchLimit,
          url: options.github ? `https://github.com/${options.github}/commit/${hash}` : null });
      }
    }
  }
  const days = new Map<string, number>();
  const paths = new Map<string, number>();
  for (const commit of result.commits) {
    const day = commit.committedAt.slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
    for (const path of commit.paths) paths.set(path, (paths.get(path) ?? 0) + 1);
  }
  const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  result.trends = {
    scope: 'sampled-commits-only', commits: result.commits.length, uniquePaths: paths.size,
    pathsIncomplete: result.commits.some((c) => c.pathsTruncated),
    commitsByDay: [...days].sort(([a], [b]) => lexical(a, b)).map(([day, commits]) => ({ day, commits })),
    topPaths: [...paths].sort(([a, n], [b, m]) => m - n || lexical(a, b)).slice(0, 20).map(([path, commits]) => ({ path, commits })),
  };
  if (options.github) {
    result.warnings.push(
      'GitHub owner/repo is user-supplied and not verified against the local repository; source links are constructed.',
      'PR/issue bodies are current mutable metadata, not historical snapshots or necessarily related to the selected commit window.',
      'Forge collection excludes comments, reviews, check results, and PR diffs.',
    );
    let successes = 0;
    for (const [kind, noun, selected] of [['prs', 'pr', options.prs], ['issues', 'issue', options.issues]] as const) {
      const numbers = selected === undefined ? [null] : [...new Set(selected)].sort((a, b) => a - b);
      for (const number of numbers) {
        const output = await command('gh', [noun, number === null ? 'list' : 'view',
          ...(number === null ? ['--state', 'all', '--limit', String(EVIDENCE_LIMITS.forgeItemsPerKind + 1)] : [String(number)]),
          '--repo', options.github, '--json', 'number,title,body,state,createdAt,updatedAt'], cwd);
        const operation = `${kind}:${number ?? 'recent'}`;
        if (output.error) { result.github.errors.push({ operation, code: output.error }); continue; }
        try {
          const parsed: unknown = JSON.parse(output.text);
          const rows: unknown[] = number === null ? (Array.isArray(parsed) ? parsed : (() => { throw new Error(); })()) : [parsed];
          result.github.truncated[kind] ||= rows.length > EVIDENCE_LIMITS.forgeItemsPerKind;
          const items = rows.slice(0, EVIDENCE_LIMITS.forgeItemsPerKind).map((row): ForgeEvidence => {
            if (!row || typeof row !== 'object') throw new Error();
            const r = row as Record<string, unknown>;
            if (!Number.isSafeInteger(r.number) || (r.number as number) < 1 ||
              (number !== null && r.number !== number) ||
              ['title', 'body', 'state', 'createdAt', 'updatedAt'].some((key) => typeof r[key] !== 'string')) throw new Error();
            const text = (key: string) => (r[key] as string).slice(0, EVIDENCE_LIMITS.forgeTextChars);
            return { id: `github:${options.github}:${noun}:${r.number}`, number: r.number as number,
              title: text('title'), body: text('body'), state: text('state'), createdAt: text('createdAt'), updatedAt: text('updatedAt'),
              url: `https://github.com/${options.github}/${noun === 'pr' ? 'pull' : 'issues'}/${r.number}`,
              truncated: ['title', 'body', 'state', 'createdAt', 'updatedAt'].some((key) => (r[key] as string).length > EVIDENCE_LIMITS.forgeTextChars) };
          });
          result.github[kind].push(...items);
          successes++;
        } catch { result.github.errors.push({ operation, code: 'invalid-response' }); }
      }
      result.github[kind].sort((a, b) => a.number - b.number);
    }
    result.github.status = result.github.errors.length ? successes ? 'partial' : 'error' : 'ok';
  }
  return result;
}
