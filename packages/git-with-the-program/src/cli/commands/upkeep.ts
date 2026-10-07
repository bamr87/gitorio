// Implements: docs/spec/06-upkeep.md §3 (the loop: plan → fill → check → apply → report) as the
// `gwtp upkeep` command surface, against schemas/upkeep-config.schema.json and
// schemas/upkeep-plan.schema.json.
//
//   gwtp upkeep plan    observe tree, history and forge; write the plan; print the report
//   gwtp upkeep fill    fill content slots with a model, or mark them as using fallbacks
//   gwtp upkeep check   validate a plan (schema + per-kind content contracts) — what an agent
//                       runs after editing the plan file
//   gwtp upkeep apply   execute the plan's forge-side actions (needs --yes, or --scheduled with
//                       `mode: apply` in the config)
//   gwtp upkeep report  render a plan (and optional outcomes) as markdown
//   gwtp upkeep run     all of the above, in one on-demand pass
//
// ajv, YAML, the filesystem, the GitHub adapter and the Anthropic adapter all meet HERE, the same
// way they meet in validate.ts: src/upkeep stays I/O-light and forge-neutral, and this file is
// the composition root. Nothing here writes `.program/` (INV-001) or the working tree beyond the
// plan/outcome files under `.gwtp/upkeep/` (gitignored).
//
// Exit codes follow the repository's convention: 0 = done, 1 = the check found a problem or an
// action failed/was blocked, 2 = could not run (bad flags, unreadable config, invalid plan).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { Ajv, type AnySchemaObject, type ValidateFunction } from 'ajv';
import * as ajvFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

import { anthropicModelClient } from '../../adapters/anthropic/client.js';
import { engineLabels, openGitHubRepoHost, resolveRepository } from '../../adapters/github/repo-host.js';
import { repoSlug } from '../../adapters/github/issues.js';
import { createGitExec } from '../../ledger/git.js';
import {
  type ActionOutcome,
  applyExitCode,
  applyPlan,
  checkPlanContent,
  DEFAULT_CONFIG_PATH,
  fillWithModel,
  fillWithTemplates,
  gatherLocalFacts,
  type HostFacts,
  inTreeFindings,
  outsideAuthoredSurface,
  planUpkeep,
  type RepoHostPort,
  renderReport,
  resolveConfig,
  UPKEEP_CONFIG_SCHEMA_ID,
  UPKEEP_PLAN_SCHEMA_ID,
  type UpkeepConfig,
  type UpkeepPlan,
} from '../../upkeep/index.js';
import { findSchemaDir } from './validate.js';

const addFormats = ajvFormats.default.default;

/** The model the content provider uses when neither the config nor --model names one. */
export const DEFAULT_UPKEEP_MODEL = 'claude-opus-5-5';

export const DEFAULT_PLAN_PATH = '.gwtp/upkeep/plan.json';
export const DEFAULT_OUTCOMES_PATH = '.gwtp/upkeep/outcomes.json';

