// Observe-mode I/O: fetch a repo's .github/workflows/*.yml and reverse-import them into a
// read-only Fleet. Pairs with the pure parser in parse.ts. Never writes to the repo.

import type { GithubClient, RepoRef } from '../github/types';
import { buildFleet, parseWorkflow } from './parse';
import type { Fleet, ImportedWorkflow } from './types';

const WORKFLOW_DIR = '.github/workflows';

export async function importFleet(client: GithubClient, repo: RepoRef): Promise<Fleet> {
  const entries = await client.listDir(repo, WORKFLOW_DIR);
  const files = entries.filter((e) => e.type === 'file' && /\.ya?ml$/.test(e.name));

  const fetched = await Promise.all(
    files.map(async (e) => {
      const file = await client.getFile(repo, e.path);
      return file ? { path: e.path, text: file.content } : null;
    }),
  );

  const parsed: ImportedWorkflow[] = [];
  for (const f of fetched) {
    if (f) parsed.push(parseWorkflow(f.path, f.text));
  }

  const fleet = buildFleet(repo, parsed);
  if (files.length === 0) {
    fleet.warnings.push('No workflows found under .github/workflows/ — nothing to observe.');
  }
  return fleet;
}
