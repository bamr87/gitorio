// The guided tour (spec FR-7, G4). Pure data: an ordered walk of the seven tabs, each
// step naming what that surface is FOR. A visitor who has never read the README should be
// able to press "next" seven times and come away knowing what GitFactory does.
//
// No component logic here — `DemoBanner` renders it and drives `setView`.

import type { AppView } from '../state/ui';

export interface TourStep {
  view: AppView;
  title: string;
  /** One or two sentences. Written for someone seeing the tool for the first time. */
  body: string;
  /** Optional nudge at something to actually click on this tab. */
  action?: string;
}

export const TOUR: TourStep[] = [
  {
    view: 'build',
    title: 'The factory floor',
    body: 'Machines are dragged from the palette and wired with belts. This blueprint has three assembly lines: a governed content factory, an issue triage line, and a perfection loop. Each connected line compiles to one real GitHub Actions workflow.',
    action: 'Click a machine to inspect its configuration and the tools it will be granted.',
  },
  {
    view: 'prompts',
    title: 'What the agents are told',
    body: 'Agent prompts live in the repo at .factory/prompts/, not inside the compiled workflow — so they can be reviewed, versioned and edited without recompiling anything.',
    action: 'Edit a prompt. The change is saved into this demo session only.',
  },
  {
    view: 'content',
    title: 'The cockpit',
    body: 'Config, the content backlog, and the kill switches. Every scheduled line is default-OFF behind a repo variable, so turning the factory on or off is one toggle and no redeploy.',
    action: 'Flip a kill switch and watch the line change state.',
  },
  {
    view: 'docs',
    title: 'The output',
    body: 'The docs collection the content factory tends. Improve, merge, redeploy, and this view updates — the factory is visibly producing something.',
  },
  {
    view: 'monitor',
    title: 'Telemetry',
    body: 'Runs of each compiled line, drillable down to jobs and steps, plus the cron overview. This is the same polling the app does against a real repo; here it reads the demo fleet.',
    action: 'Expand a run to see its jobs, or press Run now on a line.',
  },
  {
    view: 'fleet',
    title: 'Fleet Ops',
    body: 'Observe mode reverse-imports any repo’s workflows into a read-only map. Command mode scans a whole roster and grades it: cost, waste, rework, and a conformance audit against the fleet’s own conventions.',
    action: 'Press Scan fleet, then walk the Districts, Rankings, Workflows, Audit and Schedule boards.',
  },
  {
    view: 'settings',
    title: 'Connecting for real',
    body: 'A fine-grained PAT, checked live against the target repo, is all it takes. The token stays in sessionStorage and never reaches a blueprint, a build, or this page’s storage.',
    action: 'Leave the demo when you are ready to point it at a repo of your own.',
  },
];
