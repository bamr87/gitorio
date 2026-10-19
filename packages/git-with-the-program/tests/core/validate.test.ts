// Implements tests for: src/core/validate.ts — the cross-entry rules of
// docs/spec/01-core-memory.md §3-§5 and the structural rules of §6-§7 for the three
// `.program/` files no JSON Schema binds (docs/spec/OPEN-QUESTIONS.md Q-08).
//
// These run against RAW documents, without ajv and without the filesystem: the point of the
// module is that a governance rule is a pure function of the parsed YAML.

import { describe, expect, it } from 'vitest';
import type { ContractError } from '../../src/core/result.js';
import {
  allFindings,
  crossFileAssertionErrors,
  crossFilePrecedentErrors,
  mergeErrors,
  structuralManifestErrors,
  structuralScopeErrors,
  structuralTrajectoryErrors,
  validateInvariantsDocument,
  validateManifestDocument,
  validatePrecedentsDocument,
  validateScopeDocument,
  validateTrajectoryDocument,
} from '../../src/core/validate.js';

function messagesAt(errors: readonly ContractError[], at: string): string[] {
  return errors.filter((e) => e.at === at).map((e) => e.message);
}

function pointers(errors: readonly ContractError[]): string[] {
  return errors.map((e) => e.at ?? '');
}

const WELL_FORMED = {
  id: 'INV-001',
  statement: 'Nothing writes to .program/ except human-ratified PRs',
  class: 'boundary',
  scope: ['.program/**'],
  enforcement: 'deterministic',
  precision: 1.0,
  budget: 1.0,
  half_life: '365d',
  status: 'ratified',
  provenance: ['adr-0001'],
} as const;

describe('cross-entry assertion rules (spec 01 §3-§4, spec 04 §4)', () => {
  it('accepts a well-formed sequence', () => {
    expect(crossFileAssertionErrors([WELL_FORMED, { ...WELL_FORMED, id: 'INV-002' }])).toEqual([]);
  });

  it('rejects a duplicate id and names where it was first seen', () => {
    const errors = crossFileAssertionErrors([WELL_FORMED, { ...WELL_FORMED }]);
    expect(pointers(errors)).toContain('/1/id');
    expect(messagesAt(errors, '/1/id')[0]).toContain('duplicate assertion id `INV-001`');
    expect(messagesAt(errors, '/1/id')[0]).toContain('first seen at /0');
    expect(messagesAt(errors, '/1/id')[0]).toContain('spec 01 §3');
  });

  it('does not confuse two distinct ids', () => {
    const errors = crossFileAssertionErrors([WELL_FORMED, { ...WELL_FORMED, id: 'CAND-001' }]);
    expect(errors.filter((e) => e.message.includes('duplicate'))).toEqual([]);
  });

  it.each([
    ['absent', {}, 'has no provenance'],
    ['empty', { provenance: [] }, 'has empty provenance'],
    ['null', { provenance: null }, 'has no provenance'],
  ])('rejects %s provenance with the spec 01 §4 wording', (_label, patch, fragment) => {
    const entry: Record<string, unknown> = { ...WELL_FORMED, ...patch };
    if (Object.keys(patch).length === 0) delete entry['provenance'];
    const errors = crossFileAssertionErrors([entry]);
    const message = messagesAt(errors, '/0/provenance')[0];
    expect(message).toContain(fragment);
    expect(message).toContain('no assertion without provenance');
    expect(message).toContain('spec 01 §4 rule 1');
  });

  it('rejects provenance that is not a sequence', () => {
    const errors = crossFileAssertionErrors([{ ...WELL_FORMED, provenance: 'adr-0001' }]);
    expect(messagesAt(errors, '/0/provenance')[0]).toContain('must be a sequence of citations');
  });

  it('rejects a blank provenance citation', () => {
    const errors = crossFileAssertionErrors([{ ...WELL_FORMED, provenance: ['adr-0001', '   '] }]);
    expect(messagesAt(errors, '/0/provenance/1')[0]).toContain('non-empty citations');
  });

  it('forbids a CAND-* assertion from carrying any status but `inferred`', () => {
    const errors = crossFileAssertionErrors([
      { ...WELL_FORMED, id: 'CAND-014', status: 'ratified' },
    ]);
    const message = messagesAt(errors, '/0/status')[0];
    expect(message).toContain('CAND-* ids may only carry `status: inferred`');
    expect(message).toContain('spec 04 §4');
    expect(errors[0]?.clause).toBe('gwtp/assertion.schema.json#/allOf/0');
  });

  it('permits a CAND-* assertion that is `inferred`', () => {
    const errors = crossFileAssertionErrors([
      { ...WELL_FORMED, id: 'CAND-014', status: 'inferred' },
    ]);
    expect(errors).toEqual([]);
  });

  it('leaves non-record entries to the decoder rather than double-reporting', () => {
    expect(crossFileAssertionErrors(['not-a-mapping', 42, null])).toEqual([]);
  });
});

