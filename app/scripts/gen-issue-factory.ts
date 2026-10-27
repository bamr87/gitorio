// One-off generator (run with vite-node) that produces the lifehacker.dev issue-factory
// example from the SAME sources the app uses — the template blueprint + the compiler — so the
// committed example can never drift from what GitFactory would deploy. Writes:
//   examples/issue-factory/issue-factory.blueprint.json
//   examples/issue-factory/workflows/factory--issue-factory-{1,2}.yml
// (The prompts in examples/issue-factory/prompts/ are hand-authored — they are the content,
// not compiler output.) Re-run after changing the template/compiler:
//   `cd app && npx vite-node scripts/gen-issue-factory.ts`

import { mkdirSync, writeFileSync } from 'node:fs';
import { TEMPLATES } from '../src/templates/catalog';
import { compile } from '../src/compiler/compile';

const ROOT = new URL('../../', import.meta.url); // repo root (app/scripts/ -> app/ -> root)
const write = (rel: string, body: string) => {
  writeFileSync(new URL(rel, ROOT), body);
  console.log('wrote', rel);
};

const t = TEMPLATES.find((x) => x.id === 'issue-factory');
if (!t) throw new Error('issue-factory template not found');

// The example targets the proven fleet repo. Inside the target repo the blueprint lives at
// .factory/issue-factory.blueprint.json — the header must point there for drift detection.
const bp = { ...t.blueprint, meta: { ...t.blueprint.meta, repo: 'bamr87/lifehacker.dev' } };

mkdirSync(new URL('examples/issue-factory/workflows/', ROOT), { recursive: true });
write('examples/issue-factory/issue-factory.blueprint.json', JSON.stringify(bp, null, 2) + '\n');

const res = compile(bp, { blueprintPath: '.factory/issue-factory.blueprint.json' });
const errors = res.workflows.flatMap((w) => w.diagnostics).filter((d) => d.level === 'error');
if (errors.length) {
  console.error('REFUSING to write: compile errors', errors);
  process.exit(1);
}
for (const wf of res.workflows) write(`examples/issue-factory/workflows/${wf.filename}`, wf.yaml);
console.log('done —', res.workflows.map((w) => w.filename).join(', '));
