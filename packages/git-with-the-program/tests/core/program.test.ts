// Implements tests for: docs/spec/01-core-memory.md §3-§7 and docs/spec/04-distillation.md §4,
// against schemas/assertion.schema.json and schemas/precedent.schema.json.
//
// The last three suites decode THIS REPO'S OWN `.program/` — the self-hosting obligation
// (docs/vision.md), and the cheapest possible proof that the contract layer matches the
// shipped constitution. Read-only: nothing here writes to `.program/` (INV-001).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  ASSERTION_STATUSES,
  decodeAssertion,
  decodeInvariantsFile,
  encodeAssertion,
  isCandidateAssertion,
  isEnforceable,
  isEnforced,
  isInvariantAssertion,
  parseBudget,
  parsePrecision,
} from '../../src/core/assertion.js';
import { decodePrecedent, decodePrecedentsFile, isTombstone, precedentView } from '../../src/core/precedent.js';
import {
  assertionsGoverning,
  decodeManifest,
  decodeScopeFile,
  decodeTrajectoryFile,
  enforcedAssertions,
  ratifiedAssertions,
  unclaimedPaths,
  type Program,
} from '../../src/core/program.js';
import { parseRepoPath } from '../../src/core/paths.js';
import { unwrap } from '../../src/core/result.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const readProgram = (name: string): unknown => parseYaml(readFileSync(`${REPO}.program/${name}`, 'utf8'));

const codes = (raw: unknown): string[] => {
  const r = decodeAssertion(raw);
  return r.ok ? [] : r.error.map((e) => e.code);
};

const VALID = {
  id: 'INV-007',
  statement: 'Core stays dependency-free; adapters own all third-party imports',
  class: 'boundary',
  scope: ['src/core/**'],
  enforcement: 'judgment',
  precision: 0.9,
  budget: 3.0,
  half_life: '90d',
  status: 'ratified',
  provenance: ['pr#41', 'adr-0003', 'commit abc123'],
};

describe('the assertion atom (spec 01 §3)', () => {
  it("decodes spec 01 §3's own example", () => {
    const a = unwrap(decodeAssertion(VALID));
    expect(a.id).toBe('INV-007');
    expect(a.class).toBe('boundary');
    expect(a.half_life.source).toBe('90d');
    expect(a.half_life.millis).toBe(90 * 86_400_000);
    expect(a.provenance).toHaveLength(3);
  });

  it('re-emits half_life verbatim, so a YAML round trip is byte-stable', () => {
    expect(encodeAssertion(unwrap(decodeAssertion(VALID)))['half_life']).toBe('90d');
  });

  it('keeps knob ranges from schemas/assertion.schema.json', () => {
    expect(parsePrecision(0.9).ok).toBe(true);
    expect(parsePrecision(1).ok).toBe(true);
    expect(parsePrecision(0).ok).toBe(false); // exclusiveMinimum
    expect(parsePrecision(1.1).ok).toBe(false); // maximum
    expect(parseBudget(3).ok).toBe(true);
    expect(parseBudget(0).ok).toBe(false);
    expect(parseBudget(-1).ok).toBe(false);
  });
});

describe('spec 01 §4 — the two non-negotiable field rules', () => {
  it('rule 1: no assertion without provenance', () => {
    const { provenance: _p, ...noProv } = VALID;
    expect(codes(noProv)).toContain('missing-field');
    expect(codes({ ...VALID, provenance: [] })).toContain('wrong-type');
  });

  it('rule 2: status is a closed lifecycle', () => {
    for (const status of ['inferred', 'ratified', 'contested', 'amended', 'retired']) {
      expect(decodeAssertion({ ...VALID, status }).ok).toBe(true);
    }
    expect(codes({ ...VALID, status: 'approved' })).toContain('invalid-enum');
  });

  it('only `ratified` is enforced; `contested` mutes enforcement', () => {
    const at = (status: string) => unwrap(decodeAssertion({ ...VALID, status }));
    expect(isEnforced(at('ratified'))).toBe(true);
    expect(isEnforceable(at('ratified'))).toBe(true);
    for (const muted of ['inferred', 'contested', 'amended', 'retired']) {
      expect(isEnforced(at(muted))).toBe(false);
      expect(isEnforceable(at(muted))).toBe(false);
    }
  });
});

