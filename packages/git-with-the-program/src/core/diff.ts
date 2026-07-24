// Implements: docs/spec/03-judge.md §3 (evidence assembly — "the diff hunks intersecting the
// assertion's scope"): the ONE reader that turns `git show` / `git diff` unified-diff output into
// the blind `Hunk[]` the judges and the distillation backfill both consume. Promoted here (SEED-04
// integration) so the parser has a SINGLE home: it previously lived, byte-identical, in both
// scripts/demo-v0.ts and src/cli/commands/judge.ts, and src/distill/backfill.ts needs the same
// shape to age a replayed commit's diff onto the ledger. Duplicating it a third time would let the
// three copies drift; this module is imported by all callers instead.
//
// INV-005: imports src/core only (Hunk, RepoPath). No git, no fs, no provider — a PURE
// string -> Hunk[] function. INV-003: a Hunk carries no author and no commit sha, so nothing this
// parser produces can leak identity onto a verdict path (docs/spec/OPEN-QUESTIONS.md Q-09 is the
// residual free-text hole, unchanged by moving the parser).

import type { Hunk } from './change.js';
import type { RepoPath } from './paths.js';
import { parseRepoPath } from './paths.js';

/**
 * `git diff` / `git show` unified-diff output → `Hunk[]`. The judges consume already-parsed hunks
 * (spec 03 §3), so turning a supplied diff into hunks is the caller's job; the assembler re-scopes
 * and seals them. A hunk's `text` is the body only — `+`/`-`/` `/`\` lines WITH their markers, no
 * `@@` header — exactly what `src/core/change.ts` `Hunk` and `postImageLines` expect. A `/dev/null`
 * target (a deletion) yields no post-image path and is dropped: there is nothing citable to rule on.
 */
export function parseUnifiedDiff(diff: string): readonly Hunk[] {
  const hunks: Hunk[] = [];
  let path: RepoPath | null = null;
  let open:
    | { oldStart: number; oldLines: number; newStart: number; newLines: number; body: string[] }
    | null = null;

  const flush = (): void => {
    if (open === null) return;
    if (path !== null) {
      hunks.push({
        path,
        oldStart: open.oldStart,
        oldLines: open.oldLines,
        newStart: open.newStart,
        newLines: open.newLines,
        text: open.body.join('\n'),
      });
    }
    open = null;
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      path = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      flush();
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        path = null;
        continue;
      }
      const parsed = parseRepoPath(target.replace(/^b\//, ''));
      path = parsed.ok ? parsed.value : null;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header !== null) {
      flush();
      open = {
        oldStart: Number.parseInt(header[1] as string, 10),
        oldLines: header[2] === undefined ? 1 : Number.parseInt(header[2], 10),
        newStart: Number.parseInt(header[3] as string, 10),
        newLines: header[4] === undefined ? 1 : Number.parseInt(header[4], 10),
        body: [],
      };
      continue;
    }
    if (open === null) continue;
    if (
      line === '' ||
      line.startsWith(' ') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith('\\')
    ) {
      open.body.push(line);
    }
  }
  flush();
  return hunks;
}
