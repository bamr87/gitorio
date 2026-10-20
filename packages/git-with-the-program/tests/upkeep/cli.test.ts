// Implements tests for: docs/spec/06-upkeep.md §3 and INV-006's spirit for upkeep's own
// artifacts — the committed config and every generated plan validate against
// schemas/upkeep-*.schema.json (ajv, authoritative) — and the `gwtp upkeep` command surface,
// run OFFLINE against this repository (no forge, no model, no network).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { main } from '../../src/cli/index.js';
import { loadUpkeepSchemas, run } from '../../src/cli/commands/upkeep.js';
import { resolveConfig } from '../../src/upkeep/config.js';
import { planUpkeep } from '../../src/upkeep/plan.js';
import type { UpkeepPlan } from '../../src/upkeep/types.js';
import { hostFacts, localFacts, planInput } from './fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMAS = loadUpkeepSchemas(join(REPO_ROOT, 'schemas'));

let stdout = '';
let stderr = '';
beforeEach(() => {
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => ((stdout += String(c)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => ((stderr += String(c)), true));
});
afterEach(() => vi.restoreAllMocks());

describe('schemas', () => {
  it("this repository's .github/upkeep.yaml validates and resolves", () => {
    const raw = parseYaml(readFileSync(join(REPO_ROOT, '.github', 'upkeep.yaml'), 'utf8')) as unknown;
    expect(SCHEMAS.config(raw), JSON.stringify(SCHEMAS.config.errors)).toBe(true);
    const resolved = resolveConfig(raw);
    expect(resolved.ok, JSON.stringify(!resolved.ok && resolved.error)).toBe(true);
  });

  it('rejects a config with an unknown key or a bad topic', () => {
    expect(SCHEMAS.config({ schema_version: '0.1.0', surprise: true })).toBe(false);
    expect(SCHEMAS.config({ schema_version: '0.1.0', metadata: { topics: { include: ['Not Valid'] } } })).toBe(false);
  });

  it('resolveConfig catches what draft-07 cannot: capture-group counts and duplicate ids', () => {
    const r = resolveConfig({
      schema_version: '0.1.0',
      versioning: { files: [{ path: 'package.json', pattern: '"version"' }] },
      references: [
        { id: 'x', doc: 'README.md', items: { glob: 'a/*' }, mention: '{item}' },
        { id: 'x', doc: 'README.md', items: { file: 'f', pattern: '(a)(b)' }, mention: '{item}' },
      ],
    });
    expect(r.ok).toBe(false);
    const errors = !r.ok ? r.error.join('\n') : '';
    expect(errors).toContain('exactly one capture group (has 0)');
    expect(errors).toContain('is not unique');
    expect(errors).toContain('items.pattern must compile with exactly one capture group');
  });

  it('every kind of generated plan validates; an agent edit that breaks the contract does not', () => {
    const plans: UpkeepPlan[] = [
      planUpkeep(planInput()),
      planUpkeep(planInput({ host: null, hostError: 'offline' })),
      planUpkeep(planInput({ host: hostFacts({ description: null, topics: [], releases: [] }), local: localFacts({ license_file: null }) })),
    ];
    for (const p of plans) expect(SCHEMAS.plan(p), JSON.stringify(SCHEMAS.plan.errors)).toBe(true);

    const p = plans[2]!;
    const filledWithoutProvider = { ...p, content: [{ id: 'C1', kind: 'topics', brief: { instructions: 'x', context: {} }, status: 'filled', value: [], fallback: [] }] };
    expect(SCHEMAS.plan(filledWithoutProvider)).toBe(false);
    const extraActionField = { ...p, actions: [{ id: 'A1', kind: 'tag.create', tag: 'v1', sha: 'a'.repeat(40), force: true }] };
    expect(SCHEMAS.plan(extraActionField)).toBe(false);
  });
});

describe('gwtp upkeep (offline, against this repository)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gwtp-upkeep-cli-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is registered in the top-level command table', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(stdout).toContain('upkeep');
  });

  it('plan → check → fill → apply (dry run) → report', async () => {
    const plan = join(dir, 'plan.json');
    const outcomes = join(dir, 'outcomes.json');

    expect(await run(['plan', '--root', REPO_ROOT, '--offline', '--out', plan])).toBe(0);
    expect(stdout).toContain('# Repository upkeep');
    expect(stdout).toContain('unobserved');
    const written = JSON.parse(readFileSync(plan, 'utf8')) as UpkeepPlan;
    expect(SCHEMAS.plan(written)).toBe(true);
    expect(written.observed.host).toBeNull();

    expect(await run(['check', '--root', REPO_ROOT, '--plan', plan])).toBe(0);
    expect(stdout).toContain('PASS');

    expect(await run(['fill', '--root', REPO_ROOT, '--plan', plan, '--provider', 'template'])).toBe(0);
    const filled = JSON.parse(readFileSync(plan, 'utf8')) as UpkeepPlan;
    expect(filled.content.every((c) => c.status === 'fallback')).toBe(true);

    stdout = '';
    expect(await run(['apply', '--root', REPO_ROOT, '--plan', plan, '--outcomes', outcomes])).toBe(0);
    expect(stderr).toContain('dry run');
    const out = JSON.parse(readFileSync(outcomes, 'utf8')) as { status: string }[];
    expect(out.every((o) => o.status === 'planned')).toBe(true);

    expect(await run(['report', '--root', REPO_ROOT, '--plan', plan, '--in-tree'])).toBe(0);
  });

  it('check fails on an agent edit that breaks a content contract', async () => {
    const plan = join(dir, 'bad.json');
    const base = planUpkeep(planInput({ host: hostFacts({ description: null }), config: { ...planInput().config, metadata: { description: { from: 'ai' } } } }));
    writeFileSync(plan, JSON.stringify({ ...base, content: base.content.map((c) => ({ ...c, status: 'filled', provider: 'agent', value: 'two\nlines' })) }));
    expect(await run(['check', '--root', REPO_ROOT, '--plan', plan])).toBe(1);
    expect(stdout).toContain('one line');
  });

  it('check --against fails a plan whose actions an agent changed', async () => {
    const engine = join(dir, 'engine.json');
    const edited = join(dir, 'edited.json');
    const base = planUpkeep(planInput({ host: hostFacts({ topics: [] }) }));
    writeFileSync(engine, JSON.stringify(base));
    writeFileSync(edited, JSON.stringify({ ...base, actions: base.actions.map((a) => (a.kind === 'repo.topics' ? { ...a, names: ['spam'] } : a)) }));
    expect(await run(['check', '--root', REPO_ROOT, '--plan', engine, '--against', engine])).toBe(0);
    stdout = '';
    expect(await run(['check', '--root', REPO_ROOT, '--plan', edited, '--against', engine])).toBe(1);
    expect(stdout).toContain('TAMPERED: `actions` was modified');
  });

  it('usage errors exit 2', async () => {
    expect(await run(['nope'])).toBe(2);
    expect(await run(['check', '--plan', join(dir, 'missing.json')])).toBe(2);
    expect(await run(['plan', '--bogus'])).toBe(2);
    expect(await run(['fill', '--root', REPO_ROOT, '--plan', join(dir, 'plan.json'), '--provider', 'psychic'])).toBe(2);
  });
});
