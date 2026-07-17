// Observe-mode I/O: fetch a repo's .github/workflows/*.yml and reverse-import them into a
// read-only Fleet. Pairs with the pure parsers in parse.ts/facts.ts. Never writes to the repo.

import type { GithubClient, RepoRef } from '../github/types';
import { extractFacts } from './facts';
import { buildFleet, parseWorkflow } from './parse';
import type { Fleet, ImportedWorkflow, WorkflowFacts } from './types';

const WORKFLOW_DIR = '.github/workflows';

/** Fetch each workflow file once; returns `{path, text}` pairs (missing files skipped). */
async function fetchWorkflowTexts(
  client: GithubClient,
  repo: RepoRef,
): Promise<{ path: string; text: string }[]> {
  const entries = await client.listDir(repo, WORKFLOW_DIR);
  const files = entries.filter((e) => e.type === 'file' && /\.ya?ml$/.test(e.name));
  const fetched = await Promise.all(
    files.map(async (e) => {
      const file = await client.getFile(repo, e.path);
      return file ? { path: e.path, text: file.content } : null;
    }),
  );
  return fetched.filter((f): f is { path: string; text: string } => f !== null);
}

export async function importFleet(client: GithubClient, repo: RepoRef): Promise<Fleet> {
  const texts = await fetchWorkflowTexts(client, repo);
  const parsed: ImportedWorkflow[] = texts.map((f) => parseWorkflow(f.path, f.text));
  const fleet = buildFleet(repo, parsed);
  if (texts.length === 0) {
    fleet.warnings.push('No workflows found under .github/workflows/ — nothing to observe.');
  }
  return fleet;
}

/**
 * Fleet Ops import: one fetch pass, both parsers — the observe graph (Fleet) plus the
 * deep per-workflow facts the audit/metrics engines consume. Each file is read once.
 */
export async function importFleetDeep(
  client: GithubClient,
  repo: RepoRef,
): Promise<{ fleet: Fleet; facts: WorkflowFacts[] }> {
  const texts = await fetchWorkflowTexts(client, repo);
  const parsed: ImportedWorkflow[] = texts.map((f) => parseWorkflow(f.path, f.text));
  const fleet = buildFleet(repo, parsed);
  if (texts.length === 0) {
    fleet.warnings.push('No workflows found under .github/workflows/ — nothing to observe.');
  }
  return { fleet, facts: texts.map((f) => extractFacts(f.path, f.text)) };
}
