// Generic CLI: compile ANY blueprint JSON file to workflow YAML files — the headless
// counterpart of the app's Deploy button, for driving a target repo's factory from a shell.
// Refuses to write anything if the blueprint has error-level diagnostics (golden rule #2:
// generated files come from the compiler, never from hand edits).
//   Usage: npx vite-node scripts/compile-blueprint.ts <blueprint.json> <outDir> [blueprintPathInRepo]
//   e.g.:  npx vite-node scripts/compile-blueprint.ts \
//            ../lifehacker.dev/.factory/issue-factory.blueprint.json \
//            ../lifehacker.dev/.github/workflows .factory/issue-factory.blueprint.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../src/compiler/compile';

const [bpFile, outDir, bpPathInRepo] = process.argv.slice(2);
if (!bpFile || !outDir) {
  console.error('usage: compile-blueprint.ts <blueprint.json> <outDir> [blueprintPathInRepo]');
  process.exit(1);
}

const bp = JSON.parse(readFileSync(bpFile, 'utf8'));
const res = compile(bp, { blueprintPath: bpPathInRepo ?? '.factory/blueprint.json' });
const errors = [
  ...res.diagnostics.filter((d) => d.level === 'error'),
  ...res.workflows.flatMap((w) => w.diagnostics).filter((d) => d.level === 'error'),
];
if (errors.length) {
  console.error('REFUSING to write: compile errors', errors);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
for (const wf of res.workflows) {
  writeFileSync(join(outDir, wf.filename), wf.yaml);
  console.log('wrote', join(outDir, wf.filename));
}