describe('spec 04 §4 — distillation may only emit `inferred`', () => {
  it('accepts a CAND-* assertion with status inferred', () => {
    const a = unwrap(decodeAssertion({ ...VALID, id: 'CAND-014', status: 'inferred' }));
    expect(isCandidateAssertion(a)).toBe(true);
    expect(a.status).toBe('inferred');
  });

  it('REJECTS a self-ratifying CAND-* assertion (schema allOf/0)', () => {
    const r = decodeAssertion({ ...VALID, id: 'CAND-014', status: 'ratified' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.map((e) => e.code)).toContain('invalid-enum');
      expect(r.error.some((e) => e.clause === 'gwtp/assertion.schema.json#/allOf/0')).toBe(true);
    }
  });

  it('carries the distillation evidence summary (spec 04 §5)', () => {
    const a = unwrap(
      decodeAssertion({
        ...VALID,
        id: 'CAND-014',
        status: 'inferred',
        precision_seed: 0.85,
        evidence: {
          span: '2022-03 -> present',
          corroborations: ['import-graph e3..e6', 'pr#88', 'revert 9f2c1d'],
        },
      }),
    );
    expect(a.precision_seed).toBe(0.85);
    expect(a.evidence?.corroborations).toHaveLength(3);
  });
});

describe('malformed assertions are rejected (SEED-01 acceptance fixture)', () => {
  it.each([
    ['bad id', { id: 'INV-7' }, 'invalid-id'],
    ['statement below minLength 8', { statement: 'short' }, 'wrong-type'],
    ['unknown class', { class: 'vibes' }, 'invalid-enum'],
    ['unknown enforcement', { enforcement: 'strict' }, 'invalid-enum'],
    ['precision out of range', { precision: 1.5 }, 'invalid-precision'],
    ['budget of zero', { budget: 0 }, 'invalid-budget'],
    ['half_life in an unknown unit', { half_life: '90y' }, 'invalid-duration'],
    ['empty scope', { scope: [] }, 'wrong-type'],
    ['unsupported glob syntax', { scope: ['src/{a,b}'] }, 'invalid-glob'],
    ['an unknown field', { author: 'amr' }, 'strictness'],
  ])('rejects %s', (_label, patch, code) => {
    expect(codes({ ...VALID, ...patch })).toContain(code);
  });

  it('accumulates every problem in one pass, for `gwtp validate`', () => {
    const r = decodeAssertion({ id: 'nope', class: 'vibes', precision: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
  });
});

describe('precedents (spec 01 §5)', () => {
  const PRE = {
    id: 'PRE-003',
    pattern: 'retry logic inline in request handlers',
    ruling: 'killed',
    rationale: 'centralized in middleware after cascade incident',
    evidence: ['revert 9f2c1d', 'issue#88'],
  };

  it("decodes spec 01 §5's own example", () => {
    const p = unwrap(decodePrecedent(PRE));
    expect(p.ruling).toBe('killed');
    expect(p.evidence).toHaveLength(2);
  });

  it('requires evidence (minItems 1) — it doubles as the bar-exam corpus', () => {
    const r = decodePrecedent({ ...PRE, evidence: [] });
    expect(r.ok).toBe(false);
  });

  it('keeps rationale optional here, unlike on a violation verdict', () => {
    const { rationale: _r, ...noRationale } = PRE;
    expect(decodePrecedent(noRationale).ok).toBe(true);
  });

  it('recognises a coincidence tombstone (spec 04 §6)', () => {
    const p = unwrap(decodePrecedent({ ...PRE, ruling: 'coincidence' }));
    expect(isTombstone(p)).toBe(true);
  });

  it('the regression judge view carries no evidence links (they name authors and threads)', () => {
    const v = precedentView(unwrap(decodePrecedent(PRE)));
    expect(Object.keys(v).sort()).toEqual(['id', 'pattern', 'rationale', 'ruling']);
    expect((v as unknown as Record<string, unknown>)['evidence']).toBeUndefined();
  });

  it('rejects an unknown ruling', () => {
    expect(decodePrecedent({ ...PRE, ruling: 'overturned' }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The self-hosting obligation: decode this repo's own constitution
// ---------------------------------------------------------------------------

describe("this repo's own .program/ decodes against the contract layer", () => {
  it('invariants.yaml: all six assertions', () => {
    const invariants = unwrap(decodeInvariantsFile(readProgram('invariants.yaml')));
    expect(invariants.map((a) => a.id)).toEqual([
      'INV-001',
      'INV-002',
      'INV-003',
      'INV-004',
      'INV-005',
      'INV-006',
    ]);
  });

  // Was "every shipped assertion is still `inferred`". That assertion described a MOMENT, not
  // a contract, and it went red the instant PR #1 ("ratified") landed — which is the framework
  // working exactly as designed, and the test failing to be a test. `.program/` is amended by
  // human PRs (INV-001), so what a self-hosting test may pin is the RELATIONSHIP between the
  // shipped statuses and the enforcement gate, never today's values.
  it('the enforcement gate over the shipped constitution is exactly its ratified set', () => {
    const invariants = unwrap(decodeInvariantsFile(readProgram('invariants.yaml')));
    expect(invariants.every((a) => (ASSERTION_STATUSES as readonly string[]).includes(a.status)))
      .toBe(true);
    // spec 01 §4.2: enforced iff ratified — `inferred` is not enforced, `contested` mutes,
    // `amended`/`retired` are terminal.
    expect(invariants.filter(isEnforced).map((a) => a.id)).toEqual(
      invariants.filter((a) => a.status === 'ratified').map((a) => a.id),
    );
    // spec 04 §4: whatever the humans ratify, a distillation candidate is never among it.
    expect(invariants.filter(isEnforced).filter(isCandidateAssertion)).toEqual([]);
  });

  it('INV-001 and INV-003 carry zero-tolerance knobs', () => {
    const invariants = unwrap(decodeInvariantsFile(readProgram('invariants.yaml')));
    for (const id of ['INV-001', 'INV-003']) {
      const a = invariants.find((x) => x.id === id);
      expect(a?.precision).toBe(1);
      expect(a?.budget).toBe(1);
    }
  });

  it('precedents.yaml: legally empty', () => {
    expect(unwrap(decodePrecedentsFile(readProgram('precedents.yaml')))).toEqual([]);
  });

  it('manifest.yaml: authored, not distilled (last_walked is null)', () => {
    const m = unwrap(decodeManifest(readProgram('manifest.yaml')));
    expect(m.schema_version).toBe('0.1.0');
    expect(m.watermark.last_walked).toBeNull();
    expect(m.watermark.last_epoch).toBe('e0');
    expect(m.judges).toEqual([]);
  });

  it('scope.yaml: eight claims, including src/**, scripts/** and tests/** (ratified)', () => {
    const scope = unwrap(decodeScopeFile(readProgram('scope.yaml')));
    expect(scope.map((c) => c.path).sort()).toEqual([
      '.program/**',
      'docs/**',
      'prompts/**',
      'schemas/**',
      'scripts/**',
      'seeds/**',
      'src/**',
      'tests/**',
    ]);
  });

  it('trajectory.yaml: three intents', () => {
    const traj = unwrap(decodeTrajectoryFile(readProgram('trajectory.yaml')));
    expect(traj.map((e) => e.id)).toEqual(['TRJ-001', 'TRJ-002', 'TRJ-003']);
    expect(traj.find((e) => e.id === 'TRJ-002')?.implies_obsolete).toEqual(['src/judge/stub/**']);
  });
});

describe('program queries over the shipped constitution', () => {
  const program = (): Program => ({
    manifest: unwrap(decodeManifest(readProgram('manifest.yaml'))),
    charter: readFileSync(`${REPO}.program/charter.md`, 'utf8'),
    invariants: unwrap(decodeInvariantsFile(readProgram('invariants.yaml'))),
    precedents: unwrap(decodePrecedentsFile(readProgram('precedents.yaml'))),
    scope: unwrap(decodeScopeFile(readProgram('scope.yaml'))),
    trajectory: unwrap(decodeTrajectoryFile(readProgram('trajectory.yaml'))),
  });

  // Was "nothing is enforced yet, because nothing is ratified yet" — see the note above: that
  // was true until PR #1 ratified the program, and pinning it made the test a hostage of the
  // constitution's current epoch. The routing law itself is epoch-independent.
  it('scope routing follows the enforcement gate, whatever the current epoch has ratified', () => {
    const p = program();
    expect(enforcedAssertions(p).map((a) => a.id)).toEqual(
      ratifiedAssertions(p).map((a) => a.id),
    );
    // INV-005 is the only shipped assertion claiming src/core/**, so it governs that path
    // exactly when it is ratified, and never otherwise.
    const inv005 = p.invariants.find((a) => a.id === 'INV-005');
    expect(inv005).toBeDefined();
    expect(
      assertionsGoverning(p, unwrap(parseRepoPath('src/core/event.ts'))).map((a) => a.id),
    ).toEqual(inv005 !== undefined && isEnforced(inv005) ? ['INV-005'] : []);
  });

  it('once ratified, INV-005 governs src/core/** and INV-003 governs src/judge/**', () => {
    const base = program();
    // NOTE: `.map(a => ({...a, status: 'ratified'}))` over the whole list does NOT compile —
    // CandidateAssertion pins `status` to the literal 'inferred', so a distillation candidate
    // cannot be mass-ratified even by accident (schema allOf/0, spec 04 §4). Only INV-* arms
    // can be promoted, and only deliberately.
    const ratified: Program = {
      ...base,
      invariants: base.invariants
        .filter(isInvariantAssertion)
        .map((a) => ({ ...a, status: 'ratified' as const })),
    };
    expect(
      assertionsGoverning(ratified, unwrap(parseRepoPath('src/core/event.ts'))).map((a) => a.id),
    ).toEqual(['INV-005']);
    // src/judge/** is governed by two statutes at once — blindness AND the citation contract.
    // One assertion, one diff, one invocation (spec 03 §1): this is the fan-out.
    expect(
      assertionsGoverning(ratified, unwrap(parseRepoPath('src/judge/index.ts'))).map((a) => a.id),
    ).toEqual(['INV-003', 'INV-004']);
    expect(
      assertionsGoverning(ratified, unwrap(parseRepoPath('.program/charter.md'))).map((a) => a.id),
    ).toEqual(['INV-001', 'INV-006']);
  });

  it('src/** is claimed, so the engine source is no longer a stale-claim candidate', () => {
    const p = program();
    const tree = ['docs/vision.md', 'schemas/event.schema.json', 'src/core/index.ts'].map((x) =>
      unwrap(parseRepoPath(x)),
    );
    // After the scope amendment every path above is claimed; nothing is left unclaimed. An
    // unclaimed path here would be the obsolescence sweep's cue to file a stale-claim against the
    // engine's own source (spec 01 §6, spec 02 §7).
    expect(unclaimedPaths(p, tree)).toEqual([]);
  });

  it("the charter is kept as raw prose, since it is what humans ratify", () => {
    expect(program().charter).toContain('Law and evidence never share a write path');
  });
});
