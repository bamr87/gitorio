// The machine catalog. Everything renders and compiles from here.
// Adding a machine? Use /add-machine — registry entry is step 1 of 5.

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
        key: 'alsoOnSync',
        label: 'Also on new pushes',
        kind: 'select',
        options: ['no', 'yes'],
      },
    ],
    defaults: { alsoOnSync: 'no' },
    describe: (c) =>
      c.alsoOnSync === 'yes' ? 'on: pull_request [opened, synchronize]' : 'on: pull_request [opened]',
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
    blurb: 'Run on demand via workflow_dispatch.',
    fields: [],
    defaults: {},
    describe: () => 'on: workflow_dispatch',
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
        options: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
      },
      { key: 'maxTurns', label: 'Max turns', kind: 'number', placeholder: '8' },
    ],
    defaults: { promptRef: '.factory/prompts/triage.md', model: 'claude-sonnet-4-6', maxTurns: 8 },
    describe: (c) => `${str(c.model, 'claude-sonnet-4-6')} · ${str(c.promptRef, 'no prompt!')}`,
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
      'Merges the pull request (grants contents + pull-requests: write). "auto" merges only once required checks pass. Scope it with a Filter or Dependabot-metadata — never merge untrusted PRs blindly.',
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
