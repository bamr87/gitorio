// Implements tests for: docs/spec/03-judge.md §1 (verdict cache key: assertion-id +
// hunk-hash + judge-hash, "which dedupes across force-pushes") and §3 (scope-intersected
// hunks, expanding context ring on abstain).

import { describe, expect, it } from 'vitest';
import {
  CONTEXT_RINGS,
  hunkHash,
  scopedHunks,
  verdictCacheKey,
  widenContextRing,
  type Hunk,
} from '../../src/core/change.js';
import { citationsWithinBundle, sealEvidence, type EvidenceBundleInput } from '../../src/core/evidence.js';
import { judgeHash, type JudgeRef } from '../../src/core/event.js';
import { parseAccumulatorKey, parseAssertionId, parseJudgeId, sha256RefHex } from '../../src/core/ids.js';
import { parsePathGlob, parseRepoPath, type PathGlob } from '../../src/core/paths.js';
import { unwrap } from '../../src/core/result.js';
import { parseCitation } from '../../src/core/verdict.js';

const p = (s: string) => unwrap(parseRepoPath(s));
const g = (s: string): PathGlob => unwrap(parsePathGlob(s));

const hunk = (path: string, newStart = 41, newLines = 18, text = '+import x'): Hunk => ({
  path: p(path),
  oldStart: newStart,
  oldLines: 0,
  newStart,
  newLines,
  text,
});

describe('hunk hashing (spec 03 §1)', () => {
  it('produces a schema-shaped sha256 ref', () => {
    expect(unwrap(hunkHash([hunk('src/core/http.ts')]))).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is order-independent, so enumeration order cannot change the cache key', () => {
    const a = hunk('src/core/a.ts', 10);
    const b = hunk('src/core/b.ts', 20);
    expect(unwrap(hunkHash([a, b]))).toBe(unwrap(hunkHash([b, a])));
  });

  it('carries no commit sha, so it is stable across a force-push', () => {
    // The Hunk type has no sha field at all: the same content on a rewritten commit hashes
    // identically by construction.
    expect(Object.keys(hunk('a.ts')).sort()).toEqual([
      'newLines',
      'newStart',
      'oldLines',
      'oldStart',
      'path',
      'text',
    ]);
  });

  it('changes when the content changes', () => {
    expect(unwrap(hunkHash([hunk('a.ts', 41, 18, '+import x')]))).not.toBe(
      unwrap(hunkHash([hunk('a.ts', 41, 18, '+import y')]))
    );
    expect(unwrap(hunkHash([hunk('a.ts', 41)]))).not.toBe(unwrap(hunkHash([hunk('a.ts', 42)])));
  });

  it('hashes the empty hunk set deterministically', () => {
    expect(unwrap(hunkHash([]))).toBe(unwrap(hunkHash([])));
  });
});

describe('the verdict cache key lines up with the event store idempotency (spec 03 §1)', () => {
  const judge: JudgeRef = { kind: 'model', id: unwrap(parseJudgeId('invariant-judge')) };

  it('is composed of assertion + hunk hash + judge hash', () => {
    const key = verdictCacheKey(
      unwrap(parseAccumulatorKey('INV-007')),
      unwrap(hunkHash([hunk('a.ts')])),
      unwrap(judgeHash(judge)),
    );
    expect(key.startsWith('INV-007/')).toBe(true);
    expect(key.split('/')).toHaveLength(3);
    expect(key).not.toContain(':'); // path-safe
  });

  it('changes when the judge changes — a new seat invalidates the cache', () => {
    const h = unwrap(hunkHash([hunk('a.ts')]));
    const a = verdictCacheKey(unwrap(parseAccumulatorKey('INV-007')), h, unwrap(judgeHash(judge)));
    const b = verdictCacheKey(
      unwrap(parseAccumulatorKey('INV-007')),
      h,
      unwrap(judgeHash({ ...judge, id: unwrap(parseJudgeId('other-judge')) })),
    );
    expect(a).not.toBe(b);
  });

  it('changes when the assertion changes — one assertion, one invocation', () => {
    const h = unwrap(hunkHash([hunk('a.ts')]));
    const j = unwrap(judgeHash(judge));
    expect(verdictCacheKey(unwrap(parseAccumulatorKey('INV-007')), h, j)).not.toBe(
      verdictCacheKey(unwrap(parseAccumulatorKey('INV-005')), h, j),
    );
  });

  it('renders hashes as bare hex segments', () => {
    const h = unwrap(hunkHash([hunk('a.ts')]));
    const key = verdictCacheKey(unwrap(parseAccumulatorKey('INV-007')), h, unwrap(judgeHash(judge)));
    expect(key.split('/')[1]).toBe(sha256RefHex(h));
  });
});

describe('scope intersection and the escalation ring (spec 03 §3)', () => {
  const hunks = [hunk('src/core/http.ts'), hunk('src/adapters/github/api.ts'), hunk('docs/x.md')];

  it('keeps only the hunks intersecting the assertion scope', () => {
    expect(scopedHunks([g('src/core/**')], hunks).map((h) => h.path)).toEqual(['src/core/http.ts']);
    expect(scopedHunks([g('src/**')], hunks)).toHaveLength(2);
    expect(scopedHunks([g('nothing/**')], hunks)).toHaveLength(0);
  });

  it('widens the ring on abstain, then hands over to the next rung of the ladder', () => {
    expect([...CONTEXT_RINGS]).toEqual(['hunk', 'enclosing-symbol', 'file', 'callers']);
    expect(widenContextRing('hunk')).toBe('enclosing-symbol');
    expect(widenContextRing('enclosing-symbol')).toBe('file');
    expect(widenContextRing('file')).toBe('callers');
    // null = "widened as far as the ring goes"; escalate a rung instead.
    expect(widenContextRing('callers')).toBeNull();
  });
});

describe('citations must land inside a hunk the judge was actually shown (INV-004)', () => {
  const bundle: EvidenceBundleInput = {
    assertion: {
      id: unwrap(parseAssertionId('INV-005')),
      statement: 'Engine core imports no forge-specific APIs',
      class: 'dependency',
      scope: [g('src/core/**')],
    },
    charterExcerpt: 'The engine core stays forge-agnostic.',
    hunks: [hunk('src/core/http.ts', 41, 18)],
    ring: 'hunk',
    precedent: null,
  };

  it('accepts a citation inside the shown span', () => {
    const sealed = unwrap(sealEvidence(bundle));
    expect(citationsWithinBundle(sealed, [unwrap(parseCitation('src/core/http.ts:41-58'))])).toBe(
      true,
    );
    expect(citationsWithinBundle(sealed, [unwrap(parseCitation('src/core/http.ts:45'))])).toBe(true);
  });

  it('rejects a citation outside the shown span — a hallucinated line', () => {
    const sealed = unwrap(sealEvidence(bundle));
    expect(citationsWithinBundle(sealed, [unwrap(parseCitation('src/core/http.ts:900'))])).toBe(
      false,
    );
    expect(citationsWithinBundle(sealed, [unwrap(parseCitation('src/core/http.ts:40'))])).toBe(
      false,
    );
  });

  it('rejects a citation into a file the judge never saw', () => {
    const sealed = unwrap(sealEvidence(bundle));
    expect(citationsWithinBundle(sealed, [unwrap(parseCitation('src/other.ts:41'))])).toBe(false);
  });

  it('accepts an empty citation list vacuously — the violation check is decodeVerdict’s job', () => {
    expect(citationsWithinBundle(unwrap(sealEvidence(bundle)), [])).toBe(true);
  });
});
