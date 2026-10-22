// Write the generated reference docs (UPS-DOC-05): today `docs/reference/machines.md`, rendered
// from the machine registry by the pure `renderMachineReference` (app/src/machines/reference.ts).
// `npm test` also fails when the committed file is stale (reference.test.ts), so CI catches a
// registry change that forgot to regenerate.
//
//   cd app && npm run reference          # regenerate
//   cd app && npm run reference:check    # exit 1 when the committed file is stale

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MACHINES } from '../src/machines/registry';
import { MACHINE_REFERENCE_PATH, renderMachineReference } from '../src/machines/reference';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHECK = process.argv.includes('--check');

const target = join(ROOT, MACHINE_REFERENCE_PATH);
const fresh = renderMachineReference(MACHINES);
const current = existsSync(target) ? readFileSync(target, 'utf8') : null;

if (CHECK) {
  if (current !== fresh) {
    console.error(`${MACHINE_REFERENCE_PATH} is stale: run \`cd app && npm run reference\``);
    process.exit(1);
  }
  console.log(`${MACHINE_REFERENCE_PATH} is up to date`);
} else if (current !== fresh) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, fresh);
  console.log(`wrote ${MACHINE_REFERENCE_PATH}`);
} else {
  console.log(`${MACHINE_REFERENCE_PATH} unchanged`);
}
