// Pure deploy-plan builder + drift detector (seed 03).
// NO network I/O: this consumes already-fetched repo state and produces a plan that
// the transport client executes. Keeping it pure keeps it deterministic and trivially
// testable — same rules as the compiler (CLAUDE.md golden rule #3).
//
// The plan is a diff: freshly compiled output vs. what is currently in the target repo.
// - blueprint + workflow writes are skipped when the content is byte-identical (no-op).
// - stale `factory--*.yml` files (assembly lines that no longer exist) are deleted;
//   non-factory workflows are NEVER touched.
// - referenced prompt files that are missing become warnings (no prompt editor yet).

import type { Blueprint } from '../blueprint/types';
import { blueprintHash } from '../blueprint/types';
import { compile } from '../compiler/compile';
import type { RepoFile, DeployPlan, DeployWrite, DeployDelete, DriftItem } from './types';

/** Canonical location of the blueprint in the target repo. */
export const BLUEPRINT_PATH = '.factory/blueprint.json';
/** Directory that generated workflow files live in. */
export const WORKFLOW_DIR = '.github/workflows';

/** Matches a GitFactory-generated workflow basename (`.yml` or `.yaml`). */
const FACTORY_WORKFLOW = /^factory--.*\.ya?ml$/;

/**
 * Already-fetched repo state the planner diffs against. All fields reflect the repo as
 * read now; the planner performs no I/O of its own.
 */
export interface RepoState {
  /** Current `.factory/blueprint.json`, or null if the repo has none yet. */
  blueprintFile: RepoFile | null;
  /** Current `.github/workflows/*.yml` files (all of them, factory and not). */
  workflowFiles: RepoFile[];
  /** Paths present under `.factory/prompts/` (used to warn on missing prompt refs). */
  promptPaths: string[];
}

/** Pretty-printed blueprint JSON — the exact bytes written to `.factory/blueprint.json`. */
function serializeBlueprint(bp: Blueprint): string {
  return JSON.stringify(bp, null, 2);
}

/** Last path segment (basename) of a repo path. */
function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * Diff the compiled output of `blueprint` against `repo` to produce the set of writes,
 * deletes, and warnings a deploy will make. Pure and deterministic.
 */
export function buildDeployPlan(blueprint: Blueprint, repo: RepoState): DeployPlan {
  const { workflows } = compile(blueprint);

  const writes: DeployWrite[] = [];
  const deletes: DeployDelete[] = [];
  const warnings: string[] = [];

  // ── blueprint file ─────────────────────────────────────────────────────
  const blueprintJson = serializeBlueprint(blueprint);
  const existingBlueprint = repo.blueprintFile;
  if (!existingBlueprint || existingBlueprint.content !== blueprintJson) {
    const write: DeployWrite = { path: BLUEPRINT_PATH, content: blueprintJson, reason: 'blueprint' };
    if (existingBlueprint) write.sha = existingBlueprint.sha;
    writes.push(write);
  }

  // ── workflow files ─────────────────────────────────────────────────────
  const existingByPath = new Map(repo.workflowFiles.map((f) => [f.path, f]));
  const compiledFilenames = new Set(workflows.map((w) => w.filename));

  for (const wf of workflows) {
    const path = `${WORKFLOW_DIR}/${wf.filename}`;
    const existing = existingByPath.get(path);
    if (existing && existing.content === wf.yaml) continue; // no-op
    const write: DeployWrite = { path, content: wf.yaml, reason: 'workflow' };
    if (existing) write.sha = existing.sha;
    writes.push(write);
  }

  // ── prompt refs (warn-only; no prompt editor yet) ──────────────────────
  const promptPaths = new Set(repo.promptPaths);
  for (const node of blueprint.nodes) {
    if (node.type !== 'agent.claude') continue;
    const ref = node.config.promptRef;
    if (typeof ref !== 'string') continue;
    if (!promptPaths.has(ref)) {
      warnings.push(`Prompt not found in repo: ${ref} (add it before the factory can run)`);
    }
  }

  // ── stale factory workflows → deletes (never touch non-factory files) ──
  for (const file of repo.workflowFiles) {
    const name = basename(file.path);
    if (!FACTORY_WORKFLOW.test(name)) continue;
    if (compiledFilenames.has(name)) continue;
    deletes.push({ path: file.path, sha: file.sha, reason: 'stale-workflow' });
  }

  return { writes, deletes, warnings };
}

/** Parse the blueprint hash stamped into a generated workflow header, or null. */
function parseHeaderHash(yaml: string): string | null {
  const m = /hash:\s*([0-9a-f]{8})/.exec(yaml);
  return m ? m[1] : null;
}

/**
 * Compare the blueprint hash embedded in each deployed `factory--*.yml` header against
 * the current blueprint's hash. A missing/garbled header counts as drifted. Only factory
 * workflow files are inspected; one {@link DriftItem} is returned per such file.
 */
export function detectDrift(workflowFiles: RepoFile[], blueprint: Blueprint): DriftItem[] {
  const compiledHash = blueprintHash(blueprint);
  const items: DriftItem[] = [];
  for (const file of workflowFiles) {
    if (!FACTORY_WORKFLOW.test(basename(file.path))) continue;
    const deployedHash = parseHeaderHash(file.content);
    items.push({
      path: file.path,
      deployedHash,
      compiledHash,
      drifted: deployedHash !== compiledHash,
    });
  }
  return items;
}
