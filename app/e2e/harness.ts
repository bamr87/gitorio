// End-to-end validation harness for GitFactory.
//
// Drives the FULL pipeline against a live repo (gitorio = the arena) by reusing the real
// app modules — so it validates the actual code, not a reimplementation. It emulates the
// lifehacker.dev architecture: observe the reference fleet, compile a lifehacker-style
// factory, plan the deploy, and (with --apply) provision Claude power + open a deploy PR.
//
// Run:   cd app && npm run e2e            # DRY: read-only + compile + plan, no writes
//        cd app && npm run e2e -- --apply  # LIVE: provision secret + open deploy PR
//
// Credentials come from app/.env (VITE_GH_PAT / VITE_GH_REPO / VITE_CLAUDE_CODE_OAUTH_TOKEN).
// Secret VALUES are NEVER printed.

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { connectWithPat } from '../src/github/client';
import { parseRepo, repoSlug, type RepoRef } from '../src/github/types';
import { assemblyLines, compile } from '../src/compiler/compile';
import { BLUEPRINT_PATH, buildDeployPlan, detectDrift } from '../src/github/deploy';
import { executePlan, gatherRepoState } from '../src/github/execute';
import { sealSecret } from '../src/github/crypto';
import { importFleet } from '../src/fleet/import';
import type { Blueprint } from '../src/blueprint/types';

const APPLY = process.argv.includes('--apply');
const OAUTH_SECRET = 'CLAUDE_CODE_OAUTH_TOKEN';
const REFERENCE: RepoRef = { owner: 'bamr87', repo: 'lifehacker.dev' };

type Env = Record<string, string | undefined>;
const IM: Env = (import.meta as unknown as { env?: Env }).env ?? {};
const env = (k: string): string | undefined => IM[k] ?? process.env[k];

const pat = env('VITE_GH_PAT') ?? env('GH_PAT');
const repoInput = env('VITE_GH_REPO') ?? env('GH_REPO') ?? 'bamr87/gitorio';
const oauthToken = env('VITE_CLAUDE_CODE_OAUTH_TOKEN') ?? env('CLAUDE_CODE_OAUTH_TOKEN');

function h(title: string): void {
  console.log('\n' + '━'.repeat(64) + '\n▶ ' + title + '\n' + '━'.repeat(64));
}
const ok = (b: boolean) => (b ? '✓' : '✗');

