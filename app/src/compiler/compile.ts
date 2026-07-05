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
}

const AGENT = 'agent.claude';
const DEPENDABOT_META = 'processor.dependabot_meta';
const TRIGGERS = new Set([
  'trigger.issue_opened',
  'trigger.issue_labeled',
  'trigger.pr_opened',
  'trigger.comment',
  'trigger.cron',
  'trigger.manual',
  'trigger.workflow_run',
]);
const SINKS = new Set([
  'sink.comment',
  'sink.label',
  'sink.create_issue',
  'sink.open_pr',
  'sink.commit_files',
  'sink.merge_pr',
]);
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
  return comps.map((comp, idx) => {
    const name = lineName(bp, comps.length, idx);
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
    case 'sink.merge_pr': {
      const when = s(c.when, 'auto') === 'now' ? 'Merge it immediately' : 'Enable auto-merge (merges once required checks pass)';
      return `[sink.merge_pr ${sink.id}] ${when} on ${entityExpr} with \`gh pr merge --${s(c.method, 'squash')}${s(c.when, 'auto') === 'now' ? '' : ' --auto'}\`. Only merge when your assessment says it is safe; never merge if unsure.`;
    }
    default:
      return `[${sink.type} ${sink.id}] (no obligation template)`;
  }
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
      return ['Bash(gh pr create:*)'];
    case 'sink.merge_pr':
      return ['Bash(gh pr merge:*)'];
    default:
      return [];
  }
}

// ── main ───────────────────────────────────────────────────────────────

