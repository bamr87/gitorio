// Implements tests for: docs/spec/05-nexus.md §4 (interchange: the artifact validates against
// schemas/nexus.schema.json and carries NOTHING beyond nexus/extractor/stats/nodes/edges) and
// §3 (self-addressing). ajv is the authoritative validator and the engine decoder is the
// strict reader — the Q-29 split, held against each other here so the two contracts cannot
// drift silently. Plus the INV-003-extension fact (spec 05 §1.1): `assertBlind` walks a whole
// serialized nexus CLEAN, and the ForbiddenKey list never appears in the artifact.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv } from 'ajv';
// The `.default.default` spelling matches src/cli/commands/validate.ts: ajv-formats is CJS
// with both `module.exports` and `exports.default` set to the plugin, and under NodeNext the
// plugin is its own `.default`.
import * as ajvFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const addFormats = ajvFormats.default.default;

import { assertBlind, FORBIDDEN_KEYS } from '../../src/core/blindness.js';
import { unwrap } from '../../src/core/result.js';
import type { RepoPath } from '../../src/core/paths.js';
import { type FileSnapshot, buildNexus } from '../../src/nexus/build.js';
import {
  decodeNexusDocument,
  encodeNexusDocument,
  sealNexusDocument,
  verifyNexusDocument,
} from '../../src/nexus/serialize.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const path = (p: string): RepoPath => p as RepoPath;

const FILES: readonly FileSnapshot[] = [
  {
    path: path('src/x.ts'),
    content: [
      "import * as y from './y.js';",
      "import { parse } from 'yaml';",
      'export class Base {}',
      'export class Kid extends Base {',
      '  go(): void { y.helper(); parse(\'a\'); }',
      '}',
    ].join('\n'),
  },
  { path: path('src/y.ts'), content: 'export function helper(): number { return 1; }' },
  { path: path('assets/logo.bin'), content: '' },
];

const DOC = unwrap(sealNexusDocument(buildNexus(FILES)));

describe('the artifact against schemas/nexus.schema.json (ajv, authoritative)', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(
    readFileSync(join(REPO_ROOT, 'schemas', 'nexus.schema.json'), 'utf8'),
  ) as object;
  const validate = ajv.compile(schema);

  it('a freshly built artifact validates', () => {
    const roundTripped = JSON.parse(encodeNexusDocument(DOC)) as unknown;
    const valid = validate(roundTripped);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('the schema REJECTS an artifact with an extra top-level field — no timestamp can sneak in', () => {
    const withClock = { ...(JSON.parse(encodeNexusDocument(DOC)) as Record<string, unknown>), built_at: 'now' };
    expect(validate(withClock)).toBe(false);
  });

  it('the schema rejects an author field on a node — identity has no slot (spec 05 §1.1)', () => {
    const doc = JSON.parse(encodeNexusDocument(DOC)) as { nodes: Record<string, unknown>[] };
    (doc.nodes[0] as Record<string, unknown>)['author'] = 'someone';
    expect(validate(doc)).toBe(false);
  });
});

describe('self-addressing and the engine decoder', () => {
  it('round-trips byte-identically through encode -> decode -> encode', () => {
    const bytes = encodeNexusDocument(DOC);
    const decoded = unwrap(decodeNexusDocument(JSON.parse(bytes)));
    expect(encodeNexusDocument(decoded)).toBe(bytes);
  });

  it('verifyNexusDocument accepts the sealed artifact and rejects a tampered one', () => {
    expect(unwrap(verifyNexusDocument(DOC))).toBe(true);
    const decoded = unwrap(decodeNexusDocument(JSON.parse(encodeNexusDocument(DOC))));
    const tampered = {
      ...decoded,
      stats: { ...decoded.stats, files: decoded.stats.files + 1 },
    };
    const r = verifyNexusDocument(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('hash-mismatch');
  });

  it('the decoder rejects rather than repairs', () => {
    const doc = JSON.parse(encodeNexusDocument(DOC)) as Record<string, unknown>;
    doc['nodes'] = [{ id: 'module:src/x.ts', kind: 'module' }]; // missing required fields
    const r = decodeNexusDocument(doc);
    expect(r.ok).toBe(false);
  });
});

describe('INV-003, extended to perception (spec 05 §1.1)', () => {
  it('assertBlind walks a whole serialized nexus clean — no identity, no meter, no callable', () => {
    expect(() => assertBlind(JSON.parse(encodeNexusDocument(DOC)))).not.toThrow();
  });

  it('no ForbiddenKey ever appears anywhere in the artifact', () => {
    const seen = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) {
        for (const item of v) walk(item);
        return;
      }
      if (typeof v !== 'object' || v === null) return;
      for (const [k, item] of Object.entries(v)) {
        seen.add(k);
        walk(item);
      }
    };
    walk(JSON.parse(encodeNexusDocument(DOC)));
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(seen.has(forbidden), `forbidden key \`${forbidden}\` in the artifact`).toBe(false);
    }
    // Anti-vacuity: the walk saw a real artifact, not an empty object.
    expect(seen.has('nodes')).toBe(true);
    expect(seen.has('span')).toBe(true);
  });
});
