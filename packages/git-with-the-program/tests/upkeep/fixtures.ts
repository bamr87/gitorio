// Shared builders for the upkeep tests: a LocalFacts / HostFacts pair describing a small
// repository, overridable per test. Not a test file itself (no `.test.ts`).

import { defaultConfig } from '../../src/upkeep/config.js';
import type { PlanInput } from '../../src/upkeep/plan.js';
import type { HostFacts, LocalFacts, UpkeepConfig } from '../../src/upkeep/types.js';

export const SHA = (c: string): string => c.repeat(40).slice(0, 40);

export function localFacts(over: Partial<LocalFacts> = {}): LocalFacts {
  return {
    head: SHA('f'),
    branch: 'main',
    package: { name: 'demo', description: 'A demo package.', keywords: ['Demo Tool', 'git'], license: 'MIT' },
    readme: { path: 'README.md', tagline: 'A **demo** project.' },
    license_file: 'LICENSE',
    version: {
      source: { path: 'package.json', value: '1.0.0', line: 3 },
      others: [],
      introduced_at: null,
    },
    tags: [{ name: 'v1.0.0', sha: SHA('a') }],
    unreleased: [],
    history: [
      { tag: 'v1.0.0', sha: SHA('a'), previous: null, pending: false, commits: [{ sha: SHA('a'), subject: 'feat: first', breaking: false }], areas: { src: 1 } },
    ],
    references: [],
    docs: [],
    tree: { src: 3, '.': 2 },
    ...over,
  };
}

export function hostFacts(over: Partial<HostFacts> = {}): HostFacts {
  return {
    host: 'github',
    description: 'A demo package.',
    homepage: null,
    topics: ['demo-tool', 'git'],
    default_branch: 'main',
    license: 'MIT',
    releases: [{ id: 1, tag: 'v1.0.0', name: 'v1.0.0', body_empty: false, draft: false, prerelease: false }],
    labels: [],
    ...over,
  };
}

export function config(over: Partial<UpkeepConfig> = {}): UpkeepConfig {
  return { ...defaultConfig(), labels: { declared: [], from_code: false }, ...over };
}

export function planInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    config: config(),
    local: localFacts(),
    host: hostFacts(),
    codeLabels: [],
    repository: 'o/demo',
    now: new Date('2026-10-05T06:23:00Z'),
    ...over,
  };
}
