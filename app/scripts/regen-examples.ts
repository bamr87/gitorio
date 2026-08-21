// Committed regen script (run with vite-node) for the reference compiler outputs — the
// golden anchors in examples/compiled/. Each examples/*.blueprint.json is compiled with the
// SAME compile() the app uses, so the committed outputs can never drift from the compiler.
// The regenerated files are canonical: examples/compiled/ is fully owned by this script
// (hand-edits and stale files are overwritten/removed — golden rule #2).
// Re-run after compiler changes: `cd app && npx vite-node scripts/regen-examples.ts`
// Refuses to write anything when any example produces an error-level diagnostic.

import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Blueprint } from '../src/blueprint/types';
import { compile } from '../src/compiler/compile';

const ROOT = new URL('../../', import.meta.url); // repo root (app/scripts/ -> app/ -> root)
const EXAMPLES = new URL('examples/', ROOT);
const COMPILED = new URL('examples/compiled/', ROOT);

const sources = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith('.blueprint.json'))
  .sort(); // deterministic order
if (sources.length === 0) throw new Error('no examples/*.blueprint.json sources found');

// Compile everything first; refuse the whole regen on any error-level diagnostic.
const outputs: { filename: string; yaml: string; source: string }[] = [];
let errored = false;
for (const src of sources) {
  const bp = JSON.parse(readFileSync(new URL(src, EXAMPLES), 'utf8')) as Blueprint;
  const res = compile(bp, { blueprintPath: `examples/${src}` });
  const diags = [...res.diagnostics, ...res.workflows.flatMap((w) => w.diagnostics)];
  for (const d of diags) console.log(`${src}: [${d.level}] ${d.message}`);
  if (diags.some((d) => d.level === 'error')) {
    errored = true;
    continue;
  }
  for (const wf of res.workflows) outputs.push({ filename: wf.filename, yaml: wf.yaml, source: src });
}
if (errored) {
  console.error('REFUSING to write: error-level diagnostics above');
  process.exit(1);
}
const bySlug = new Map<string, string>();
for (const o of outputs) {
  const clash = bySlug.get(o.filename);
  if (clash) throw new Error(`filename collision: ${o.filename} from both ${clash} and ${o.source}`);
  bySlug.set(o.filename, o.source);
}

// Rewrite examples/compiled/ deterministically: drop stale files, write fresh output.
mkdirSync(COMPILED, { recursive: true });
for (const f of readdirSync(COMPILED)) {
  if (!bySlug.has(f)) {
    unlinkSync(new URL(f, COMPILED));
    console.log('removed stale', `examples/compiled/${f}`);
  }
}
for (const o of outputs) {
  writeFileSync(new URL(o.filename, COMPILED), o.yaml);
  console.log('wrote', `examples/compiled/${o.filename}`, `(from ${o.source})`);
}
console.log('done —', outputs.map((o) => o.filename).join(', '));
