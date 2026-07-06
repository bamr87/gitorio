// Reverse the compiled YAML back into structured "facts" for the UI's drill-downs. Parsing the
// REAL emitted workflow (rather than re-deriving from the blueprint) means the detail views can
// never drift from what actually ships: what you see is what the runner gets. PURE + total.

import { parse } from 'yaml';

export interface AgentFacts {
  stepName: string;
  model: string;
  maxTurns: number | null;
  /** Granted --allowedTools, split out (e.g. `Bash(gh issue comment:*)`, `Edit`). */
  tools: string[];
  promptRef: string | null;
  /** The numbered obligation contract appended to the agent's prompt. */
  obligations: string[];
}

export interface WorkflowFacts {
  name: string;
  /** Human-readable trigger summaries (schedule handled separately via `crons`). */
  events: string[];
  crons: string[];
  /** True when a plan-first manual trigger exposed an `apply` input. */
  planFirst: boolean;
  permissions: Record<string, string>;
  /** The `vars.*` name gating this line, if it sits behind an enablement gate. */
  killSwitchVar: string | null;
  rateLimitPerDay: number | null;
  agent: AgentFacts | null;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `[opened, labeled]` → "opened, labeled"; used to summarize an event's `types:`. */
function typesOf(v: unknown): string {
  const t = asArray(asRecord(v).types).filter((x): x is string => typeof x === 'string');
  return t.length ? ` [${t.join(', ')}]` : '';
}

function eventsFromOn(on: unknown): { events: string[]; crons: string[]; planFirst: boolean } {
  const o = asRecord(on);
  const events: string[] = [];
  const crons: string[] = [];
  let planFirst = false;

  for (const [key, val] of Object.entries(o)) {
    switch (key) {
      case 'schedule':
        for (const e of asArray(val)) {
          const c = str(asRecord(e).cron);
          if (c) crons.push(c);
        }
        break;
      case 'workflow_dispatch': {
        const hasApply = 'apply' in asRecord(asRecord(val).inputs);
        planFirst = hasApply;
        events.push(hasApply ? 'manual — plan-first (apply toggle)' : 'manual (workflow_dispatch)');
        break;
      }
      case 'workflow_run': {
        const wfs = asArray(asRecord(val).workflows).filter((x): x is string => typeof x === 'string');
        events.push(`after workflow: ${wfs.join(', ') || '?'} (completed)`);
        break;
      }
      case 'issues':
        events.push(`issues${typesOf(val)}`);
        break;
      case 'pull_request':
        events.push(`pull_request${typesOf(val)}`);
        break;
      case 'issue_comment':
        events.push('issue comment');
        break;
      default:
        events.push(key);
    }
  }
  return { events, crons, planFirst };
}

/** Pull `--model`, `--max-turns`, and `--allowedTools` out of a claude_args block. */
function parseClaudeArgs(args: string): { model: string; maxTurns: number | null; tools: string[] } {
  const model = /--model\s+(\S+)/.exec(args)?.[1] ?? '';
  const mt = /--max-turns\s+(\d+)/.exec(args)?.[1];
  const toolsRaw = /--allowedTools\s+"([^"]*)"/.exec(args)?.[1] ?? '';
  const tools = toolsRaw ? toolsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
  return { model, maxTurns: mt ? Number(mt) : null, tools };
}

/** Extract the numbered obligation lines from the agent prompt, and the referenced prompt file. */
function parsePrompt(prompt: string): { promptRef: string | null; obligations: string[] } {
  const promptRef = /(\.factory\/prompts\/[^\s`]+\.md)/.exec(prompt)?.[1] ?? null;
  const obligations: string[] = [];
  const idx = prompt.indexOf('OBLIGATIONS');
  if (idx >= 0) {
    for (const line of prompt.slice(idx).split('\n')) {
      const m = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (m) obligations.push(m[1].trim());
    }
  }
  return { promptRef, obligations };
}

const EMPTY: WorkflowFacts = {
  name: '',
  events: [],
  crons: [],
  planFirst: false,
  permissions: {},
  killSwitchVar: null,
  rateLimitPerDay: null,
  agent: null,
};

/** Parse one compiled `factory--*.yml` into structured facts. Never throws. */
export function describeWorkflow(yaml: string): WorkflowFacts {
  let doc: Record<string, unknown>;
  try {
    doc = asRecord(parse(yaml));
  } catch {
    return { ...EMPTY };
  }
  // `on:` may round-trip under the boolean-true key on a YAML-1.1 resolver.
  const on = doc.on ?? (doc as Record<string | number, unknown>)[true as unknown as string];
  const { events, crons, planFirst } = eventsFromOn(on);

  const jobs = asRecord(doc.jobs);
  const line = asRecord(jobs.line);
  const gate = asRecord(jobs.gate);

  const permissions: Record<string, string> = {};
  for (const [k, v] of Object.entries(asRecord(line.permissions))) permissions[k] = String(v);

  let killSwitchVar: string | null = null;
  const gateSteps = asArray(gate.steps);
  if (gateSteps.length) {
    const enabled = str(asRecord(asRecord(gateSteps[0]).env).ENABLED);
    killSwitchVar = /vars\.([A-Z0-9_]+)/.exec(enabled)?.[1] ?? null;
  }

  let rateLimitPerDay: number | null = null;
  let agent: AgentFacts | null = null;
  for (const raw of asArray(line.steps)) {
    const step = asRecord(raw);
    const name = str(step.name);
    const env = asRecord(step.env);
    if (name.includes('rate.limiter') && env.LIMIT != null) {
      const n = Number(env.LIMIT);
      if (Number.isFinite(n)) rateLimitPerDay = n;
    }
    if (str(step.uses).includes('claude-code-action')) {
      const withBlock = asRecord(step.with);
      const { model, maxTurns, tools } = parseClaudeArgs(str(withBlock.claude_args));
      const { promptRef, obligations } = parsePrompt(str(withBlock.prompt));
      agent = { stepName: name, model, maxTurns, tools, promptRef, obligations };
    }
  }

  return { name: str(doc.name), events, crons, planFirst, permissions, killSwitchVar, rateLimitPerDay, agent };
}

/** Turn a raw `--allowedTools` grant into a short human phrase for the capability list. */
export function describeTool(tool: string): string {
  if (/^Bash\(gh run /.test(tool)) return 'read workflow-run telemetry';
  // `gh search issues` is verb-then-noun, unlike `gh <noun> <verb>` below.
  const search = /^Bash\(gh search ([a-z]+)/.exec(tool);
  if (search) return `search ${search[1]}`;
  const gh = /^Bash\(gh ([a-z]+) ([a-z-]+)/.exec(tool);
  if (gh) {
    const [, noun, verb] = gh;
    const map: Record<string, string> = {
      comment: 'comment on', edit: 'edit', create: 'create', merge: 'merge',
      list: 'list', view: 'read', diff: 'read the diff of', close: 'close',
    };
    return `${map[verb] ?? verb} ${noun === 'pr' ? 'pull requests' : noun === 'issue' ? 'issues' : noun + 's'}`;
  }
  if (/^Bash\(git /.test(tool)) return 'run git (branch/commit/push)';
  if (tool === 'Edit' || tool === 'Write') return 'edit repository files';
  if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') return 'read repository files';
  if (/^Bash\(/.test(tool)) return tool.slice(5, -1);
  return tool;
}