async function main(): Promise<void> {
  console.log(`\nGitFactory E2E harness — mode: ${APPLY ? 'APPLY (live writes)' : 'DRY (read-only)'}`);
  if (!pat) throw new Error('No PAT. Set VITE_GH_PAT in app/.env (see .env.example).');
  const repo = parseRepo(repoInput);
  if (!repo) throw new Error(`Bad repo "${repoInput}" — expected owner/name.`);

  // ── 1. Connect ─────────────────────────────────────────────────────────
  h('1 · Connect (read-only)');
  const client = await connectWithPat(pat);
  console.log('  authenticated as:', client.login);

  // ── 2. Preflight ───────────────────────────────────────────────────────
  h(`2 · Preflight ${repoSlug(repo)}`);
  const pf = await client.preflight(repo);
  (['contents', 'workflows', 'issues', 'pullRequests', 'actions', 'secrets'] as const).forEach((k) =>
    console.log(`  ${ok(pf[k] === 'ok')} ${k.padEnd(14)} ${pf[k]}`),
  );
  console.log('  canDeploy:', pf.canDeploy);

  // ── 3. Observe the reference architecture ──────────────────────────────
  h('3 · Observe reference fleet (lifehacker.dev)');
  try {
    const lh = await importFleet(client, REFERENCE);
    console.log(
      `  ${lh.workflows.length} workflows · ${lh.workflows.filter((w) => w.hasAgent).length} agents · ${lh.externalRepos.length} cross-repo targets`,
    );
    console.log('  workflow_run chains:', lh.edges.filter((e) => e.kind === 'workflow_run').length);
    console.log('  cross-repo emitters:', lh.edges.filter((e) => e.kind === 'cross_repo').map((e) => e.to.replace('ext:', '')).join(', ') || '(none)');
  } catch (e) {
    console.log('  (skipped:', (e as Error).message, ')');
  }

  // ── 4. Observe the arena ───────────────────────────────────────────────
  h(`4 · Observe arena fleet (${repoSlug(repo)})`);
  const arena = await importFleet(client, repo);
  console.log(`  ${arena.workflows.length} workflows:`, arena.workflows.map((w) => w.slug).join(', ') || '(none)');
  console.log('  factory-- workflows present:', arena.workflows.filter((w) => w.slug.startsWith('factory--')).map((w) => w.slug).join(', ') || '(none yet)');

  // ── 5. Design → Compile ────────────────────────────────────────────────
  h('5 · Design → Compile (lifehacker-style factory)');
  const bp = JSON.parse(readFileSync(new URL('../../.factory/blueprint.json', import.meta.url), 'utf8')) as Blueprint;
  console.log('  blueprint:', bp.meta.name, `· ${bp.nodes.length} machines · ${bp.edges.length} belts`);
  const compiled = compile(bp);
  console.log('  assembly lines:', assemblyLines(bp).map((l) => l.filename).join(', '));
  const errors = compiled.workflows.flatMap((w) => w.diagnostics).filter((d) => d.level === 'error').concat(compiled.diagnostics.filter((d) => d.level === 'error'));
  console.log('  compile errors:', errors.length, errors.map((d) => d.message).join('; '));
  for (const wf of compiled.workflows) {
    // Inspect the parsed `on:` block (not the whole YAML) so `issues:` in the permissions
    // block isn't mistaken for an issue trigger. `on` can round-trip as the boolean key.
    const doc = parseYaml(wf.yaml) as { on?: Record<string, unknown>; true?: Record<string, unknown> };
    const onBlock = doc?.on ?? doc?.true ?? {};
    const onKeys = typeof onBlock === 'object' ? Object.keys(onBlock) : [];
    const loopyTrigger = onKeys.some((k) => ['issues', 'issue_comment', 'pull_request'].includes(k));
    const oauthAuth = wf.yaml.includes('CLAUDE_CODE_OAUTH_TOKEN');
    const guarded = wf.yaml.includes("github.event.sender.type != 'Bot'");
    console.log(`  ${wf.filename}  (on: ${onKeys.join(', ')})`);
    console.log(
      `      ${ok(oauthAuth)} OAuth-primary   ${ok(!loopyTrigger || guarded)} loop-guard${loopyTrigger ? '' : ' (n/a)'}   ${ok(wf.yaml.includes('permissions:'))} least-privilege perms`,
    );
  }

  // ── 6. Deploy plan (dry) ───────────────────────────────────────────────
  h('6 · Deploy plan (DRY — no writes)');
  const state = await gatherRepoState(client, repo);
  console.log('  current in repo:', state.blueprintFile ? BLUEPRINT_PATH : '(no blueprint)', `+ ${state.workflowFiles.length} factory workflow(s)`);
  const p = buildDeployPlan(bp, state);
  if (p.writes.length + p.deletes.length === 0) console.log('  (repo already matches the blueprint)');
  for (const w of p.writes) console.log(`  + ${w.sha ? 'update' : 'create'}  ${w.path}  [${w.reason}]`);
  for (const d of p.deletes) console.log(`  - delete  ${d.path}`);
  for (const warn of p.warnings) console.log(`  ! ${warn}`);
  const drift = detectDrift(state.workflowFiles, bp).filter((d) => d.drifted);
  console.log('  drift (hand-edited deployed workflows):', drift.length);

  if (!APPLY) {
    h('DRY RUN COMPLETE — no changes made');
    console.log(`  Next: rotate the exposed token, then \`npm run e2e -- --apply\` to provision`);
    console.log(`  ${OAUTH_SECRET} and open a deploy PR on ${repoSlug(repo)}.`);
    return;
  }

  // ── 7. Provision power ─────────────────────────────────────────────────
  h(`7 · Provision power (${OAUTH_SECRET})  [--apply]`);
  if (!oauthToken) throw new Error('No OAuth token to provision. Set VITE_CLAUDE_CODE_OAUTH_TOKEN in app/.env.');
  const pk = await client.getActionsPublicKey(repo);
  await client.putSecret(repo, OAUTH_SECRET, sealSecret(pk.key, oauthToken), pk.keyId);
  console.log(`  ✓ provisioned ${OAUTH_SECRET} via sealed box (value never printed)`);

  // ── 8. Deploy as PR ────────────────────────────────────────────────────
  h('8 · Deploy as PR  [--apply]');
  const outcome = await executePlan(client, repo, p, { mode: 'pr', meta: bp.meta });
  console.log(`  ✓ ${outcome.mode} · ${outcome.changes} change(s)`);
  if (outcome.prUrl) console.log('  PR:', outcome.prUrl);
  console.log('  Review + merge the PR to put the factory on the default branch (then triggers fire).');
  console.log('  Then: open an issue on the repo and re-run in DRY mode to watch runs light up.');
}

main().catch((e) => {
  console.error('\n✗ harness failed:', (e as Error).message);
  process.exit(1);
});

export {};
