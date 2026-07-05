// Minimal line diff (LCS) for the pre-save review. Pure, deterministic, no deps.

export interface DiffRow {
  kind: 'same' | 'add' | 'del';
  text: string;
}

/** Longest-common-subsequence line diff of `a` → `b`. Deletions before additions at each divergence. */
export function diffLines(a: string, b: string): DiffRow[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ kind: 'same', text: A[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: 'del', text: A[i] });
      i++;
    } else {
      rows.push({ kind: 'add', text: B[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: 'del', text: A[i++] });
  while (j < m) rows.push({ kind: 'add', text: B[j++] });
  return rows;
}

/** Whether two texts differ at all (cheap; used to enable/disable Save). */
export function hasChanges(a: string, b: string): boolean {
  return a !== b;
}
