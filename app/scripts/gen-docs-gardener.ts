// One-off generator (run with vite-node) that dogfoods the Docs Gardener onto this repo from
// the SAME sources the app uses — the template blueprint, the compiler, and the config model —
// so the committed artifacts can never drift from what GitFactory would produce. Writes:
//   .factory/docs-gardener.blueprint.json   (the standalone blueprint)
//   .factory/config.yml                      (the content config the gardener honors)
//   .github/workflows/factory--docs-gardener.yml
// Re-run after changing the template/compiler: `cd app && npx vite-node scripts/gen-docs-gardener.ts`

import { writeFileSync } from 'node:fs';
import { TEMPLATES } from '../src/templates/catalog';
import { compile } from '../src/compiler/compile';
import { defaultConfig, serializeConfig } from '../src/content/model';

const ROOT = new URL('../../', import.meta.url); // repo root (app/scripts/ -> app/ -> root)
const write = (rel: string, body: string) => {
  writeFileSync(new URL(rel, ROOT), body);
  console.log('wrote', rel);
};

const t = TEMPLATES.find((x) => x.id === 'docs-gardener');
if (!t) throw new Error('docs-gardener template not found');

const BLUEPRINT_PATH = '.factory/docs-gardener.blueprint.json';
write(BLUEPRINT_PATH, JSON.stringify(t.blueprint, null, 2) + '\n');
write('.factory/config.yml', serializeConfig(defaultConfig()));

const res = compile(t.blueprint, { blueprintPath: BLUEPRINT_PATH });
const errors = res.workflows.flatMap((w) => w.diagnostics).filter((d) => d.level === 'error');
if (errors.length) {
  console.error('REFUSING to write: compile errors', errors);
  process.exit(1);
}
for (const wf of res.workflows) write(`.github/workflows/${wf.filename}`, wf.yaml);
console.log('done —', res.workflows.map((w) => w.filename).join(', '));
