// The machine catalog. Everything renders and compiles from here.
// Adding a machine? Use /add-machine — registry entry is step 1 of 5.

import { CLAUDE_MODEL_OPTIONS, CLAUDE_MODELS } from '../models';

export type MachineCategory = 'trigger' | 'processor' | 'sink';

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'select';
  options?: string[];
  placeholder?: string;
  help?: string;
}

export interface MachineDef {
  type: string;
  category: MachineCategory;
  label: string;
  icon: string;
  blurb: string;
  fields: FieldDef[];
  defaults: Record<string, unknown>;
  describe: (config: Record<string, unknown>) => string;
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

/** Positive-integer config read, for the caps the loop machines describe. */
const num = (v: unknown, fallback: number): number =>
  Number(v) > 0 ? Math.floor(Number(v)) : fallback;

export const MACHINES: MachineDef[] = [
  // ── Triggers (copper) ────────────────────────────────────────────────
  {
    type: 'trigger.issue_opened',
    category: 'trigger',
    label: 'Issue opened',
    icon: '📥',
    blurb: 'Fires when a new issue lands on the intake belt.',
    fields: [],
    defaults: {},
    describe: () => 'on: issues [opened]',
  },
  {
    type: 'trigger.issue_labeled',
    category: 'trigger',
    label: 'Issue labeled',
    icon: '🏷️',
    blurb: 'Fires when a specific label is applied to an issue.',
    fields: [
      { key: 'label', label: 'Label', kind: 'text', placeholder: 'needs-triage' },
    ],
    defaults: { label: '' },
    describe: (c) => `on label: ${str(c.label, 'any')}`,
  },
  {
    type: 'trigger.pr_opened',
    category: 'trigger',
    label: 'PR opened',
    icon: '🔀',
    blurb: 'Fires when a pull request is opened (optionally on new pushes too).',
    fields: [
      {
        key: 'fireOn',
        label: 'Fire on',
        kind: 'select',
        options: ['opened', 'labeled'],
        help: '"labeled" fires when a label is added — the deterministic merge-line keystone (ADR-027): pair with the label field below and a terminal merge sink.',
      },
      {
        key: 'alsoOnSync',
        label: 'Also on new pushes',
        kind: 'select',
        options: ['no', 'yes'],
      },
      {
        key: 'label',
        label: 'Only this label',
        kind: 'text',
        placeholder: 'dep:safe-to-merge',
        help: 'With "labeled": the line runs only when exactly this label is added (a job-level guard on github.event.label.name).',
      },
    ],
    defaults: { fireOn: 'opened', alsoOnSync: 'no', label: '' },
    describe: (c) =>
      c.fireOn === 'labeled'
        ? `on: pull_request [labeled${c.label ? `: ${c.label}` : ''}]`
        : c.alsoOnSync === 'yes'
          ? 'on: pull_request [opened, synchronize]'
          : 'on: pull_request [opened]',
  },
  {
    type: 'trigger.comment',
    category: 'trigger',
    label: 'Comment',
    icon: '💬',
    blurb: 'Fires on new issue/PR comments containing a phrase. Bot-guarded by the compiler.',
    fields: [
      { key: 'phrase', label: 'Trigger phrase', kind: 'text', placeholder: '@factory' },
    ],
    defaults: { phrase: '@factory' },
    describe: (c) => `on comment: "${str(c.phrase, 'any')}"`,
  },
  {
    type: 'trigger.cron',
    category: 'trigger',
    label: 'Schedule',
    icon: '⏰',
    blurb: 'Fires on a cron schedule (UTC). The factory night shift.',
    fields: [
      { key: 'cron', label: 'Cron (UTC)', kind: 'text', placeholder: '0 3 * * *' },
    ],
    defaults: { cron: '0 3 * * *' },
    describe: (c) => `cron: ${str(c.cron, '0 3 * * *')}`,
  },
  {
    type: 'trigger.manual',
    category: 'trigger',
    label: 'Manual lever',
    icon: '🕹️',
    blurb:
      'Run on demand via workflow_dispatch. In plan-first mode a manual run only PLANS (dry run) unless you tick “apply”; scheduled runs always apply.',
    fields: [
      {
        key: 'mode',
        label: 'Manual run mode',
        kind: 'select',
        options: ['apply', 'plan-first'],
        help: 'plan-first: a manual run is a dry run (plan only) unless the “apply” box is ticked. Scheduled/other events always apply.',
      },
    ],
    defaults: { mode: 'apply' },
    describe: (c) => (c.mode === 'plan-first' ? 'on: workflow_dispatch (plan-first)' : 'on: workflow_dispatch'),
  },
  {
    type: 'trigger.workflow_run',
    category: 'trigger',
    label: 'On workflow result',
    icon: '🚦',
    blurb:
      'Fires when another workflow finishes — gate on success/failure. Runs in the trusted default-branch context (write token + secrets), so it can safely act on Dependabot/fork PRs after their checks run.',
    fields: [
      { key: 'workflow', label: 'Watched workflow name', kind: 'text', placeholder: 'CI' },
      { key: 'conclusion', label: 'When it concludes', kind: 'select', options: ['success', 'failure', 'any'] },
    ],
    defaults: { workflow: 'CI', conclusion: 'success' },
    describe: (c) => `on: ${str(c.workflow, 'a workflow')} → ${str(c.conclusion, 'any')}`,
  },

  // ── Processors (steel) ───────────────────────────────────────────────
  {
    type: 'trigger.repository_dispatch',
    category: 'trigger',
    label: 'Cross-repo signal',
    icon: '📡',
    blurb:
      'Fires when another repo (or any system holding a repo-scoped token) POSTs a repository_dispatch event of this type — the receiving end of an inter-repo belt (Fleet C). Senders are write-privileged principals; the payload body never enters prompts, only client_payload.number as an entity pointer.',
    fields: [
      {
        key: 'eventType',
        label: 'Event type',
        kind: 'text',
        placeholder: 'factory-signal',
        help: 'Scopes the trigger to exactly this dispatch type (repository_dispatch: types). Empty = every type (warns).',
      },
    ],
    defaults: { eventType: 'factory-signal' },
    describe: (c) => `on: repository_dispatch [${str(c.eventType, 'any type!')}]`,
  },
  {
    type: 'agent.claude',
    category: 'processor',
    label: 'Claude agent',
    icon: '⚙️',
    blurb: 'The motor. Runs Claude Code via claude-code-action with a repo prompt and scoped tools.',
    fields: [
      {
        key: 'promptRef',
        label: 'Prompt file',
        kind: 'text',
        placeholder: '.factory/prompts/triage.md',
        help: 'Path in the target repo — edit the prompt without recompiling.',
      },
      {
        key: 'model',
        label: 'Model',
        kind: 'select',
        options: [...CLAUDE_MODEL_OPTIONS],
      },
      { key: 'maxTurns', label: 'Max turns', kind: 'number', placeholder: '8' },
      {
        key: 'checks',
        label: 'Verification checks',
        kind: 'textarea',
        placeholder: 'python3 tools/spec_validator.py\npython3 tools/backlog_lint.py',
        help: 'One repo-declared check command per line. Each compiles to exactly that Bash(<command>:*) grant plus a VERIFY obligation — the narrow alternative to deferring every gate to PR CI.',
      },
    ],
    defaults: { promptRef: '.factory/prompts/triage.md', model: CLAUDE_MODELS.opus, maxTurns: 8 },
    describe: (c) => `${str(c.model, CLAUDE_MODELS.opus)} · ${str(c.promptRef, 'no prompt!')}`,
  },
  {
    type: 'filter.condition',
    category: 'processor',
    label: 'Filter',
    icon: '🧪',
    blurb: 'Gates the line on a GitHub Actions expression (AND-joined into the job if:).',
    fields: [
      {
        key: 'expression',
        label: 'Actions expression',
        kind: 'textarea',
        placeholder: "!contains(github.event.issue.labels.*.name, 'wontfix')",
      },
    ],
    defaults: { expression: '' },
    describe: (c) => `if: ${str(c.expression, '<empty — passes everything>')}`,
  },
  {
    type: 'processor.dependabot_meta',
    category: 'processor',
    label: 'Dependabot metadata',
    icon: '📋',
    blurb:
      'Reads a Dependabot PR via dependabot/fetch-metadata and gates the downstream sinks by update type. Only works on a PR-opened line (needs the pull_request event); scopes the line to Dependabot automatically.',
    fields: [
      {
        key: 'allow',
        label: 'Let through',
        kind: 'select',
        options: ['patch', 'patch-and-minor', 'any'],
        help: 'Which semver update types reach the downstream sinks (e.g. auto-merge).',
      },
    ],
    defaults: { allow: 'patch-and-minor' },
    describe: (c) => `dependabot: allow ${str(c.allow, 'patch-and-minor')}`,
  },
  {
    type: 'gate.approval',
    category: 'processor',
    label: 'Approval gate',
    icon: '🚧',
    blurb:
      'Runs the line in a GitHub Environment whose protection rules require a human reviewer — the run pauses until someone approves. You must create the environment + required reviewers in repo Settings → Environments (the compiler cannot).',
    fields: [
      { key: 'environment', label: 'Environment name', kind: 'text', placeholder: 'factory-approval' },
    ],
    defaults: { environment: 'factory-approval' },
    describe: (c) => `approve via env: ${str(c.environment, 'factory-approval')}`,
  },
  {
    type: 'rate.limiter',
    category: 'processor',
    label: 'Rate limiter',
    icon: '🚥',
    blurb:
      'Stops the line once it has run N times today — a guard step counts the workflow’s runs and fails fast past the cap. Cheap insurance against runaway loops and agent cost.',
    fields: [{ key: 'maxPerDay', label: 'Max runs / day', kind: 'number', placeholder: '10' }],
    defaults: { maxPerDay: 10 },
    describe: (c) => `≤ ${Number(c.maxPerDay) > 0 ? Number(c.maxPerDay) : 10} runs/day`,
  },
  {
    type: 'gate.enablement',
    category: 'processor',
    label: 'Enablement gate',
    icon: '🔌',
    blurb:
      'A default-OFF kill switch. The line only runs when a repo variable is "true" (and, for agent lines, Claude auth is present). Flip the variable to turn the whole line on/off instantly — no redeploy. A compromised agent can’t flip it back (needs no admin scope). The governance backbone for autonomous lines.',
    fields: [
      {
        key: 'variable',
        label: 'Repo variable',
        kind: 'text',
        placeholder: 'CONTENT_FACTORY_ENABLED',
        help: 'A repository Actions variable. Unset or ≠ "true" = the line is idle. Set it in Settings → the line toggle, or repo Settings → Variables.',
      },
    ],
    defaults: { variable: 'CONTENT_FACTORY_ENABLED' },
    describe: (c) => `enabled if vars.${str(c.variable, 'X_ENABLED')} == 'true'`,
  },
  {
    type: 'processor.ledger',
    category: 'processor',
    label: 'Ledger',
    icon: '📒',
    blurb:
      'The perfection loop’s source of truth, and the reason it converges. A committed ledger records what has been measured and what is certified done. Before the run, a DETERMINISTIC step picks the highest-priority not-yet-perfect slice — no model chooses the work. After the run, a DETERMINISTIC step folds the sealed evidence back in and recomputes “done”. An agent can never write that field.',
    fields: [
      {
        key: 'ledgerPath',
        label: 'Ledger file',
        kind: 'text',
        placeholder: '.factory/ledger.json',
        help: 'Committed to the repo — the loop’s memory across runs. Rides the report PR only, never a content PR.',
      },
      {
        key: 'selectCmd',
        label: 'Select command',
        kind: 'text',
        placeholder: 'python3 scripts/ledger.py select --json',
        help: 'Deterministic, and the only thing that chooses work. Must print a GitHub Actions matrix object to stdout — e.g. {"slice":["a","b"]} — which the line then fans out over one slice at a time.',
      },
      {
        key: 'updateCmd',
        label: 'Update command',
        kind: 'text',
        placeholder: 'python3 scripts/ledger.py update --evidence evidence/',
        help: 'Deterministic. Folds sealed evidence into the ledger and recomputes the done flag.',
      },
      {
        key: 'reportBranch',
        label: 'Report branch prefix',
        kind: 'text',
        placeholder: 'factory/ledger',
      },
    ],
    defaults: {
      ledgerPath: '.factory/ledger.json',
      selectCmd: 'python3 scripts/ledger.py select --json',
      updateCmd: 'python3 scripts/ledger.py update --evidence evidence/',
      reportBranch: 'factory/ledger',
    },
    describe: (c) => `ledger ${str(c.ledgerPath, '.factory/ledger.json')} · deterministic select + update`,
  },
  {
    type: 'gate.budget',
    category: 'processor',
    label: 'Budget gate',
    icon: '🧮',
    blurb:
      'Backpressure clamped to HUMAN REVIEW SPEED, not machine capacity. Stops planning new work once too many PRs already await review, caps how much one run may take on, and skips anything recently certified. Without this an autonomous loop out-runs its one reviewer and buries them.',
    fields: [
      { key: 'maxOpenPrs', label: 'Max open PRs awaiting review', kind: 'number', placeholder: '6' },
      { key: 'maxItemsPerRun', label: 'Max items per run', kind: 'number', placeholder: '3' },
      { key: 'skipWithinDays', label: 'Skip items certified within (days)', kind: 'number', placeholder: '7' },
      {
        key: 'prLabel',
        label: 'Label to count',
        kind: 'text',
        placeholder: 'automated',
        help: 'Which open PRs count against the review-queue cap.',
      },
    ],
    defaults: { maxOpenPrs: 6, maxItemsPerRun: 3, skipWithinDays: 7, prLabel: 'automated' },
    describe: (c) =>
      `≤${num(c.maxItemsPerRun, 3)}/run · pause at ${num(c.maxOpenPrs, 6)} open · skip ${num(c.skipWithinDays, 7)}d`,
  },
  {
    type: 'processor.evidence',
    category: 'processor',
    label: 'Evidence seal',
    icon: '🔏',
    blurb:
      'Measures BEFORE the agent runs, then seals the result. The agent reads the evidence and writes the report — it can never produce the evidence it is graded on. Also solves a real constraint: Claude Code scrubs auth from its Bash subprocesses, so a measurement engine launched inside an agent cannot authenticate. Run it as a plain workflow step instead.',
    fields: [
      {
        key: 'measureCmd',
        label: 'Measure command',
        kind: 'text',
        placeholder: 'python3 scripts/measure.py --out evidence/',
        help: 'A deterministic workflow step. Its output is the only evidence the agent and the ledger may use.',
      },
      { key: 'evidencePath', label: 'Evidence path', kind: 'text', placeholder: 'evidence/' },
      {
        key: 'artifactName',
        label: 'Artifact name',
        kind: 'text',
        placeholder: 'perfection-evidence',
        help: 'The durable handoff — a later fix run reuses this by run id instead of re-paying to measure.',
      },
    ],
    defaults: {
      measureCmd: 'python3 scripts/measure.py --out evidence/',
      evidencePath: 'evidence/',
      artifactName: 'perfection-evidence',
    },
    describe: (c) => `seal → ${str(c.evidencePath, 'evidence/')} before the agent`,
  },
  {
    type: 'gate.verified_fix',
    category: 'processor',
    label: 'Verified fix gate',
    icon: '⚖️',
    blurb:
      'Anti-self-grading. After the agent edits, an INDEPENDENT deterministic check decides whether the edit survives — the model’s own claim that it helped is never the signal. If the check does not improve, the working tree is reverted and nothing is proposed. This is what keeps an autonomous repair loop from congratulating itself into a mess.',
    fields: [
      {
        key: 'verifyCmd',
        label: 'Verify command',
        kind: 'text',
        placeholder: 'python3 scripts/verify.py --fail-under-baseline',
        help: 'Must exit non-zero when the edit did not improve. Never let the agent supply this verdict.',
      },
      {
        key: 'onFail',
        label: 'When verification fails',
        kind: 'select',
        options: ['revert', 'keep-and-flag'],
        help: '“revert” restores the tree so nothing unproven is ever proposed. “keep-and-flag” proposes it but marks the PR for human judgement.',
      },
      {
        key: 'maxRounds',
        label: 'Circuit breaker — max fix rounds per item',
        kind: 'number',
        placeholder: '3',
        help: 'An item repaired this many times without being certified stops being a candidate.',
      },
    ],
    defaults: { verifyCmd: 'python3 scripts/verify.py --fail-under-baseline', onFail: 'revert', maxRounds: 3 },
    describe: (c) =>
      `verify → ${str(c.onFail, 'revert')} · breaker ${num(c.maxRounds, 3)} rounds`,
  },
  {
    type: 'processor.feedback_controller',
    category: 'processor',
    label: 'Feedback controller',
    icon: '🔁',
    blurb:
      'The loop-tuner. A scheduled agent that reads the factory’s OWN telemetry (run failures, time-to-merge, throughput), finds the upstream cause, makes the smallest change to a prompt/config, records it in a verified improvements ledger, and opens ONE tuning PR. It never merges. This is the feedback loop that makes the factory improve itself.',
    fields: [
      {
        key: 'promptRef',
        label: 'Prompt file',
        kind: 'text',
        placeholder: '.factory/prompts/loop-tuner.md',
        help: 'Extra operating instructions layered on the built-in loop-tuner contract.',
      },
      {
        key: 'model',
        label: 'Model',
        kind: 'select',
        options: [...CLAUDE_MODEL_OPTIONS],
      },
      {
        key: 'ledgerPath',
        label: 'Improvements ledger',
        kind: 'text',
        placeholder: '.factory/metrics/improvements.yml',
        help: 'Where the controller records each change + the metric it should move, so the next run can verify it.',
      },
      { key: 'windowDays', label: 'Look-back window (days)', kind: 'number', placeholder: '7' },
      { key: 'maxTurns', label: 'Max turns', kind: 'number', placeholder: '30' },
    ],
    defaults: {
      promptRef: '.factory/prompts/loop-tuner.md',
      model: CLAUDE_MODELS.opus,
      ledgerPath: '.factory/metrics/improvements.yml',
      windowDays: 7,
      maxTurns: 30,
    },
    describe: (c) => `loop-tuner · ${str(c.model, CLAUDE_MODELS.opus)} · ${Number(c.windowDays) > 0 ? Number(c.windowDays) : 7}d window`,
  },

  // ── Sinks (signal green) ─────────────────────────────────────────────
  {
    type: 'sink.comment',
    category: 'sink',
    label: 'Post comment',
    icon: '📝',
    blurb: 'Posts a comment on the triggering issue/PR.',
    fields: [
      {
        key: 'instruction',
        label: 'Agent instruction / body',
        kind: 'textarea',
        placeholder: 'summarizes your findings in 3 lines',
        help: 'Downstream of an agent: obligation wording. Direct from a trigger: the literal comment body.',
      },
    ],
    defaults: { instruction: 'summarizes your findings' },
    describe: (c) => `comment: ${str(c.instruction, '…')}`.slice(0, 60),
  },
  {
    type: 'sink.label',
    category: 'sink',
    label: 'Apply labels',
    icon: '🏷️',
    blurb: 'Applies labels to the triggering issue/PR.',
    fields: [
      {
        key: 'labels',
        label: 'Labels (comma-sep, empty = agent decides)',
        kind: 'text',
        placeholder: 'bug, p1',
      },
    ],
    defaults: { labels: '' },
    describe: (c) => `labels: ${str(c.labels, 'agent decides')}`,
  },
  {
    type: 'sink.create_issue',
    category: 'sink',
    label: 'Create issue',
    icon: '🧾',
    blurb: 'Files a new issue (reports, alarms, follow-ups).',
    fields: [
      { key: 'titleHint', label: 'Title hint', kind: 'text', placeholder: 'Nightly report: …' },
    ],
    defaults: { titleHint: '' },
    describe: (c) => `new issue: ${str(c.titleHint, 'agent decides title')}`,
  },
  {
    type: 'sink.open_pr',
    category: 'sink',
    label: 'Open PR',
    icon: '🚚',
    blurb: 'Ships changes as a pull request on a factory branch.',
    fields: [
      { key: 'branchHint', label: 'Branch hint', kind: 'text', placeholder: 'factory/fix-…' },
    ],
    defaults: { branchHint: '' },
    describe: (c) => `PR from ${str(c.branchHint, 'factory/*')}`,
  },
  {
    type: 'sink.repository_dispatch',
    category: 'sink',
    label: 'Cross-repo signal (send)',
    icon: '📤',
    blurb:
      'POSTs a repository_dispatch event to ANOTHER repo — the sending end of an inter-repo belt, pairing with the 📡 Cross-repo signal trigger. Uses a repo secret holding a PAT scoped to the target (default FLEET_TOKEN). Sends the entity number as client_payload.number; the compiler refuses self-dispatch loops.',
    fields: [
      { key: 'targetRepo', label: 'Target repo', kind: 'text', placeholder: 'owner/name' },
      { key: 'eventType', label: 'Event type', kind: 'text', placeholder: 'factory-signal' },
      { key: 'tokenSecret', label: 'Token secret name', kind: 'text', placeholder: 'FLEET_TOKEN' },
    ],
    defaults: { targetRepo: '', eventType: 'factory-signal', tokenSecret: 'FLEET_TOKEN' },
    describe: (c) => `signal → ${str(c.targetRepo, 'owner/name')} [${str(c.eventType, 'factory-signal')}]`,
  },
  {
    type: 'sink.cross_repo_issue',
    category: 'sink',
    label: 'Cross-repo issue',
    icon: '🚉',
    blurb:
      'Files an issue in ANOTHER repo — the proven fleet pattern. The workflow’s GITHUB_TOKEN can’t write to other repos, so this uses a repo secret holding a PAT scoped to the target (default FLEET_TOKEN). Create that secret first.',
    fields: [
      { key: 'targetRepo', label: 'Target repo', kind: 'text', placeholder: 'owner/name' },
      { key: 'tokenSecret', label: 'Token secret name', kind: 'text', placeholder: 'FLEET_TOKEN' },
      { key: 'titleHint', label: 'Title hint', kind: 'text', placeholder: 'Downstream: …' },
    ],
    defaults: { targetRepo: '', tokenSecret: 'FLEET_TOKEN', titleHint: '' },
    describe: (c) => `issue → ${str(c.targetRepo, 'owner/name')} (via ${str(c.tokenSecret, 'FLEET_TOKEN')})`,
  },
  {
    type: 'sink.merge_pr',
    category: 'sink',
    label: 'Merge PR',
    icon: '✅',
    blurb:
      'Merges the pull request (grants contents + pull-requests: write). "auto" merges only once required checks pass. Deterministic only: wiring it downstream of a Claude agent is a compile error (agents never merge, ADR-039) — gate it on a label instead (ADR-027). Scope it with a Filter or Dependabot-metadata — never merge untrusted PRs blindly.',
    fields: [
      { key: 'method', label: 'Merge method', kind: 'select', options: ['squash', 'merge', 'rebase'] },
      { key: 'when', label: 'When', kind: 'select', options: ['auto', 'now'] },
    ],
    defaults: { method: 'squash', when: 'auto' },
    describe: (c) => `merge: ${str(c.method, 'squash')} · ${str(c.when, 'auto')}`,
  },
  {
    type: 'sink.commit_files',
    category: 'sink',
    label: 'Commit files',
    icon: '📦',
    blurb: 'Commits file changes directly (grants contents: write — use sparingly).',
    fields: [
      { key: 'pathScope', label: 'Path scope', kind: 'text', placeholder: 'docs/**' },
    ],
    defaults: { pathScope: '' },
    describe: (c) => `commit in ${str(c.pathScope, 'repo root')}`,
  },
];

export const MACHINE_INDEX: Record<string, MachineDef> = Object.fromEntries(
  MACHINES.map((m) => [m.type, m]),
);

export function machineDef(type: string): MachineDef | undefined {
  return MACHINE_INDEX[type];
}
