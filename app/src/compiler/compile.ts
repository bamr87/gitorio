// GitFactory compiler v0 — pure function: Blueprint → workflow files.
// Spec: docs/ARCHITECTURE.md §5. Reference output: examples/compiled/*.yml.
// Golden rules #3–#6 apply here. Verify claude-code-action inputs before changing
// the agent step shape (they changed at v1: prompt + claude_args).

import { stringify } from 'yaml';
import type { Blueprint, BlueprintNode } from '../blueprint/types';
import { blueprintHash, kebab } from '../blueprint/types';

export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
}

export interface CompiledWorkflow {
  filename: string;
  yaml: string;
  diagnostics: Diagnostic[];
}

export interface CompileResult {
  workflows: CompiledWorkflow[];
  diagnostics: Diagnostic[];
}

export interface CompileOptions {
  /** Test/escape hatch: skip auto bot-guards. The compiler REFUSES loop-risky graphs in this mode. */
  unsafeNoGuards?: boolean;
  /**
   * Path stamped into the generated-file header's `blueprint:` line. Defaults to the canonical
   * `.factory/blueprint.json`; override for a standalone/named blueprint (e.g. a docs-gardener
   * factory kept separate from the repo's main blueprint) so drift detection points at the right file.
   */
  blueprintPath?: string;
  /** Override: SHA-pin emitted `uses:` refs regardless of the blueprint's `meta.pinActions`. */
  pinActions?: boolean;
}

/**
 * SHA-pinned actions mode (ADR-026): the pin table for every `uses:` ref this
 * compiler can emit. The compiler is pure (golden rule #3), so pins are a
 * curated static table, not an API lookup. SHAs verified against the upstream (checkout@v7 = v7.0.1 re-verified 2026-08-28)
 * tag refs on 2026-08-18 (golden rule #4) — re-verify with:
 *   gh api repos/<owner>/<repo>/git/ref/tags/<tag>   (deref annotated tags via /git/tags/<sha>)
 * The pinned-actions invariant test fails if an emitted ref is missing here.
 */
export const PINNED_ACTIONS: Record<string, string> = {
  'actions/checkout@v7': '3d3c42e5aac5ba805825da76410c181273ba90b1',
  'dependabot/fetch-metadata@v2': '21025c705c08248db411dc16f3619e6b5f9ea21a',
  'anthropics/claude-code-action@v1': '459ad358ae43fea66bfefd0a1f8d840b4b9791fb',
  // The perfection loop's three (ADR-031). Resolved upstream with
  // `git ls-remote https://github.com/<repo> refs/tags/<tag>` — the same method that
  // reproduces the actions/checkout@v7 pin above exactly.
  'actions/upload-artifact@v4': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact@v4': 'd3f86a106a0bac45b974a628896c90dbdf5c8093',
  'peter-evans/create-pull-request@v7': '22a9089034f40e5a961c8808d113e2c98fb63676',
};

/** Map a tag ref to its pinned form (`owner/action@<sha>`), or return it unchanged. */
function pinRef(ref: string, pin: boolean): string {
  if (!pin) return ref;
  const sha = PINNED_ACTIONS[ref];
  return sha ? ref.replace(/@[^@]+$/, `@${sha}`) : ref;
}

/** After stringify: annotate each pinned SHA with its original tag as a YAML comment. */
function annotatePins(yaml: string): string {
  let out = yaml;
  for (const [ref, sha] of Object.entries(PINNED_ACTIONS)) {
    const tag = ref.slice(ref.lastIndexOf('@') + 1);
    out = out.replace(new RegExp(`@${sha}$`, 'gm'), `@${sha} # ${tag}`);
  }
  return out;
}

const AGENT = 'agent.claude';
const FEEDBACK = 'processor.feedback_controller';
// Both compile to a claude-code-action step. The feedback controller is a specialised
// agent (a built-in loop-tuner contract + telemetry-read/ledger-write grants).
const AGENTS = new Set([AGENT, FEEDBACK]);
const DEPENDABOT_META = 'processor.dependabot_meta';
const GATE = 'gate.approval';
const ENABLEMENT = 'gate.enablement';
const RATE = 'rate.limiter';
// ── The perfection loop (ADR-022, adapted from it-journey's quest-perfection) ──
// Four machines that together make an autonomous improvement loop CONVERGE instead of
// churn. The discipline they encode: a committed ledger (not a model) chooses the work;
// budget caps sized to human review speed decide how much; evidence is sealed BEFORE the
// agent so it can never grade itself; and an independent deterministic check decides
// whether an edit survives. Every one of those is a deterministic step around the agent,
// which is exactly why the loop can be left running.
const LEDGER = 'processor.ledger';
const BUDGET = 'gate.budget';
const EVIDENCE = 'processor.evidence';
const VERIFY = 'gate.verified_fix';
/** Non-trigger, non-sink processors the compiler recognises (each has its own emitter). */
const PROCESSORS = new Set([
  'filter.condition',
  DEPENDABOT_META,
  GATE,
  ENABLEMENT,
  RATE,
  LEDGER,
  BUDGET,
  EVIDENCE,
  VERIFY,
]);
const TRIGGERS = new Set([
  'trigger.issue_opened',
  'trigger.issue_labeled',
  'trigger.pr_opened',
  'trigger.comment',
  'trigger.cron',
  'trigger.manual',
  'trigger.workflow_run',
  'trigger.repository_dispatch',
]);
const SINKS = new Set([
  'sink.comment',
  'sink.label',
  'sink.create_issue',
  'sink.open_pr',
  'sink.commit_files',
  'sink.merge_pr',
  'sink.cross_repo_issue',
  'sink.repository_dispatch',
]);
// Writing sinks emit a new comment/issue/PR event IN THIS REPO that could retrigger the
// line. sink.cross_repo_issue writes to ANOTHER repo, so it can't feed this line — kept out.
// sink.repository_dispatch normally targets another repo too; the SELF-dispatch loop case
// (target == this repo + same event type) is refused explicitly in the validation below.
const WRITING_SINKS = new Set(['sink.comment', 'sink.create_issue', 'sink.label']);
// Terminal sinks close/merge the entity — they emit no new comment/issue/PR event, so a
// line whose only action is terminal can never retrigger itself and needs no bot loop-guard.
const TERMINAL_SINKS = new Set(['sink.merge_pr']);
const LOOPY_TRIGGERS = new Set([
  'trigger.comment',
  'trigger.issue_opened',
  'trigger.issue_labeled',
  'trigger.pr_opened',
]);

const s = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;

// ── graph helpers ──────────────────────────────────────────────────────

function connectedComponents(bp: Blueprint): BlueprintNode[][] {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Set<string>>();
  for (const n of bp.nodes) adj.set(n.id, new Set());
  for (const e of bp.edges) {
    adj.get(e.from.node)?.add(e.to.node);
    adj.get(e.to.node)?.add(e.from.node);
  }
  const seen = new Set<string>();
  const comps: BlueprintNode[][] = [];
  for (const n of bp.nodes) {
    if (seen.has(n.id)) continue;
    const comp: BlueprintNode[] = [];
    const stack = [n.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (node) comp.push(node);
      for (const next of adj.get(id) ?? []) if (!seen.has(next)) stack.push(next);
    }
    comps.push(comp);
  }
  return comps;
}