const OPTIONS = {
  root: { type: 'string' },
  config: { type: 'string' },
  plan: { type: 'string' },
  out: { type: 'string' },
  outcomes: { type: 'string' },
  against: { type: 'string' },
  repo: { type: 'string' },
  offline: { type: 'boolean' },
  provider: { type: 'string' },
  model: { type: 'string' },
  yes: { type: 'boolean' },
  scheduled: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'in-tree': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

type Flags = {
  root?: string | undefined;
  config?: string | undefined;
  plan?: string | undefined;
  out?: string | undefined;
  outcomes?: string | undefined;
  against?: string | undefined;
  repo?: string | undefined;
  offline?: boolean | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  yes?: boolean | undefined;
  scheduled?: boolean | undefined;
  'dry-run'?: boolean | undefined;
  'in-tree'?: boolean | undefined;
  help?: boolean | undefined;
};

export function usage(): string {
  return [
    'gwtp upkeep — keep the repository\'s forge-side presentation from drifting (spec 06)',
    '',
    'Usage:',
    '  gwtp upkeep plan   [--root DIR] [--config FILE] [--repo OWNER/NAME] [--offline] [--out FILE]',
    '  gwtp upkeep fill   [--plan FILE] [--provider model|template|none] [--model ID]',
    '  gwtp upkeep check  [--plan FILE] [--against ENGINE_PLAN]',
    '  gwtp upkeep apply  [--plan FILE] [--yes | --scheduled] [--dry-run] [--outcomes FILE]',
    '  gwtp upkeep report [--plan FILE] [--outcomes FILE] [--in-tree]',
    '  gwtp upkeep run    [plan flags] [--provider ...] [--yes | --scheduled]',
    '',
    `Defaults: --config ${DEFAULT_CONFIG_PATH}, --plan/--out ${DEFAULT_PLAN_PATH}, --outcomes ${DEFAULT_OUTCOMES_PATH}.`,
    '',
    'Content providers: `model` calls the Anthropic API (needs ANTHROPIC_API_KEY or an `ant auth`',
    'profile); `template` uses the deterministic fallbacks; `none` leaves slots `requested` for an',
    'AI agent to fill by editing the plan file, then `gwtp upkeep check` validates its work.',
    '`check --against` also proves the agent changed nothing but content slots\' status/value/',
    'provider/note, comparing with the plan as the engine wrote it.',
    '',
    'apply changes the FORGE only (tags, releases, labels, description, topics) and only with',
    '--yes, or --scheduled when the config says `mode: apply`. It never commits to the tree:',
    'in-tree drift is reported for a reviewed PR (see `report --in-tree`).',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export interface UpkeepSchemas {
  readonly config: ValidateFunction;
  readonly plan: ValidateFunction;
}

export function loadUpkeepSchemas(schemaDir: string): UpkeepSchemas {
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true, validateFormats: true });
  addFormats(ajv);
  for (const name of ['upkeep-config', 'upkeep-plan']) {
    ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8')) as AnySchemaObject);
  }
  return {
    config: ajv.getSchema(UPKEEP_CONFIG_SCHEMA_ID) as ValidateFunction,
    plan: ajv.getSchema(UPKEEP_PLAN_SCHEMA_ID) as ValidateFunction,
  };
}

function ajvErrors(v: ValidateFunction): readonly string[] {
  return (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
}

function schemas(): UpkeepSchemas {
  const dir = findSchemaDir();
  if (dir === null) throw new UsageError('cannot locate schemas/ (looked upward from the CLI and the working directory)');
  return loadUpkeepSchemas(dir);
}

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Config and plan files
// ---------------------------------------------------------------------------

export function loadConfig(root: string, path: string | undefined, s: UpkeepSchemas): UpkeepConfig {
  const file = resolve(root, path ?? DEFAULT_CONFIG_PATH);
  if (!existsSync(file)) {
    if (path !== undefined) throw new UsageError(`config not found: ${file}`);
    const resolved = resolveConfig(undefined);
    if (!resolved.ok) throw new UsageError(resolved.error.join('\n'));
    return resolved.value;
  }
  const raw = parseYaml(readFileSync(file, 'utf8')) as unknown;
  if (!s.config(raw)) throw new UsageError(`${file} does not match ${UPKEEP_CONFIG_SCHEMA_ID}:\n  ${ajvErrors(s.config).join('\n  ')}`);
  const resolved = resolveConfig(raw);
  if (!resolved.ok) throw new UsageError(`${file}:\n  ${resolved.error.join('\n  ')}`);
  return resolved.value;
}

export function readPlan(file: string, s: UpkeepSchemas): UpkeepPlan {
  if (!existsSync(file)) throw new UsageError(`plan not found: ${file} (run \`gwtp upkeep plan\` first)`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(`${file} is not JSON: ${(e as Error).message}`);
  }
  if (!s.plan(raw)) throw new UsageError(`${file} does not match ${UPKEEP_PLAN_SCHEMA_ID}:\n  ${ajvErrors(s.plan).join('\n  ')}`);
  return raw as UpkeepPlan;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writePlan(file: string, plan: UpkeepPlan, s: UpkeepSchemas): void {
  // A plan the engine itself wrote must satisfy the contract it hands an agent; if it does not,
  // that is an engine defect and the run stops rather than shipping a malformed work order.
  if (!s.plan(plan)) {
    throw new Error(`internal: generated plan violates ${UPKEEP_PLAN_SCHEMA_ID}:\n  ${ajvErrors(s.plan).join('\n  ')}`);
  }
  writeJson(file, plan);
}

// ---------------------------------------------------------------------------
// The forge
// ---------------------------------------------------------------------------

async function originUrl(root: string): Promise<string | null> {
  const r = await createGitExec({ cwd: root })(['remote', 'get-url', 'origin'], { allowFailure: true });
  return r.code === 0 ? r.stdout.trim() : null;
}

export interface OpenedHost {
  readonly repository: string | null;
  readonly port: RepoHostPort | null;
  readonly error?: string;
}

async function openHost(root: string, explicit: string | undefined, offline: boolean): Promise<OpenedHost> {
  const repo = resolveRepository({
    explicit,
    env: process.env['GITHUB_REPOSITORY'],
    remoteUrl: await originUrl(root),
  });
  const repository = repo === null ? null : repoSlug(repo);
  if (offline) return { repository, port: null, error: 'offline' };
  if (repo === null) return { repository, port: null, error: 'no owner/name: set --repo, `repository:` in the config, or an origin remote on github.com' };
  const opened = await openGitHubRepoHost({ repo });
  if (!opened.ok) return { repository, port: null, error: opened.error.message };
  return { repository, port: opened.value };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepPlan(flags: Flags, s: UpkeepSchemas): Promise<{ plan: UpkeepPlan; config: UpkeepConfig; file: string }> {
  const root = resolve(flags.root ?? '.');
  const config = loadConfig(root, flags.config, s);
  const opened = await openHost(root, flags.repo ?? config.repository, flags.offline === true);
  let host: HostFacts | null = null;
  let hostError = opened.error;
  if (opened.port !== null) {
    try {
      host = await opened.port.read();
    } catch (e) {
      hostError = (e as Error).message;
    }
  }
  const local = await gatherLocalFacts({ root, git: createGitExec({ cwd: root }), config });
  const plan = planUpkeep({
    config,
    local,
    host,
    ...(host === null && hostError !== undefined ? { hostError } : {}),
    codeLabels: engineLabels(),
    repository: opened.repository,
    now: new Date(),
  });
  const file = resolve(root, flags.out ?? flags.plan ?? DEFAULT_PLAN_PATH);
  writePlan(file, plan, s);
  return { plan, config, file };
}

async function stepFill(plan: UpkeepPlan, provider: string, model: string): Promise<UpkeepPlan> {
  switch (provider) {
    case 'none':
      return plan;
    case 'template':
      return fillWithTemplates(plan);
    case 'model':
      return fillWithTemplates(await fillWithModel(plan, anthropicModelClient({ model })));
    default:
      throw new UsageError(`unknown --provider ${JSON.stringify(provider)} (model | template | none)`);
  }
}

/** `auto`: the model when Anthropic credentials are visible in the environment, else templates. */
function autoProvider(flag: string | undefined): string {
  if (flag !== undefined && flag !== 'auto') return flag;
  const env = process.env;
  return env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_AUTH_TOKEN'] || env['ANTHROPIC_PROFILE'] ? 'model' : 'template';
}

function shouldApply(flags: Flags, mode: UpkeepPlan['mode']): boolean {
  if (flags['dry-run'] === true) return false;
  if (flags.yes === true) return true;
  return flags.scheduled === true && mode === 'apply';
}

async function stepApply(plan: UpkeepPlan, flags: Flags, root: string): Promise<readonly ActionOutcome[]> {
  const live = shouldApply(flags, plan.mode);
  if (!live || plan.actions.length === 0) return applyPlan(plan, null, { dryRun: true });
  const opened = await openHost(root, flags.repo ?? plan.repository ?? undefined, false);
  if (opened.port === null) {
    process.stderr.write(`gwtp upkeep: cannot reach the forge: ${opened.error ?? 'unknown'}\n`);
  }
  return applyPlan(plan, opened.port, { dryRun: false });
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function run(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === '--help' || sub === '-h') {
    process.stdout.write(usage());
    return sub === undefined ? 2 : 0;
  }

  let flags: Flags;
  try {
    ({ values: flags } = parseArgs({ args: [...rest], options: OPTIONS, allowPositionals: false, strict: true }));
  } catch (e) {
    process.stderr.write(`gwtp upkeep: ${(e as Error).message}\n\n${usage()}`);
    return 2;
  }
  if (flags.help === true) {
    process.stdout.write(usage());
    return 0;
  }

  const root = resolve(flags.root ?? '.');
  const planFile = resolve(root, flags.plan ?? DEFAULT_PLAN_PATH);
  const outcomesFile = resolve(root, flags.outcomes ?? DEFAULT_OUTCOMES_PATH);

  try {
    const s = schemas();
    switch (sub) {
      case 'plan': {
        const { plan, file } = await stepPlan(flags, s);
        process.stdout.write(renderReport(plan));
        process.stderr.write(`gwtp upkeep: plan written to ${file}\n`);
        return 0;
      }

      case 'fill': {
        const plan = readPlan(planFile, s);
        const config = loadConfig(root, flags.config, s);
        const filled = await stepFill(plan, autoProvider(flags.provider), flags.model ?? config.ai.model ?? DEFAULT_UPKEEP_MODEL);
        writePlan(planFile, filled, s);
        const n = filled.content.filter((c) => c.status === 'filled').length;
        process.stdout.write(`gwtp upkeep: ${n}/${filled.content.length} content slot(s) filled; plan updated at ${planFile}\n`);
        return 0;
      }

      case 'check': {
        const plan = readPlan(planFile, s);
        const problems = [...checkPlanContent(plan)];
        if (flags.against !== undefined) {
          const engine = readPlan(resolve(root, flags.against), s);
          problems.push(...outsideAuthoredSurface(engine, plan).map((p) => `TAMPERED: ${p}`));
        }
        if (problems.length > 0) {
          process.stdout.write(`FAIL ${planFile}\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
          return 1;
        }
        process.stdout.write(`PASS ${planFile} — ${plan.findings.length} finding(s), ${plan.actions.length} action(s), ${plan.content.length} content slot(s)\n`);
        return 0;
      }

      case 'apply': {
        const plan = readPlan(planFile, s);
        const problems = checkPlanContent(plan);
        if (problems.length > 0) {
          // Not fatal: a bad slot degrades to its fallback inside apply. Said aloud so nobody
          // mistakes a fallback for the agent's text.
          process.stderr.write(`gwtp upkeep: content problems (an invalid slot falls back; a miscited docs finding is dropped):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
        }
        const outcomes = await stepApply(plan, flags, root);
        writeJson(outcomesFile, outcomes);
        process.stdout.write(renderReport(plan, outcomes));
        if (!shouldApply(flags, plan.mode) && plan.actions.length > 0) {
          process.stderr.write('gwtp upkeep: dry run — pass --yes (or --scheduled with `mode: apply`) to apply\n');
        }
        return applyExitCode(outcomes);
      }

      case 'report': {
        const plan = readPlan(planFile, s);
        if (flags['in-tree'] === true) {
          const items = inTreeFindings(plan);
          process.stdout.write(
            items.length === 0
              ? 'No in-tree drift.\n'
              : `${items.map((f) => `- ${f.summary}${f.citation !== undefined ? ` (${f.citation.path}:${f.citation.line})` : ''}${f.remedy !== undefined ? `\n  - ${f.remedy}` : ''}`).join('\n')}\n`,
          );
          return 0;
        }
        const outcomes = existsSync(outcomesFile) && flags.outcomes !== undefined
          ? (JSON.parse(readFileSync(outcomesFile, 'utf8')) as ActionOutcome[])
          : undefined;
        process.stdout.write(renderReport(plan, outcomes));
        return 0;
      }

      case 'run': {
        const { plan, config, file } = await stepPlan(flags, s);
        const filled = await stepFill(plan, autoProvider(flags.provider), flags.model ?? config.ai.model ?? DEFAULT_UPKEEP_MODEL);
        writePlan(file, filled, s);
        const outcomes = await stepApply(filled, flags, root);
        writeJson(outcomesFile, outcomes);
        process.stdout.write(renderReport(filled, outcomes));
        return applyExitCode(outcomes);
      }

      default:
        process.stderr.write(`gwtp upkeep: unknown subcommand \`${sub}\`\n\n${usage()}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`gwtp upkeep: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}