describe('cross-entry precedent rules (spec 01 §5)', () => {
  it('rejects a duplicate precedent id', () => {
    const errors = crossFilePrecedentErrors([
      { id: 'PRE-003', pattern: 'x', ruling: 'killed', evidence: ['a'] },
      { id: 'PRE-003', pattern: 'y', ruling: 'killed', evidence: ['b'] },
    ]);
    expect(messagesAt(errors, '/1/id')[0]).toContain('duplicate precedent id `PRE-003`');
  });

  it('accepts the empty corpus the repo ships', () => {
    expect(crossFilePrecedentErrors([])).toEqual([]);
  });
});

describe('structural manifest rules (spec 01 §7)', () => {
  const GOOD = { schema_version: '0.1.0', watermark: { last_walked: null, last_epoch: 'e0' }, judges: [] };

  it('accepts the manifest this repo ships', () => {
    expect(structuralManifestErrors(GOOD)).toEqual([]);
  });

  it('requires schema_version, watermark and judges', () => {
    const errors = structuralManifestErrors({});
    expect(pointers(errors)).toEqual(
      expect.arrayContaining(['/schema_version', '/watermark', '/judges']),
    );
  });

  it('requires last_walked to be PRESENT even when it is null', () => {
    const errors = structuralManifestErrors({ ...GOOD, watermark: { last_epoch: 'e0' } });
    expect(messagesAt(errors, '/watermark/last_walked')[0]).toContain('authored');
  });

  it('rejects an unknown top-level key as a silent typo', () => {
    const errors = structuralManifestErrors({ ...GOOD, epoch: 'e0' });
    expect(messagesAt(errors, '/epoch')[0]).toContain('unknown field');
  });

  it('rejects a judge seat missing part of its seating identity', () => {
    const errors = structuralManifestErrors({ ...GOOD, judges: [{ id: 'invariant-judge' }] });
    expect(pointers(errors)).toEqual(
      expect.arrayContaining(['/judges/0/model', '/judges/0/prompt']),
    );
  });

  it('rejects two seats with the same id', () => {
    const seat = { id: 'invariant-judge', model: 'm', prompt: `sha256:${'a'.repeat(64)}` };
    const errors = structuralManifestErrors({ ...GOOD, judges: [seat, seat] });
    expect(messagesAt(errors, '/judges/1/id')[0]).toContain('duplicate judge seat');
  });

  it('rejects a manifest that is not a mapping', () => {
    expect(structuralManifestErrors([]).length).toBeGreaterThan(0);
  });
});

describe('structural scope rules (spec 01 §6)', () => {
  const GOOD = { claims: [{ path: 'docs/**', since: 'e0' }] };

  it('accepts the scope this repo ships', () => {
    expect(structuralScopeErrors(GOOD)).toEqual([]);
  });

  it('requires the `claims` key, so a misspelling cannot silently forfeit the baseline', () => {
    const errors = structuralScopeErrors({ claim: [] });
    expect(messagesAt(errors, '/claims')[0]).toContain('obsolescence baseline');
    expect(messagesAt(errors, '/claim')[0]).toContain('unknown field');
  });

  it('requires both fields of a claim', () => {
    const errors = structuralScopeErrors({ claims: [{}] });
    expect(pointers(errors)).toEqual(
      expect.arrayContaining(['/claims/0/path', '/claims/0/since']),
    );
  });

  it('reports a duplicated claim path', () => {
    const errors = structuralScopeErrors({
      claims: [
        { path: 'docs/**', since: 'e0' },
        { path: 'docs/**', since: 'e2' },
      ],
    });
    expect(messagesAt(errors, '/claims/1/path')[0]).toContain('duplicate scope claim');
  });

  it('rejects an unknown key on a claim', () => {
    const errors = structuralScopeErrors({ claims: [{ path: 'docs/**', since: 'e0', note: 'x' }] });
    expect(messagesAt(errors, '/claims/0/note')[0]).toContain('unknown field');
  });
});