export function compile(bp: Blueprint, opts: CompileOptions = {}): CompileResult {
  const global: Diagnostic[] = [];
  const workflows: CompiledWorkflow[] = [];
  const hash = blueprintHash(bp);

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

  comps.forEach((comp, idx) => {
    const diags: Diagnostic[] = [];
    const name = lineName(bp, comps.length, idx);
    const slug = kebab(name);
    const filename = `factory--${slug}.yml`;

    const triggers = comp.filter((n) => TRIGGERS.has(n.type));
    const agents = comp.filter((n) => n.type === AGENT);
    const filters = comp.filter((n) => n.type === 'filter.condition');
    const dependabotMeta = comp.find((n) => n.type === DEPENDABOT_META);
    const unknown = comp.filter(
      (n) =>
        !TRIGGERS.has(n.type) &&
        !SINKS.has(n.type) &&
        n.type !== AGENT &&
        n.type !== 'filter.condition' &&
        n.type !== DEPENDABOT_META,
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
    let hasComment = false;
    let hasWorkflowRun = false;

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
          prTypes.add('opened');
          if (t.config.alsoOnSync === 'yes') prTypes.add('synchronize');
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
      }
    }
    if (issueTypes.size) on['issues'] = { types: [...issueTypes].sort() };
    if (prTypes.size) on['pull_request'] = { types: [...prTypes].sort() };
    if (crons.length) on['schedule'] = crons;
    if (hasWorkflowRun) on['workflow_run'] = { workflows: watchedWorkflows, types: ['completed'] };

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
    if (hasMerge && hasPr && !dependabotMeta && !filters.some((f) => /dependabot|user\.login|github\.actor/.test(s(f.config.expression)))) {
      diags.push({
        level: 'warning',
        message:
          'Merge PR on a pull_request trigger will act on every PR — add a Filter (e.g. github.event.pull_request.user.login == \'dependabot[bot]\') or a Dependabot-metadata processor to scope it, and require status checks via branch protection.',
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
    if (agent) permissions['id-token'] = 'write';

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
    if (agent) steps.push({ uses: 'actions/checkout@v4' });
    if (dependabotMeta) {
      // Exposes steps.dependabot-metadata.outputs.update-type / dependency-names / etc.
      steps.push({ id: 'dependabot-metadata', uses: 'dependabot/fetch-metadata@v2' });
    }

    if (agent) {
      const promptRef = s(agent.config.promptRef);
      if (!promptRef) {
        diags.push({ level: 'error', nodeId: agent.id, message: 'Claude agent has no prompt file (promptRef).' });
      }
      const contextLines = ['REPO: ${{ github.repository }}'];
      if (hasIssueish || hasComment) contextLines.push('ISSUE_NUMBER: ${{ github.event.issue.number }}');
      if (hasPr) contextLines.push('PR_NUMBER: ${{ github.event.pull_request.number }}');
      if (hasWorkflowRun) {
        contextLines.push('PR_NUMBER: ${{ github.event.workflow_run.pull_requests[0].number }}');
        contextLines.push('CHECK_CONCLUSION: ${{ github.event.workflow_run.conclusion }}');
      }

      const obligations = obligated.map((sink, i) => `${i + 1}. ${obligationFor(sink, entityExpr)}`);
      if (obligated.length === 0) {
        diags.push({
          level: 'warning',
          nodeId: agent.id,
          message: 'Agent has no downstream sinks — it will run read-only with no obligations.',
        });
      }

      const prompt =
        contextLines.join('\n') +
        `\n\nRead and follow the operating instructions in ${promptRef || '<promptRef missing>'}.` +
        (obligations.length
          ? `\n\nOBLIGATIONS (complete every item, nothing else):\n${obligations.join('\n')}`
          : '');

      // context tools by trigger kind + per-sink grants
      const tools = new Set<string>();
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
      }
      for (const sink of obligated) for (const t of toolsFor(sink.type, hasPr || surveyMode || hasWorkflowRun)) tools.add(t);

      const model = s(agent.config.model, 'claude-sonnet-4-6');
      const maxTurns = Number(agent.config.maxTurns) > 0 ? Number(agent.config.maxTurns) : 8;
      const claudeArgs =
        `--model ${model}\n--max-turns ${maxTurns}` +
        (tools.size ? `\n--allowedTools "${[...tools].join(',')}"` : '');

      steps.push({
        name: `⚙ agent.claude (${agent.id})`,
        uses: 'anthropics/claude-code-action@v1',
        with: {
          // Power: default to the Claude Code OAuth token (`claude setup-token`), fall back
          // to ANTHROPIC_API_KEY. The expression passes the API key ONLY when the OAuth
          // secret is unset, so exactly one input is ever non-empty (no precedence ambiguity).
          claude_code_oauth_token: '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
          anthropic_api_key: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets.ANTHROPIC_API_KEY || '' }}",
          prompt,
          claude_args: claudeArgs,
        },
      });
    }

    // deterministic sinks (no agent on their path)
    for (const sink of deterministic) {
      const env = {
        GH_TOKEN: '${{ github.token }}',
        GH_REPO: '${{ github.repository }}',
        NUMBER:
          '${{ github.event.issue.number || github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number }}',
      };
      if (sink.type === 'sink.merge_pr') {
        const method = s(sink.config.method, 'squash');
        const flag = method === 'merge' ? '--merge' : method === 'rebase' ? '--rebase' : '--squash';
        const auto = s(sink.config.when, 'auto') === 'now' ? '' : ' --auto';
        const step: Record<string, unknown> = {
          name: `✅ sink.merge_pr (${sink.id})`,
          ...(metaGate && metaDownstream.has(sink.id) ? { if: `\${{ ${metaGate} }}` } : {}),
          env,
          run: `gh pr merge "$NUMBER" ${flag}${auto}`,
        };
        steps.push(step);
      } else if (sink.type === 'sink.comment') {
        const body = s(sink.config.instruction);
        if (!body) diags.push({ level: 'warning', nodeId: sink.id, message: 'Deterministic comment has empty body.' });
        steps.push({
          name: `📝 sink.comment (${sink.id})`,
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
            env,
            run: `gh issue edit "$NUMBER" ${labels.map((l) => `--add-label "${l}"`).join(' ')}`,
          });
        }
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

    const job: Record<string, unknown> = {
      'runs-on': 'ubuntu-latest',
      ...(guards.length ? { if: `\${{ ${guards.join(' && ')} }}` } : {}),
      permissions,
      steps,
    };

    const wf = {
      name: `Factory: ${name}`,
      on,
      concurrency: {
        group: `factory--${slug}-\${{ github.event.issue.number || github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.run_id }}`,
        'cancel-in-progress': false,
      },
      jobs: { line: job },
    };

    const header =
      `# ⚙ GENERATED BY GITFACTORY — edit the blueprint, not this file.\n` +
      `# blueprint: .factory/blueprint.json  hash: ${hash}\n`;
    const yaml = header + stringify(wf, { lineWidth: 0 });
    workflows.push({ filename, yaml, diagnostics: diags });
  });

  return { workflows, diagnostics: global };
}