function downstream(startId: string, bp: Blueprint): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of bp.edges) {
    if (!out.has(e.from.node)) out.set(e.from.node, []);
    out.get(e.from.node)!.push(e.to.node);
  }
  const seen = new Set<string>();
  const stack = [...(out.get(startId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of out.get(id) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

// ── assembly-line partitioning (shared by compile + telemetry) ─────────

/** One connected component that owns a workflow file. */
export interface AssemblyLine {
  filename: string;
  slug: string;
  name: string;
  nodeIds: string[];
}

/** Naming must match compile()'s: single line uses the meta name; multiple are suffixed. */
function lineName(bp: Blueprint, count: number, idx: number): string {
  return count === 1 ? bp.meta.name : `${bp.meta.name} ${idx + 1}`;
}

/**
 * Per-line names (ADR-028): with `meta.lineNaming: 'auto'`, a multi-line
 * blueprint names each line after what it IS — the agent's promptRef basename
 * (`.factory/prompts/docs-gardener.md` → "docs-gardener"), else its first
 * trigger + first sink types — instead of `<meta.name> <index>`. Duplicate
 * derived names get a deterministic ` 2`/` 3` suffix by component order.
 * Single-line blueprints always keep `meta.name`. Used by compile() AND
 * assemblyLines() so filenames and telemetry mapping can never diverge.
 */
function lineNames(bp: Blueprint, comps: BlueprintNode[][]): string[] {
  if (comps.length === 1) return [bp.meta.name];
  if (bp.meta.lineNaming !== 'auto') {
    return comps.map((_, idx) => lineName(bp, comps.length, idx));
  }
  const derived = comps.map((comp) => {
    const agent = comp.find((n) => n.type === 'agent.claude' || n.type === 'processor.feedback_controller');
    const promptRef = agent ? s(agent.config.promptRef) : '';
    if (promptRef) {
      const base = promptRef.split('/').pop()!.replace(/\.[a-z]+$/i, '');
      if (base) return base;
    }
    const trigger = comp.find((n) => TRIGGERS.has(n.type));
    const sink = comp.find((n) => SINKS.has(n.type));
    const part = (t: string | undefined) => (t ? t.split('.').pop()!.replace(/_/g, '-') : '');
    const composed = [part(trigger?.type), part(sink?.type)].filter(Boolean).join('-');
    return composed || `${bp.meta.name} line`;
  });
  const seen = new Map<string, number>();
  return derived.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  });
}

function triggeredComponents(bp: Blueprint): BlueprintNode[][] {
  return connectedComponents(bp).filter((comp) => comp.some((n) => TRIGGERS.has(n.type)));
}

/**
 * Which machines belong to which emitted workflow file. Lets telemetry map a
 * `factory--<slug>.yml` run back onto the nodes it should light up. Pure; the naming
 * is derived identically to compile() so filenames line up exactly.
 */
export function assemblyLines(bp: Blueprint): AssemblyLine[] {
  const comps = triggeredComponents(bp);
  const names = lineNames(bp, comps);
  return comps.map((comp, idx) => {
    const name = names[idx];
    const slug = kebab(name);
    return { filename: `factory--${slug}.yml`, slug, name, nodeIds: comp.map((n) => n.id) };
  });
}

// ── per-sink knowledge ─────────────────────────────────────────────────

function obligationFor(sink: BlueprintNode, entityExpr: string): string {
  const c = sink.config;
  switch (sink.type) {
    case 'sink.label': {
      const labels = s(c.labels);
      const which = labels
        ? `Apply exactly these labels: ${labels}`
        : 'Apply the appropriate labels';
      return `[sink.label ${sink.id}] ${which} to ${entityExpr} using \`gh issue edit --add-label\`. Prefer existing labels (\`gh label list\`).`;
    }
    case 'sink.comment':
      return `[sink.comment ${sink.id}] Post exactly one comment on ${entityExpr} that ${s(c.instruction, 'summarizes your findings')}.`;
    case 'sink.create_issue': {
      const hint = s(c.titleHint);
      return `[sink.create_issue ${sink.id}] Create one issue with \`gh issue create\`${hint ? ` titled like "${hint}"` : ''} carrying your findings. Search for an existing open one first and update it instead of duplicating.`;
    }
    case 'sink.open_pr':
      return `[sink.open_pr ${sink.id}] Commit your changes on a new branch${s(c.branchHint) ? ` (\`${s(c.branchHint)}\`)` : ' (factory/*)'} and open a pull request with a clear summary. Never push to the default branch.`;
    case 'sink.commit_files':
      return `[sink.commit_files ${sink.id}] Commit the file changes${s(c.pathScope) ? ` (only within \`${s(c.pathScope)}\`)` : ''} directly with a conventional commit message.`;
    case 'sink.repository_dispatch': {
      const target = s(c.targetRepo, 'OWNER/NAME');
      const secret = s(c.tokenSecret, 'FLEET_TOKEN');
      const evType = s(c.eventType, 'factory-signal');
      return `[sink.repository_dispatch ${sink.id}] Send exactly ONE cross-repo signal to ${target}: \`GH_TOKEN=$${secret} gh api repos/${target}/dispatches -f event_type='${evType}' -F 'client_payload[number]=<entity number>'\` (include the number only when your work concerns a specific issue/PR). The default GITHUB_TOKEN cannot write to other repos — authenticate with the scoped token in \`$${secret}\`.`;
    }
    case 'sink.cross_repo_issue': {
      const target = s(c.targetRepo, '<targetRepo missing>');
      const secret = s(c.tokenSecret, 'FLEET_TOKEN');
      const hint = s(c.titleHint);
      return `[sink.cross_repo_issue ${sink.id}] File one issue in ${target}: \`GH_TOKEN=$${secret} gh issue create --repo ${target}${hint ? ` --title "${hint}: …"` : ''}\` carrying your findings. The default GITHUB_TOKEN cannot write to other repos — authenticate with the scoped token in \`$${secret}\`. Search first (\`GH_TOKEN=$${secret} gh issue list --repo ${target}\`) and update an existing open issue instead of duplicating.`;
    }
    case 'sink.merge_pr': {
      const when = s(c.when, 'auto') === 'now' ? 'Merge it immediately' : 'Enable auto-merge (merges once required checks pass)';
      // Policy lives in the operating instructions, NOT in agent discretion. The earlier
      // wording ("only merge when your assessment says it is safe") let a live agent
      // override a hold-label with its own green-CI reasoning (ADR-015).
      return `[sink.merge_pr ${sink.id}] ${when} on ${entityExpr} with \`gh pr merge --${s(c.method, 'squash')}${s(c.when, 'auto') === 'now' ? '' : ' --auto'}\`. Merge ONLY pull requests the operating instructions explicitly permit — their guardrails override your own judgment: if they say hold, you hold, even when your assessment says merging is safe. Never merge if unsure.`;
    }
    default:
      return `[${sink.type} ${sink.id}] (no obligation template)`;
  }
}

// The built-in loop-tuner contract: a self-improvement controller's fixed obligations. It
// measures the factory's OWN telemetry, verifies the last change against a ledger, makes the
// smallest upstream fix, records it so the next run can verify it, and opens ONE PR — never
// merging. Mirrors the proven lifehacker.dev loop-tuner (ADR-017).
function feedbackContract(ledgerPath: string): string[] {
  const dir = ledgerPath.includes('/') ? ledgerPath.slice(0, ledgerPath.lastIndexOf('/')) : '.factory/metrics';
  const history = `${dir}/history.jsonl`;
  return [
    `MEASURE — read the factory's own telemetry over the last WINDOW_DAYS days: \`gh run list\` for the factory--* workflows (conclusions, durations, runs/day), open factory PRs (\`gh pr list\`), and the previous snapshot in ${history}. Compute the signals: failure rate, time-to-merge, throughput, and any regression versus the last snapshot.`,
    `VERIFY THE LAST CHANGE — open the ledger ${ledgerPath}. For every entry whose status is \`pending\`, re-measure its \`metric\` against its \`baseline\` and \`direction\`, then set the status to \`verified\` or \`regressed\`. A \`regressed\` entry is this run's top fix-or-revert candidate.`,
    `DIAGNOSE — for each strong signal, find the UPSTREAM cause and make the SMALLEST content-agnostic change that moves the measured number: edit a prompt under .factory/prompts/, a knob in .factory/config.yml, or the backlog — never a fix that only helps one item.`,
    `RECORD — append a new \`pending\` entry to ${ledgerPath} (id, metric, baseline, direction, note) and one snapshot line to ${history}. This is what makes runs compound instead of repeat.`,
    `SHIP — open exactly ONE pull request (branch \`loop-tuner/<date>\`) whose body cites the metric before, the root cause, the change, and how the next run verifies it. NEVER merge it. If there is no evidenced improvement AND no ledger verdict changed, open NO PR and report that the loop is healthy.`,
  ];
}