describe('structural trajectory rules (spec 01 §6)', () => {
  const GOOD = [{ id: 'TRJ-001', intent: 'Reach v0', horizon: 'v0', implies_obsolete: [] }];

  it('accepts the trajectory this repo ships', () => {
    expect(structuralTrajectoryErrors(GOOD)).toEqual([]);
  });

  it('treats an empty file as an empty trajectory', () => {
    expect(structuralTrajectoryErrors(null)).toEqual([]);
    expect(structuralTrajectoryErrors(undefined)).toEqual([]);
  });

  it('rejects a mapping where a sequence belongs', () => {
    expect(structuralTrajectoryErrors({ id: 'TRJ-001' }).length).toBeGreaterThan(0);
  });

  it('requires id, intent and horizon', () => {
    const errors = structuralTrajectoryErrors([{}]);
    expect(pointers(errors)).toEqual(expect.arrayContaining(['/0/id', '/0/intent', '/0/horizon']));
  });

  it('requires implies_obsolete to be a sequence of globs', () => {
    const errors = structuralTrajectoryErrors([{ ...GOOD[0], implies_obsolete: 'src/**' }]);
    expect(messagesAt(errors, '/0/implies_obsolete')[0]).toContain('sequence of path globs');
  });

  it('rejects a duplicate trajectory id', () => {
    const errors = structuralTrajectoryErrors([GOOD[0], GOOD[0]]);
    expect(messagesAt(errors, '/1/id')[0]).toContain('duplicate trajectory id');
  });

  it('rejects an unknown key', () => {
    const errors = structuralTrajectoryErrors([{ ...GOOD[0], deadline: '2026-12-01' }]);
    expect(messagesAt(errors, '/0/deadline')[0]).toContain('unknown field');
  });
});

describe('document entry points keep the two streams apart', () => {
  it('reports a duplicate id as a RULE and a bad enum as a DECODER finding', () => {
    const findings = validateInvariantsDocument([
      WELL_FORMED,
      { ...WELL_FORMED, enforcement: 'advisory' },
    ]);
    expect(findings.rules.some((e) => e.message.includes('duplicate assertion id'))).toBe(true);
    expect(findings.decoder.some((e) => e.at === '/1/enforcement')).toBe(true);
    expect(findings.rules.some((e) => e.at === '/1/enforcement')).toBe(false);
  });

  it('rejects an invariants document that is not a sequence', () => {
    const findings = validateInvariantsDocument(WELL_FORMED);
    expect(findings.rules[0]?.message).toContain('must be a sequence of assertions');
  });

  it('rejects a precedents document that is not a sequence', () => {
    const findings = validatePrecedentsDocument({ id: 'PRE-003' });
    expect(findings.rules[0]?.message).toContain('must be a sequence of settled cases');
  });

  it('treats an absent invariants file as an empty program', () => {
    expect(allFindings(validateInvariantsDocument(null))).toEqual([]);
    expect(allFindings(validatePrecedentsDocument(null))).toEqual([]);
  });

  it('passes the exact documents this repo ships', () => {
    expect(
      allFindings(
        validateManifestDocument({
          schema_version: '0.1.0',
          watermark: { last_walked: null, last_epoch: 'e0' },
          judges: [],
        }),
      ),
    ).toEqual([]);
    expect(
      allFindings(
        validateScopeDocument({
          claims: [
            { path: 'docs/**', since: 'e0' },
            { path: 'schemas/**', since: 'e0' },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      allFindings(
        validateTrajectoryDocument([
          { id: 'TRJ-001', intent: 'Reach v0', horizon: 'v0', implies_obsolete: [] },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('mergeErrors', () => {
  it('drops exact duplicates and keeps first-seen order', () => {
    const a: ContractError = { code: 'missing-field', message: 'gone', at: '/x' };
    const b: ContractError = { code: 'wrong-type', message: 'nope', at: '/y' };
    expect(mergeErrors([a, b], [{ ...a }, b])).toEqual([a, b]);
  });

  it('keeps two findings that differ only in message', () => {
    const a: ContractError = { code: 'missing-field', message: 'one', at: '/x' };
    const b: ContractError = { code: 'missing-field', message: 'two', at: '/x' };
    expect(mergeErrors([a], [b])).toHaveLength(2);
  });
});
