// Target-repo generator (run with vite-node) that stamps GitFactory's AO-SDLC
// orchestration onto ANOTHER repo from the same sources the app uses — the
// ao-sdlc-autopilot template + the compiler — so the emitted artifacts can never
// drift from what GitFactory would produce (the ADR-018 dogfood pattern, aimed
// at a sibling checkout). Writes into <target>:
//   .factory/evolve-pilot.blueprint.json      + .github/workflows/factory--evolve-pilot.yml
//   .factory/backlog-triage.blueprint.json    + .github/workflows/factory--backlog-triage.yml
//   .factory/issue-concierge.blueprint.json   + .github/workflows/factory--issue-concierge.yml
// Operating prompts (.factory/prompts/*.md) are repo-owned and hand-authored in
// the target — this script warns if one is missing but does not write prompts.
// Every line is DEFAULT-OFF behind its own repo-variable kill switch.
//
// Usage: cd app && npx vite-node scripts/gen-aosdlc-factory.ts /path/to/target-repo

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES } from '../src/templates/catalog';
import { compile } from '../src/compiler/compile';
import type { Blueprint } from '../src/blueprint/types';

const target = process.argv[2];
if (!target || !existsSync(join(target, '.git'))) {
  console.error('usage: vite-node scripts/gen-aosdlc-factory.ts <target-repo-dir> (must be a git checkout)');
  process.exit(1);
}

const base = TEMPLATES.find((t) => t.id === 'ao-sdlc-autopilot');
if (!base) throw new Error('ao-sdlc-autopilot template not found');

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
type NodePatch = Record<string, Record<string, unknown>>;

// A pilot-shaped variant: same line, different identity/config.
function pilotVariant(name: string, description: string, patch: NodePatch): Blueprint {
  const bp = clone(base!.blueprint);
  bp.meta = { name, description };
  for (const node of bp.nodes) {
    const over = patch[node.id];
    if (over) node.config = { ...node.config, ...over };
  }
  return bp;
}

const N = (id: string, type: string, x: number, y: number, config: Record<string, unknown> = {}) => ({
  id,
  type,
  position: { x, y },
  config,
});
const E = (id: string, from: string, to: string) => ({
  id,
  from: { node: from, port: 'out' },
  to: { node: to, port: 'in' },
});

const LINES: Array<{ slug: string; blueprint: Blueprint }> = [
  {
    slug: 'evolve-pilot',
    blueprint: pilotVariant(
      'Evolve Pilot',
      'Weekly: advance the repo by one AO-SDLC cycle (top BACKLOG item → spec → implement → ONE reviewable PR).',
      {
        eg: { variable: 'EVOLVE_PILOT_ENABLED' },
        ea: {
          promptRef: '.factory/prompts/evolve-pilot.md',
          checks: 'python3 scripts/spec_validator.py\npython3 scripts/backlog_lint.py',
        },
      },
    ),
  },
  {
    slug: 'backlog-triage',
    blueprint: pilotVariant(
      'Backlog Triage',
      'Monthly: verify open BACKLOG items against the code and open ONE reconciliation PR (append-only; items move to Done, never deleted).',
      {
        ec: { cron: '0 9 1 * *' },
        eg: { variable: 'BACKLOG_TRIAGE_ENABLED' },
        ea: {
          promptRef: '.factory/prompts/backlog-triage.md',
          model: 'claude-sonnet-5-5',
          maxTurns: 30,
          checks: 'python3 scripts/spec_validator.py\npython3 scripts/backlog_lint.py',
        },
        epr: { branchHint: 'factory/triage-*' },
      },
    ),
  },
  {
    slug: 'issue-concierge',
    blueprint: {
      version: 1,
      meta: {
        name: 'Issue Concierge',
        description: 'New issues get a triage label + ONE short routing comment (bot-guarded, default-OFF).',
      },
      nodes: [
        N('t', 'trigger.issue_opened', 40, 140),
        N('g', 'gate.enablement', 250, 140, { variable: 'ISSUE_CONCIERGE_ENABLED' }),
        N('a', 'agent.claude', 460, 140, { promptRef: '.factory/prompts/issue-concierge.md', model: 'claude-sonnet-5-5', maxTurns: 10 }),
        N('lb', 'sink.label', 730, 60, { labels: '' }),
        N('cm', 'sink.comment', 730, 220, { instruction: 'posts ONE short triage comment (kind/severity guess + where it lands in BACKLOG.md); never posts a second comment on the same issue' }),
      ],
      edges: [E('e1', 't', 'g'), E('e2', 'g', 'a'), E('e3', 'a', 'lb'), E('e4', 'a', 'cm')],
    } as Blueprint,
  },
];

mkdirSync(join(target, '.factory'), { recursive: true });
mkdirSync(join(target, '.github', 'workflows'), { recursive: true });

const written: string[] = [];
for (const line of LINES) {
  const blueprintPath = `.factory/${line.slug}.blueprint.json`;
  const res = compile(line.blueprint, { blueprintPath });
  const errors = res.workflows.flatMap((w) => w.diagnostics).filter((d) => d.level === 'error');
  if (errors.length) {
    console.error(`REFUSING to write ${line.slug}: compile errors`, errors);
    process.exit(1);
  }
  const promptRef = line.blueprint.nodes.find((n) => n.type === 'agent.claude')?.config?.promptRef;
  if (typeof promptRef === 'string' && !existsSync(join(target, promptRef))) {
    console.warn(`warn: ${promptRef} does not exist in the target yet — author it before arming the line`);
  }
  writeFileSync(join(target, blueprintPath), JSON.stringify(line.blueprint, null, 2) + '\n');
  written.push(blueprintPath);
  for (const wf of res.workflows) {
    const rel = `.github/workflows/${wf.filename}`;
    writeFileSync(join(target, rel), wf.yaml);
    written.push(rel);
  }
}
console.log('wrote into', target, ':\n  ' + written.join('\n  '));