// `prContext` = this line may act on pull requests (a PR trigger, or survey mode where a
// scheduled/manual agent discovers PRs itself). Labels/comments on a PR go through the
// pr subcommands; the issue subcommands are kept too since they resolve PR numbers.
function toolsFor(sinkType: string, prContext: boolean): string[] {
  switch (sinkType) {
    case 'sink.label':
      return prContext
        ? ['Bash(gh label list:*)', 'Bash(gh issue edit:*)', 'Bash(gh pr edit:*)']
        : ['Bash(gh label list:*)', 'Bash(gh issue edit:*)'];
    case 'sink.comment':
      return prContext
        ? ['Bash(gh issue comment:*)', 'Bash(gh pr comment:*)']
        : ['Bash(gh issue comment:*)'];
    case 'sink.create_issue':
      return ['Bash(gh issue create:*)', 'Bash(gh issue list:*)'];
    case 'sink.open_pr':
      // The agent must EDIT files, then branch/commit/push before `gh pr create`. Grant the
      // file tools (Read/Glob/Grep/Edit/Write) AND the git verbs — previously only `gh pr
      // create` was granted, so the agent could neither change files nor commit them.
      return [
        'Read', 'Glob', 'Grep', 'Edit', 'Write',
        'Bash(git switch:*)', 'Bash(git checkout:*)', 'Bash(git add:*)',
        'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(gh pr create:*)',
      ];
    case 'sink.commit_files':
      // Edit files then commit + push directly (the obligation says to change + commit files).
      return ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git push:*)'];
    case 'sink.merge_pr':
      return ['Bash(gh pr merge:*)'];
    case 'sink.cross_repo_issue':
      return ['Bash(gh issue create:*)', 'Bash(gh issue list:*)'];
    // sink.repository_dispatch grants nothing here: its grant must carry the exact
    // target endpoint (Bash(gh api repos/<target>/dispatches:*)), which needs the
    // node's config — added at the obligated-sink loop where the node is in scope.
    default:
      return [];
  }
}

// ── main ───────────────────────────────────────────────────────────────

export function compile(bp: Blueprint, opts: CompileOptions = {}): CompileResult {
  const global: Diagnostic[] = [];
  const workflows: CompiledWorkflow[] = [];
  const hash = blueprintHash(bp);
  const pinActions = bp.meta.pinActions === true || opts.pinActions === true;

  const comps = connectedComponents(bp).filter((comp) => {
    const hasTrigger = comp.some((n) => TRIGGERS.has(n.type));
    if (!hasTrigger && comp.length > 0) {
      global.push({
        level: 'warning',
        message: `Assembly line with no trigger (${comp.map((n) => n.id).join(', ')}) — machines idle, nothing emitted.`,
      });
    }
    return hasTrigger;
  });

  const names = lineNames(bp, comps);
  comps.forEach((comp, idx) => {
    const diags: Diagnostic[] = [];
    const name = names[idx];
    const slug = kebab(name);
    const filename = `factory--${slug}.yml`;

    const triggers = comp.filter((n) => TRIGGERS.has(n.type));
    const agents = comp.filter((n) => AGENTS.has(n.type));
    const filters = comp.filter((n) => n.type === 'filter.condition');
    const dependabotMeta = comp.find((n) => n.type === DEPENDABOT_META);
    const gate = comp.find((n) => n.type === GATE);
    const enablement = comp.find((n) => n.type === ENABLEMENT);
    const limiter = comp.find((n) => n.type === RATE);
    const ledger = comp.find((n) => n.type === LEDGER);
    const budget = comp.find((n) => n.type === BUDGET);
    const evidence = comp.find((n) => n.type === EVIDENCE);
    const verify = comp.find((n) => n.type === VERIFY);
    const unknown = comp.filter(
      (n) => !TRIGGERS.has(n.type) && !SINKS.has(n.type) && !AGENTS.has(n.type) && !PROCESSORS.has(n.type),
    );
    for (const n of unknown) {
      diags.push({ level: 'error', nodeId: n.id, message: `Unknown machine type "${n.type}" — no emitter.` });
    }
    if (agents.length > 1) {
      diags.push({
        level: 'error',
        message: `Multiple Claude agents on one line (${agents.map((a) => a.id).join(', ')}) — multi-agent lines land with belt mode (Phase 6). Split into separate lines.`,
      });
    }

    // on: merge
    const on: Record<string, unknown> = {};
    const guards: string[] = [];
    const issueTypes = new Set<string>();
    const prTypes = new Set<string>();
    const crons: { cron: string }[] = [];
    const watchedWorkflows: string[] = [];
    let hasIssueish = false;
    let hasPr = false;
    let prLabelScoped = false;
    let hasDispatch = false;
    let hasComment = false;
    let hasWorkflowRun = false;
    let planFirst = false; // a manual trigger asked for dry-run-by-default (apply on non-manual events)

    for (const t of triggers) {
      switch (t.type) {
        case 'trigger.issue_opened':
          issueTypes.add('opened');
          hasIssueish = true;
          break;
        case 'trigger.issue_labeled': {
          issueTypes.add('labeled');
          hasIssueish = true;
          const label = s(t.config.label);
          if (label) guards.push(`github.event.label.name == '${label}'`);
          break;
        }
        case 'trigger.pr_opened':
          if (s(t.config.fireOn, 'opened') === 'labeled') {
            // Label-gated mode (ADR-027): fires only on label adds; with a label
            // configured, a job-level guard scopes the line to exactly that label —
            // merge policy as structure, not prose (the ADR-015 lesson).
            prTypes.add('labeled');
            const prLabel = s(t.config.label);
            if (prLabel) {
              guards.push(`github.event.label.name == '${prLabel}'`);
              prLabelScoped = true;
            }
            else
              diags.push({
                level: 'warning',
                nodeId: t.id,
                message:
                  'PR trigger fires on EVERY label add — set "Only this label" to scope it (e.g. dep:safe-to-merge).',
              });
          } else {
            prTypes.add('opened');
            if (t.config.alsoOnSync === 'yes') prTypes.add('synchronize');
          }
          hasPr = true;
          break;
        case 'trigger.comment': {
          on['issue_comment'] = { types: ['created'] };
          hasComment = true;
          const phrase = s(t.config.phrase);
          if (phrase) guards.push(`contains(github.event.comment.body, '${phrase}')`);
          break;
        }
        case 'trigger.cron': {
          const cron = s(t.config.cron, '0 3 * * *');
          crons.push({ cron });
          break;
        }
        case 'trigger.manual':
          if (s(t.config.mode, 'apply') === 'plan-first') planFirst = true;
          on['workflow_dispatch'] = {};
          break;
        case 'trigger.workflow_run': {
          hasWorkflowRun = true;
          const wfName = s(t.config.workflow);
          if (wfName) watchedWorkflows.push(wfName);
          else diags.push({ level: 'error', nodeId: t.id, message: 'On-workflow-result trigger has no watched workflow name.' });
          const concl = s(t.config.conclusion, 'success');
          if (concl && concl !== 'any') guards.push(`github.event.workflow_run.conclusion == '${concl}'`);
          break;
        }
        case 'trigger.repository_dispatch': {
          // Cross-repo signal (ADR-029, Fleet C): another repo's factory (or any
          // system holding a repo-scoped token) POSTs /dispatches with this event
          // type. Senders are already write-privileged principals; still, per
          // ADR-005 the payload BODY never enters the prompt — only the event
          // type and an optional `client_payload.number` entity pointer do.
          const eventType = s(t.config.eventType);
          if (eventType) on['repository_dispatch'] = { types: [eventType] };
          else {
            on['repository_dispatch'] = {};
            diags.push({
              level: 'warning',
              nodeId: t.id,
              message:
                'Cross-repo signal fires for EVERY dispatch type — set an event type (e.g. factory-signal) to scope it.',
            });
          }
          hasDispatch = true;
          break;
        }
      }
    }
    if (issueTypes.size) on['issues'] = { types: [...issueTypes].sort() };
    if (prTypes.size) on['pull_request'] = { types: [...prTypes].sort() };
    if (crons.length) on['schedule'] = crons;
    if (hasWorkflowRun) on['workflow_run'] = { workflows: watchedWorkflows, types: ['completed'] };

    // Dry-run/apply duality (a plan-first manual trigger): a manual run PLANS only unless the
    // `apply` box is ticked; every non-manual event (schedule, workflow_run, …) applies. Guards
    // the deterministic mutating sink steps and flips the agent into report-only on a dry run.
    const applyExpr = "(github.event_name != 'workflow_dispatch' || inputs.apply)";
    if (planFirst) {
      on['workflow_dispatch'] = {
        inputs: {
          apply: {
            description: 'Apply changes (leave unchecked for a dry run — plan only)',
            type: 'boolean',
            default: false,
          },
        },
      };
    }

    // Survey mode: an agent line fired only by cron/manual has no triggering issue/PR
    // from the event, so it must discover its own work. It runs in the base-repo context
    // (full secrets, writable token, no bot-guard), which is the ONLY way to review
    // Dependabot PRs — a pull_request trigger would be bot-guarded off and would get a
    // read-only token with no secrets on Dependabot events.
    const surveyMode =
      agents.length > 0 && !hasIssueish && !hasPr && !hasComment && !hasWorkflowRun;

    // sinks by mode: downstream of the agent → obligations; reachable without an
    // agent on the path → deterministic. v0 approximation: agent downstream set.
    const agent = agents[0];
    const agentDownstream = agent ? downstream(agent.id, bp) : new Set<string>();
    const metaDownstream = dependabotMeta ? downstream(dependabotMeta.id, bp) : new Set<string>();
    const order = new Map(bp.nodes.map((n, i) => [n.id, i]));
    const sinks = comp
      .filter((n) => SINKS.has(n.type))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const obligated = sinks.filter((n) => agentDownstream.has(n.id));
    const deterministic = sinks.filter((n) => !agentDownstream.has(n.id));

    // loop safety
    const canWrite = sinks.some((n) => WRITING_SINKS.has(n.type)) || agents.length > 0;
    const loopy = triggers.some((t) => LOOPY_TRIGGERS.has(t.type));
    // A line whose only action is a terminal sink (merge/close) with no agent produces no
    // new comment/issue/PR event, so it cannot retrigger itself — it needs no bot loop-guard,
    // and MUST run without one to act on Dependabot's (bot-authored) PRs (auto-merge).
    const onlyTerminalSinks =
      sinks.length > 0 && sinks.every((n) => TERMINAL_SINKS.has(n.type)) && agents.length === 0;
    if (loopy && canWrite && opts.unsafeNoGuards) {
      diags.push({
        level: 'error',
        message:
          'REFUSED: this line is triggered by issue/PR/comment events AND writes them back — without bot guards it can feed itself forever. Remove unsafeNoGuards.',
      });
      workflows.push({ filename, yaml: '', diagnostics: diags });
      return;
    }
    if (!opts.unsafeNoGuards && !onlyTerminalSinks && (hasIssueish || hasPr || hasComment)) {
      // Guard on the event ACTOR (github.event.sender), not the entity author.
      // On issues.labeled the actor is the labeller — NOT github.event.issue.user
      // (the author); on pull_request.synchronize the actor is the pusher — NOT the
      // PR author. Checking the author lets a bot's own label/push/commit slip the
      // guard and retrigger the line (golden rule #6). sender.type == 'Bot' catches
      // every agent-authored write. For non-event runs (e.g. a merged cron trigger)
      // github.event.sender is null, so `null != 'Bot'` is true and the run proceeds.
      guards.unshift(`github.event.sender.type != 'Bot'`);
    }
    for (const f of filters) {
      const expr = s(f.config.expression);
      if (expr) guards.push(expr);
      else diags.push({ level: 'warning', nodeId: f.id, message: 'Empty filter passes everything.' });
    }

    // Dependabot metadata: reads the PR via dependabot/fetch-metadata (needs the
    // pull_request event) and gates downstream sinks by update type. fetch-metadata only
    // makes sense for Dependabot's own PRs, so scope the whole line to Dependabot — which
    // also (together with the terminal-sink relaxation above) lets the auto-merge through.
    let metaGate: string | null = null;
    if (dependabotMeta) {
      if (!hasPr) {
        diags.push({
          level: 'error',
          nodeId: dependabotMeta.id,
          message: 'Dependabot metadata needs a PR-opened trigger — fetch-metadata reads the pull_request event.',
        });
      }
      guards.unshift(`github.event.pull_request.user.login == 'dependabot[bot]'`);
      const allow = s(dependabotMeta.config.allow, 'patch-and-minor');
      if (allow === 'patch') {
        metaGate = `steps.dependabot-metadata.outputs.update-type == 'version-update:semver-patch'`;
      } else if (allow === 'patch-and-minor') {
        metaGate = `contains(fromJSON('["version-update:semver-patch","version-update:semver-minor"]'), steps.dependabot-metadata.outputs.update-type)`;
      }
    }

    // Safety: an unscoped merge on a raw pull_request trigger would merge every matching PR.
    const hasMerge = sinks.some((n) => n.type === 'sink.merge_pr');
    // A DETERMINISTIC merge reads the PR number from the event, so it needs a PR-bearing
    // trigger. An agent-obligated merge is fine on any line — the agent finds the PR itself
    // (e.g. the survey-mode Dependency Warden merging what it vets safe).
    if (deterministic.some((n) => n.type === 'sink.merge_pr') && !hasPr && !hasWorkflowRun) {
      diags.push({
        level: 'error',
        message:
          'Merge PR with no agent needs a PR-bearing trigger (PR opened or On workflow result) — or put a Claude agent upstream to supply the PR.',
      });
    }
    // A label-scoped `labeled` trigger IS the merge policy (ADR-027) — as scoped as a filter.
    if (hasMerge && hasPr && !dependabotMeta && !prLabelScoped && !filters.some((f) => /dependabot|user\.login|github\.actor/.test(s(f.config.expression)))) {
      diags.push({
        level: 'warning',
        message:
          'Merge PR on a pull_request trigger will act on every PR — add a Filter (e.g. github.event.pull_request.user.login == \'dependabot[bot]\') or a Dependabot-metadata processor to scope it, and require status checks via branch protection.',
      });
    }

    // Approval gate → run the whole line in a protected environment (human approval).
    const gateEnv = gate ? s(gate.config.environment, 'factory-approval') : null;
    if (gate && !s(gate.config.environment)) {
      diags.push({
        level: 'warning',
        nodeId: gate.id,
        message: 'Approval gate has no environment name — using "factory-approval". Create it (with required reviewers) in Settings → Environments.',
      });
    }

    // Enablement gate → a default-OFF `gate` job checks a repo variable (and, for agent lines,
    // that Claude auth exists). The line `needs: gate` and runs only when it outputs go == 'true'.
    // Flip the variable to arm/disarm the whole line instantly with no redeploy; a compromised
    // agent can't re-arm itself (setting a variable needs an admin scope the fleet token lacks).
    const enableVar = enablement ? s(enablement.config.variable) : null;
    if (enablement && !enableVar) {
      diags.push({
        level: 'error',
        nodeId: enablement.id,
        message: 'Enablement gate needs a repo variable name (e.g. CONTENT_FACTORY_ENABLED).',
      });
    }
    if (enableVar) guards.unshift(`needs.gate.outputs.go == 'true'`);

    // Rate limiter → a guard step that stops the line past N runs/day (loop/cost insurance).
    const rateLimit = limiter
      ? Number(limiter.config.maxPerDay) > 0
        ? Math.floor(Number(limiter.config.maxPerDay))
        : 10
      : null;

    // Cross-repo sinks (issue + dispatch): validate targets + collect the scoped-token
    // secrets they need. A dispatch sink additionally gets the self-loop refusal:
    // dispatching to THIS repo with an event type this line also subscribes to would
    // retrigger itself forever (golden rule #6 — refuse, don't warn).
    const crossRepoSinks = sinks.filter(
      (n) => n.type === 'sink.cross_repo_issue' || n.type === 'sink.repository_dispatch',
    );
    const crossRepoSecrets = new Set<string>();
    for (const cr of crossRepoSinks) {
      const target = s(cr.config.targetRepo);
      if (!/^[^/\s]+\/[^/\s]+$/.test(target)) {
        diags.push({
          level: 'error',
          nodeId: cr.id,
          message: `${cr.type === 'sink.repository_dispatch' ? 'Cross-repo signal' : 'Cross-repo issue'} needs a target repo as owner/name.`,
        });
      }
      if (cr.type === 'sink.repository_dispatch' && target && target === s(bp.meta.repo)) {
        const sinkType = s(cr.config.eventType, 'factory-signal');
        const dispatchTrigger = triggers.find((t) => t.type === 'trigger.repository_dispatch');
        const trigType = dispatchTrigger ? s(dispatchTrigger.config.eventType) : null;
        if (dispatchTrigger && (!trigType || trigType === sinkType)) {
          diags.push({
            level: 'error',
            nodeId: cr.id,
            message: `Self-dispatch loop: this line listens for repository_dispatch${trigType ? ` '${trigType}'` : ' (any type)'} and would send '${sinkType}' to its own repo — it would retrigger itself forever.`,
          });
        } else {
          diags.push({
            level: 'warning',
            nodeId: cr.id,
            message: 'Dispatch targets this same repo — make sure no other factory line subscribed to this event type loops back here.',
          });
        }
      }
      crossRepoSecrets.add(s(cr.config.tokenSecret, 'FLEET_TOKEN'));
    }
    if (crossRepoSinks.length) {
      diags.push({
        level: 'warning',
        message: `Cross-repo issue uses a scoped token secret (${[...crossRepoSecrets].join(', ')}) — create it in this repo's Actions secrets (a PAT that can open issues in the target). The GITHUB_TOKEN cannot write to other repos.`,
      });
    }

    // permissions
    const permissions: Record<string, string> = { contents: 'read' };
    const needsIssuesWrite = sinks.some((n) =>
      ['sink.comment', 'sink.label', 'sink.create_issue'].includes(n.type),
    );
    if (needsIssuesWrite) permissions['issues'] = 'write';
    // Commenting on or labelling a PR is governed by the pull-requests scope (not issues),
    // even though gh routes through the shared issue number space. Grant it whenever the
    // line can act on PRs — a PR trigger, an On-workflow-result trigger, survey mode, or open_pr.
    const actsOnPr = hasPr || hasWorkflowRun || surveyMode;
    if (
      sinks.some((n) => n.type === 'sink.open_pr') ||
      (actsOnPr && sinks.some((n) => ['sink.comment', 'sink.label'].includes(n.type)))
    ) {
      permissions['pull-requests'] = 'write';
    }
    if (sinks.some((n) => ['sink.open_pr', 'sink.commit_files'].includes(n.type))) {
      permissions['contents'] = 'write';
    }
    if (hasMerge) {
      // gh pr merge needs both — contents to land the merge commit, pull-requests to act on the PR.
      permissions['contents'] = 'write';
      permissions['pull-requests'] = 'write';
    }
    if (dependabotMeta && permissions['pull-requests'] !== 'write') {
      permissions['pull-requests'] = 'read'; // fetch-metadata reads the PR
    }
    if (limiter) permissions['actions'] = 'read'; // gh run list reads the Actions API
    if (agent) permissions['id-token'] = 'write';
    // Feedback controller reads run telemetry (actions:read), edits prompts/config, and opens
    // exactly one tuning PR (contents+pull-requests: write). It is never granted merge.
    if (agent?.type === FEEDBACK) {
      permissions['contents'] = 'write';
      permissions['pull-requests'] = 'write';
      permissions['actions'] = 'read';
    }

    // entity expressions for prompts / deterministic steps
    const entityExpr = hasPr && !hasIssueish && !hasComment
      ? 'PR #${{ github.event.pull_request.number }}'
      : hasIssueish || hasComment
        ? 'issue #${{ github.event.issue.number }}'
        : hasWorkflowRun
          ? 'PR #${{ github.event.workflow_run.pull_requests[0].number }}'
          : 'the relevant issue/PR (find it via gh)';

    // steps
    const steps: Record<string, unknown>[] = [];
    if (rateLimit !== null) {
      // First step, before checkout: count today's runs of THIS workflow and fail fast at the cap.
      steps.push({
        name: `🚥 rate.limiter (${limiter!.id})`,
        env: { GH_TOKEN: '${{ github.token }}', LIMIT: String(rateLimit) },
        run:
          'COUNT=$(gh run list --workflow "$GITHUB_WORKFLOW" --created "$(date -u +%Y-%m-%d)" --json databaseId --jq \'length\')\n' +
          'if [ "$COUNT" -ge "$LIMIT" ]; then echo "rate limit ($LIMIT/day) reached — stopping"; exit 1; fi',
      });
    }
    if (agent || evidence || ledger) steps.push({ uses: pinRef('actions/checkout@v7', pinActions) });
    if (evidence) {
      // BEFORE the agent, deliberately. Two reasons, both load-bearing:
      // (1) the agent must not be able to manufacture the evidence it is judged on, and
      // (2) Claude Code scrubs auth env vars from its Bash-tool subprocesses, so a
      //     measurement engine launched inside an agent could never authenticate.
      steps.push({
        name: `🔏 evidence.seal (${evidence.id})`,
        run: s(evidence.config.measureCmd, 'python3 scripts/measure.py --out evidence/'),
      });
    }
    if (dependabotMeta) {
      // Exposes steps.dependabot-metadata.outputs.update-type / dependency-names / etc.
      steps.push({ id: 'dependabot-metadata', uses: pinRef('dependabot/fetch-metadata@v2', pinActions) });
    }

    if (agent) {
      const isFeedback = agent.type === FEEDBACK;
      const promptRef = s(agent.config.promptRef, isFeedback ? '.factory/prompts/loop-tuner.md' : '');
      if (!promptRef && !isFeedback) {
        diags.push({ level: 'error', nodeId: agent.id, message: 'Claude agent has no prompt file (promptRef).' });
      }

      const ledgerPath = s(agent.config.ledgerPath, '.factory/metrics/improvements.yml');
      const windowDays = Number(agent.config.windowDays) > 0 ? Math.floor(Number(agent.config.windowDays)) : 7;
      const contextLines = ['REPO: ${{ github.repository }}'];
      if (isFeedback) {
        contextLines.push(`WINDOW_DAYS: ${windowDays}`);
        contextLines.push(`LEDGER: ${ledgerPath}`);
      } else {
        if (hasIssueish || hasComment) contextLines.push('ISSUE_NUMBER: ${{ github.event.issue.number }}');
        if (hasPr) contextLines.push('PR_NUMBER: ${{ github.event.pull_request.number }}');
        if (hasDispatch) {
          // Numbers-not-bodies (ADR-005): the payload's entity POINTER is context;
          // its free-text fields never enter the prompt.
          contextLines.push('DISPATCH_TYPE: ${{ github.event.action }}');
          contextLines.push('PAYLOAD_NUMBER: ${{ github.event.client_payload.number }}');
        }
        if (hasWorkflowRun) {
          contextLines.push('PR_NUMBER: ${{ github.event.workflow_run.pull_requests[0].number }}');
          contextLines.push('CHECK_CONCLUSION: ${{ github.event.workflow_run.conclusion }}');
        }
      }
      if (planFirst) contextLines.push(`APPLY: \${{ ${applyExpr} }}`);

      // Obligations: the loop-tuner carries a built-in contract; every agent also inherits its
      // downstream sinks' obligations. Numbered once, in graph order.
      const rawObligations = isFeedback ? feedbackContract(ledgerPath) : [];
      for (const sink of obligated) rawObligations.push(obligationFor(sink, entityExpr));
      if (!isFeedback && obligated.length === 0) {
        diags.push({
          level: 'warning',
          nodeId: agent.id,
          message: 'Agent has no downstream sinks — it will run read-only with no obligations.',
        });
      }
      const obligations = rawObligations.map((o, i) => `${i + 1}. ${o}`);

      const intro = isFeedback
        ? `\n\nYou are this repository's loop-tuner — a self-improvement controller for the factory itself.` +
          (promptRef ? ` Also read and follow ${promptRef} if it exists.` : '')
        : `\n\nRead and follow the operating instructions in ${promptRef || '<promptRef missing>'}.`;
      const planNote = planFirst
        ? `\n\nPLAN/APPLY MODE — when APPLY is false this is a DRY RUN: do the full analysis, then, instead of performing the write obligations below, report the exact plan of what you WOULD do and stop. Perform the obligations only when APPLY is true.`
        : '';
      // Verification checks (ADR-025): repo-declared commands, one per line. Each
      // compiles to exactly `Bash(<command>:*)` — a narrow, blueprint-reviewed grant —
      // plus a VERIFY note, so an agent line can run its repo's own gates instead of
      // deferring everything to PR CI. A quote would break the --allowedTools string,
      // so it is a compile error, not an escaping adventure.
      const checks = s(agent.config.checks, '')
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean);
      for (const c of checks) {
        if (c.includes('"') || c.includes('`') || c.includes('$(')) {
          diags.push({
            level: 'error',
            nodeId: agent.id,
            message: `Verification check contains quoting/substitution (\`"\`, backtick, or $() ) — declare a plain command: ${c}`,
          });
        }
      }
      const checksNote = checks.length
        ? `\n\nVERIFY (run each of these repo checks before completing your write obligations; report their output — if one fails, fix forward or downgrade to a report):\n${checks.map((c) => `- ${c}`).join('\n')}`
        : '';
      const prompt =
        contextLines.join('\n') +
        intro +
        planNote +
        checksNote +
        (obligations.length
          ? `\n\nOBLIGATIONS (complete every item, nothing else):\n${obligations.join('\n')}`
          : '');

      // context tools by trigger kind + per-sink grants
      const tools = new Set<string>();
      if (isFeedback) {
        // Measure telemetry (read-only), edit prompts/config, open exactly ONE tuning PR.
        // Deliberately NOT granted `gh pr merge` (the no-self-merge invariant) or `gh workflow`.
        for (const t of [
          'Read', 'Glob', 'Grep', 'Edit', 'Write',
          'Bash(gh run list:*)', 'Bash(gh run view:*)', 'Bash(gh pr list:*)',
          'Bash(git switch:*)', 'Bash(git checkout:*)', 'Bash(git add:*)',
          'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(gh pr create:*)',
        ]) tools.add(t);
      } else {
        if (hasIssueish || hasComment) {
          tools.add('Bash(gh issue view:*)');
          tools.add('Bash(gh search issues:*)');
        }
        if (hasPr || hasWorkflowRun) {
          tools.add('Bash(gh pr view:*)');
          tools.add('Bash(gh pr diff:*)');
        }
        if (crons.length) {
          tools.add('Bash(gh issue list:*)');
          tools.add('Bash(gh search issues:*)');
        }
        if (surveyMode) {
          // gh issue list / search can't see PRs (gh forces `type:issue`), so a warden that
          // reviews pull requests needs the pr subcommands explicitly. Read-only discovery +
          // inspection; writes come from the sink grants below (never merge/create/close).
          tools.add('Bash(gh issue list:*)');
          tools.add('Bash(gh search issues:*)');
          tools.add('Bash(gh pr list:*)');
          tools.add('Bash(gh pr view:*)');
          tools.add('Bash(gh pr diff:*)');
          // A warden that gates a merge on CI reaches for `gh pr checks` first; without it
          // that verb is denied and the run burns turns rediscovering `gh pr view --json
          // statusCheckRollup`. Read-only.
          tools.add('Bash(gh pr checks:*)');
        }
        // `intro` above orders EVERY non-feedback agent to read its promptRef. Grant the
        // read tools to match, or the agent's first instruction is a guaranteed denial and
        // it starves retrying it (Read → Glob → Grep → cat → …). Previously these arrived
        // only via toolsFor(sink.open_pr / sink.commit_files), so every comment/label/merge
        // line was told to read a file it had no permission to open. Read-only: widens no
        // write surface.
        if (promptRef) {
          tools.add('Read');
          tools.add('Glob');
          tools.add('Grep');
        }
      }
      // The VERIFY note above orders the agent to run each declared check — grant
      // exactly those commands, nothing wider (prompt/grant coherence, ADR-023/025).
      for (const c of checks) tools.add(`Bash(${c}:*)`);
      for (const sink of obligated) {
        for (const t of toolsFor(sink.type, hasPr || surveyMode || hasWorkflowRun)) tools.add(t);
        // Dispatch sinks get the exact target endpoint, nothing wider (rule #5).
        if (sink.type === 'sink.repository_dispatch') {
          tools.add(`Bash(gh api repos/${s(sink.config.targetRepo, 'OWNER/NAME')}/dispatches:*)`);
        }
      }

      const model = s(agent.config.model, isFeedback ? 'claude-opus-4-8' : 'claude-sonnet-4-6');
      const maxTurns = Number(agent.config.maxTurns) > 0 ? Number(agent.config.maxTurns) : isFeedback ? 30 : 8;
      const claudeArgs =
        `--model ${model}\n--max-turns ${maxTurns}` +
        (tools.size ? `\n--allowedTools "${[...tools].join(',')}"` : '');

      const agentStep: Record<string, unknown> = {
        name: `${isFeedback ? '🔁 feedback_controller' : '⚙ agent.claude'} (${agent.id})`,
        uses: pinRef('anthropics/claude-code-action@v1', pinActions),
        with: {
          // Power: default to the Claude Code OAuth token (`claude setup-token`), fall back
          // to ANTHROPIC_API_KEY. The expression passes the API key ONLY when the OAuth
          // secret is unset, so exactly one input is ever non-empty (no precedence ambiguity).
          claude_code_oauth_token: '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
          anthropic_api_key: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets.ANTHROPIC_API_KEY || '' }}",
          prompt,
          claude_args: claudeArgs,
        },
      };
      // Expose each obligated cross-repo sink's scoped token to the agent's bash (the
      // obligation authenticates with $<secret>; the GITHUB_TOKEN can't write other repos).
      const obligatedCross = obligated.filter(
        (n) => n.type === 'sink.cross_repo_issue' || n.type === 'sink.repository_dispatch',
      );
      if (obligatedCross.length) {
        const stepEnv: Record<string, string> = {};
        for (const cr of obligatedCross) {
          const sec = s(cr.config.tokenSecret, 'FLEET_TOKEN');
          stepEnv[sec] = `\${{ secrets.${sec} }}`;
        }
        agentStep.env = stepEnv;
      }
      steps.push(agentStep);
    }

    // deterministic sinks (no agent on their path). In plan-first mode a manual dry run gates
    // every mutating step on the `apply` flag; non-manual events (schedule, …) apply.
    const detIf = (extra: string | null): Record<string, unknown> => {
      const parts: string[] = [];
      if (planFirst) parts.push(applyExpr);
      if (extra) parts.push(extra);
      return parts.length ? { if: `\${{ ${parts.join(' && ')} }}` } : {};
    };
    for (const sink of deterministic) {
      const env = {
        GH_TOKEN: '${{ github.token }}',
        GH_REPO: '${{ github.repository }}',
        NUMBER:
          '${{ github.event.issue.number || github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.event.client_payload.number }}',
      };
      if (sink.type === 'sink.merge_pr') {
        const method = s(sink.config.method, 'squash');
        const flag = method === 'merge' ? '--merge' : method === 'rebase' ? '--rebase' : '--squash';
        const auto = s(sink.config.when, 'auto') === 'now' ? '' : ' --auto';
        const step: Record<string, unknown> = {
          name: `✅ sink.merge_pr (${sink.id})`,
          ...detIf(metaGate && metaDownstream.has(sink.id) ? metaGate : null),
          env,
          run: `gh pr merge "$NUMBER" ${flag}${auto}`,
        };
        steps.push(step);
      } else if (sink.type === 'sink.comment') {
        const body = s(sink.config.instruction);
        if (!body) diags.push({ level: 'warning', nodeId: sink.id, message: 'Deterministic comment has empty body.' });
        steps.push({
          name: `📝 sink.comment (${sink.id})`,
          ...detIf(null),
          env: { ...env, BODY: body || '(factory notification)' },
          run: 'gh issue comment "$NUMBER" --body "$BODY"',
        });
      } else if (sink.type === 'sink.label') {
        const labels = s(sink.config.labels)
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean);
        if (!labels.length) {
          diags.push({
            level: 'error',
            nodeId: sink.id,
            message: 'Deterministic label sink needs explicit labels (or put a Claude agent upstream to decide).',
          });
        } else {
          steps.push({
            name: `🏷 sink.label (${sink.id})`,
            ...detIf(null),
            env,
            run: `gh issue edit "$NUMBER" ${labels.map((l) => `--add-label "${l}"`).join(' ')}`,
          });
        }
      } else if (sink.type === 'sink.repository_dispatch') {
        const target = s(sink.config.targetRepo, 'OWNER/NAME');
        const secret = s(sink.config.tokenSecret, 'FLEET_TOKEN');
        const evType = s(sink.config.eventType, 'factory-signal');
        steps.push({
          name: `📤 sink.repository_dispatch (${sink.id})`,
          ...detIf(null),
          // Scoped PAT secret, NOT github.token — the GITHUB_TOKEN can't write other repos.
          env: { ...env, GH_TOKEN: `\${{ secrets.${secret} }}`, TARGET: target, EVENT_TYPE: evType },
          run: 'gh api "repos/$TARGET/dispatches" -f "event_type=$EVENT_TYPE" -F "client_payload[number]=$NUMBER"',
        });
      } else if (sink.type === 'sink.cross_repo_issue') {
        const target = s(sink.config.targetRepo, 'OWNER/NAME');
        const secret = s(sink.config.tokenSecret, 'FLEET_TOKEN');
        const title = s(sink.config.titleHint, 'Factory notification');
        steps.push({
          name: `🚉 sink.cross_repo_issue (${sink.id})`,
          ...detIf(null),
          // Scoped PAT secret, NOT github.token — the GITHUB_TOKEN can't write other repos.
          env: { GH_TOKEN: `\${{ secrets.${secret} }}`, TARGET: target, TITLE: title },
          run: 'gh issue create --repo "$TARGET" --title "$TITLE" --body "(factory notification from ${{ github.repository }})"',
        });
      } else {
        diags.push({
          level: 'error',
          nodeId: sink.id,
          message: `${sink.type} requires a Claude agent upstream in v0 (deterministic emission lands with belt mode).`,
        });
      }
    }

    if (steps.length === 0) {
      diags.push({ level: 'error', message: 'Line produces no steps — nothing to emit.' });
      workflows.push({ filename, yaml: '', diagnostics: diags });
      return;
    }

    if (verify) {
      // Anti-self-grading: an INDEPENDENT command decides whether the agent's edits
      // survive. The model's own claim that it helped is never the signal.
      const revert = s(verify.config.onFail, 'revert') !== 'keep-and-flag';
      steps.push({
        name: `⚖️ verified_fix (${verify.id})`,
        run:
          `if ${s(verify.config.verifyCmd, 'python3 scripts/verify.py --fail-under-baseline')}; then\n` +
          '  echo "verified — the edit improved the deterministic signal, keeping it"\n' +
          'else\n' +
          (revert
            ? '  echo "NOT verified — reverting; nothing unproven is proposed"\n  git checkout -- .\n'
            : '  echo "NOT verified — kept, but flagged for human judgement"\n') +
          'fi',
      });
    }
    if (evidence) {
      // The durable handoff. A later fix run reuses this artifact by run id instead of
      // re-paying to measure — measurement is the expensive half of the loop.
      steps.push({
        name: '📦 upload sealed evidence',
        uses: pinRef('actions/upload-artifact@v4', pinActions),
        with: {
          name: s(evidence.config.artifactName, 'perfection-evidence'),
          path: s(evidence.config.evidencePath, 'evidence/'),
          'if-no-files-found': 'warn',
        },
      });
    }

    const job: Record<string, unknown> = {
      'runs-on': 'ubuntu-latest',
      // Enablement gate: the line runs only when the default-OFF `gate` job says go.
      ...(enableVar ? { needs: 'gate' } : {}),
      ...(guards.length ? { if: `\${{ ${guards.join(' && ')} }}` } : {}),
      // Approval gate: the environment's protection rules pause the run for a human reviewer.
      ...(gateEnv ? { environment: gateEnv } : {}),
      permissions,
      steps,
    };

    // The enablement gate is a tiny default-OFF job: it only lets the line proceed when the
    // repo variable is "true" — and, for agent lines, when Claude auth is provisioned. An
    // unset variable reads as idle (never as "safe to run"). Flipping the variable arms or
    // disarms the whole line with no redeploy; a compromised agent can't re-arm itself.
    const jobs: Record<string, unknown> = {};
    if (enableVar) {
      const needsAuth = agents.length > 0;
      const gateEnvVars: Record<string, string> = { ENABLED: `\${{ vars.${enableVar} }}` };
      if (needsAuth) {
        gateEnvVars.OAUTH = '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}';
        gateEnvVars.KEY = '${{ secrets.ANTHROPIC_API_KEY }}';
      }
      const gateRun = needsAuth
        ? 'if [ "$ENABLED" = "true" ] && { [ -n "$OAUTH" ] || [ -n "$KEY" ]; }; then\n' +
          '  echo "go=true" >> "$GITHUB_OUTPUT"\n' +
          'else\n' +
          `  echo "gate closed — set the '${enableVar}' variable to true and provision Claude auth to arm this line."\n` +
          '  echo "go=false" >> "$GITHUB_OUTPUT"\n' +
          'fi'
        : 'if [ "$ENABLED" = "true" ]; then\n' +
          '  echo "go=true" >> "$GITHUB_OUTPUT"\n' +
          'else\n' +
          `  echo "gate closed — set the '${enableVar}' variable to true to arm this line."\n` +
          '  echo "go=false" >> "$GITHUB_OUTPUT"\n' +
          'fi';
      jobs.gate = {
        'runs-on': 'ubuntu-latest',
        outputs: { go: '${{ steps.check.outputs.go }}' },
        steps: [{ id: 'check', env: gateEnvVars, run: gateRun }],
      };
    }
    if (ledger) {
      // PLAN — deterministic. The ledger, not a model, chooses the work. Budget caps
      // clamp throughput to what one human can actually review; without them an
      // autonomous loop out-runs its reviewer and the queue becomes the bottleneck.
      const planSteps: Record<string, unknown>[] = [{ uses: pinRef('actions/checkout@v7', pinActions) }];
      if (budget) {
        const maxOpen = Number(budget.config.maxOpenPrs) > 0 ? Math.floor(Number(budget.config.maxOpenPrs)) : 6;
        planSteps.push({
          name: `🧮 budget.gate (${budget.id})`,
          env: { GH_TOKEN: '${{ github.token }}', MAX_OPEN: String(maxOpen) },
          run:
            `OPEN=$(gh pr list --state open --label "${s(budget.config.prLabel, 'automated')}" --json number --jq 'length')\n` +
            'if [ "$OPEN" -ge "$MAX_OPEN" ]; then\n' +
            '  echo "$OPEN PRs already awaiting review (cap $MAX_OPEN) — planning no new work this run."\n' +
            '  echo "paused=true" >> "$GITHUB_OUTPUT"\n' +
            'else\n' +
            '  echo "paused=false" >> "$GITHUB_OUTPUT"\n' +
            'fi',
          id: 'budget',
        });
      }
      planSteps.push({
        name: `📒 ledger.select (${ledger.id})`,
        id: 'select',
        ...(budget ? { if: "steps.budget.outputs.paused != 'true'" } : {}),
        env: {
          MAX_ITEMS: String(
            budget && Number(budget.config.maxItemsPerRun) > 0
              ? Math.floor(Number(budget.config.maxItemsPerRun))
              : 3,
          ),
          SKIP_WITHIN_DAYS: String(
            budget && Number(budget.config.skipWithinDays) > 0
              ? Math.floor(Number(budget.config.skipWithinDays))
              : 7,
          ),
        },
        run:
          `MATRIX=$(${s(ledger.config.selectCmd, 'python3 scripts/ledger.py select --json')})\n` +
          'echo "matrix=$MATRIX" >> "$GITHUB_OUTPUT"\n' +
          'echo "count=$(echo "$MATRIX" | jq \'[.. | arrays] | first | length // 0\')" >> "$GITHUB_OUTPUT"',
      });
      jobs.plan = {
        'runs-on': 'ubuntu-latest',
        ...(enableVar ? { needs: 'gate', if: "needs.gate.outputs.go == 'true'" } : {}),
        permissions: { contents: 'read', 'pull-requests': 'read' },
        outputs: {
          matrix: '${{ steps.select.outputs.matrix }}',
          count: '${{ steps.select.outputs.count || 0 }}',
        },
        steps: planSteps,
      };
      // The line now consumes the plan: it runs only when the plan found work, and it
      // fans out over the slices the ledger chose. This is the ROTATING WINDOW — a run
      // takes on a bounded slice of the backlog and the ledger accumulates coverage over
      // following runs, because walking a whole backlog in one run exhausts the token's
      // rate limit long before it finishes.
      job.strategy = {
        'fail-fast': false,
        'max-parallel': 1,
        matrix: '${{ fromJson(needs.plan.outputs.matrix) }}',
      };
      job.needs = enableVar ? ['gate', 'plan'] : ['plan'];
      const planGuard = "needs.plan.outputs.count != '0'";
      job.if = typeof job.if === 'string' && job.if.length
        ? String(job.if).replace(/^\$\{\{ (.*) \}\}$/, (_m, inner) => `\${{ ${inner} && ${planGuard} }}`)
        : `\${{ ${planGuard} }}`;
    }
    jobs.line = job;
    if (ledger) {
      // REPORT — deterministic. Folds the sealed evidence back into the ledger and
      // recomputes "done". This is the field an agent may never write: if a model can
      // certify its own work as finished, the loop stops converging and starts flattering
      // itself. One consolidated PR per run, so ledger deltas can't conflict with
      // each other, and the ledger rides HERE — never on a content PR.
      jobs.report = {
        'runs-on': 'ubuntu-latest',
        needs: enableVar ? ['gate', 'plan', 'line'] : ['plan', 'line'],
        if: "!cancelled() && needs.plan.outputs.count != '0'",
        permissions: { contents: 'write', 'pull-requests': 'write' },
        steps: [
          { uses: pinRef('actions/checkout@v7', pinActions) },
          ...(evidence
            ? [
                {
                  name: 'download sealed evidence',
                  uses: pinRef('actions/download-artifact@v4', pinActions),
                  with: {
                    name: s(evidence.config.artifactName, 'perfection-evidence'),
                    path: s(evidence.config.evidencePath, 'evidence/'),
                  },
                  'continue-on-error': true,
                },
              ]
            : []),
          {
            name: `📒 ledger.update (${ledger.id})`,
            run: s(ledger.config.updateCmd, 'python3 scripts/ledger.py update --evidence evidence/'),
          },
          {
            name: 'open the ledger PR',
            uses: pinRef('peter-evans/create-pull-request@v7', pinActions),
            with: {
              branch: `${s(ledger.config.reportBranch, 'factory/ledger')}/\${{ github.run_id }}`,
              'commit-message': `chore(factory): ledger update from run \${{ github.run_id }}`,
              title: `chore(factory): ledger update from run \${{ github.run_id }}`,
              body:
                'Deterministic ledger update — the done flag is recomputed from sealed evidence, never written by an agent.\n\n' +
                `Run: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}`,
              labels: 'automated',
              'add-paths': s(ledger.config.ledgerPath, '.factory/ledger.json'),
            },
          },
        ],
      };
    }

    const wf = {
      name: `Factory: ${name}`,
      on,
      concurrency: {
        group: `factory--${slug}-\${{ github.event.issue.number || github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.event.client_payload.number || github.run_id }}`,
        'cancel-in-progress': false,
      },
      jobs,
    };

    const header =
      `# ⚙ GENERATED BY GITFACTORY — edit the blueprint, not this file.\n` +
      `# blueprint: ${opts.blueprintPath ?? '.factory/blueprint.json'}  hash: ${hash}\n`;
    const raw = header + stringify(wf, { lineWidth: 0 });
    // Pinned refs get their original tag back as a trailing comment — added
    // textually because a scalar containing " # " would be quoted by the YAML
    // emitter, making the comment part of the (then-invalid) ref.
    const yaml = pinActions ? annotatePins(raw) : raw;
    workflows.push({ filename, yaml, diagnostics: diags });
  });

  return { workflows, diagnostics: global };
}
