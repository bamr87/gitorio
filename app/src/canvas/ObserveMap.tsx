// Fleet Observe on the map (specs/013, FR-6): the observed fleet as the archify architecture
// map it would be delivered as, live from `toArchitectureIR` with the observe store's run
// status riding on the nodes as evidence beacons and a workflow passport per node.

import { useMemo } from 'react';
import { fleetComponentId, toArchitectureIR } from '../archify/ir';
import type { Fleet, ImportedWorkflow } from '../fleet/types';
import { HarnessCard } from '../harness/HarnessCard';
import { repoSlug } from '../github/types';
import { layoutArchitecture } from '../map/layout';
import { DELIVERED_MAPS, deliveredMapFor, deliveredMapUrl, demoFleetSource } from '../map/manifest';
import { MapView, type Beacon } from '../map/MapView';
import type { PassportSection } from '../map/Passport';
import { useFleetStore } from '../state/fleet';
import { useSettingsStore } from '../state/settings';

const LED_BEACON: Record<string, Beacon> = {
  on: { label: 'ok', tone: 'ok', title: 'Last run: success' },
  warn: { label: 'run', tone: 'warn', title: 'Run in progress' },
  bad: { label: 'fail', tone: 'bad', title: 'Last run: failed' },
  idle: { label: 'idle', tone: 'idle', title: 'No recent run' },
};

const RUNNER_WORD: Record<NonNullable<ImportedWorkflow['agent']>['runner'], string> = {
  'claude-run': 'claude-run composite',
  'claude-code-action': 'anthropics/claude-code-action',
  'run-sh': 'run.sh wrapper',
  unknown: 'unknown runner',
};

/** The observed fleet as an archify architecture map, with the store's run status as beacons. */
export function ObserveMap({ fleet }: { fleet: Fleet }) {
  const statusByPath = useFleetStore((s) => s.statusByPath);
  const runs = useFleetStore((s) => s.runs);
  const theme = useSettingsStore((s) => s.theme);
  const slug = repoSlug(fleet.repo);

  const { geometry, byId } = useMemo(() => {
    // An in-app map has no 12-node story budget: every workflow gets a node (FR-6).
    const ir = toArchitectureIR(fleet, { cap: Math.max(12, fleet.workflows.length) });
    const byId = new Map(fleet.workflows.map((w) => [fleetComponentId(slug, w.slug), w]));
    return { geometry: layoutArchitecture(ir), byId };
  }, [fleet, slug]);

  const beacons: Record<string, Beacon> = {};
  for (const [id, w] of byId) {
    const led = statusByPath[w.path];
    if (led) beacons[id] = LED_BEACON[led];
  }

  const describe = (id: string): PassportSection[] => {
    const w = byId.get(id);
    if (!w) {
      return [
        {
          kind: 'note',
          text: 'An external repository this fleet writes to across the boundary. Its own workflows are not part of this map.',
        },
      ];
    }
    const sections: PassportSection[] = [
      {
        kind: 'facts',
        title: 'Workflow',
        rows: [
          { label: 'name', value: w.name },
          { label: 'file', value: w.path },
          {
            label: 'triggers',
            value:
              w.triggers.map((t) => (t.detail ? `${t.kind} (${t.detail})` : t.kind)).join(' · ') ||
              '—',
          },
          ...(w.runAfterNames.length
            ? [{ label: 'runs after', value: w.runAfterNames.join(', ') }]
            : []),
          ...(w.gate ? [{ label: 'kill switch', value: `vars.${w.gate}` }] : []),
        ],
      },
    ];
    if (w.lane) {
      // The lane the repo's fleet.manifest.yml records — the same card the hub presents (specs/014 FR-7).
      sections.push({
        kind: 'custom',
        title: 'Lane · fleet/v1',
        node: <HarnessCard lane={w.lane} compact />,
      });
    }
    if (w.hasAgent && w.agent) {
      sections.push({
        kind: 'facts',
        title: 'Agent',
        rows: [
          { label: 'runner', value: RUNNER_WORD[w.agent.runner] },
          ...(w.agent.agentName ? [{ label: 'role', value: w.agent.agentName }] : []),
          ...(w.agent.model ? [{ label: 'model', value: w.agent.model }] : []),
          ...(w.agent.tools ? [{ label: 'tools', value: w.agent.tools }] : []),
        ],
      });
    }
    sections.push({
      kind: 'chips',
      title: 'Writes',
      chips: w.sinks.length
        ? w.sinks.map((s) => ({
            label: s.replace(/_/g, ' '),
            tone: s === 'cross_repo_issue' ? ('cloud' as const) : ('frontend' as const),
          }))
        : [{ label: 'read-only', tone: 'idle' as const }],
    });
    if (w.crossRepoTargets.length) {
      sections.push({
        kind: 'chips',
        title: 'Cross-repo targets',
        chips: w.crossRepoTargets.map((r) => ({ label: r, tone: 'cloud' as const })),
      });
    }
    const latest = runs
      .filter((r) => r.path === w.path)
      .sort((a, b) =>
        a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : b.runId - a.runId,
      )[0];
    const led = statusByPath[w.path];
    if (latest || led) {
      sections.push({
        kind: 'facts',
        title: 'Telemetry',
        rows: [
          { label: 'status', value: LED_BEACON[led ?? 'idle'].title ?? led },
          ...(latest
            ? [
                {
                  label: 'last run',
                  value: `${latest.event} · ${latest.status}${latest.conclusion ? ` · ${latest.conclusion}` : ''}`,
                },
              ]
            : []),
        ],
      });
      if (latest) sections.push({ kind: 'action', label: 'Open last run ↗', href: latest.htmlUrl });
    }
    return sections;
  };

  const delivered = deliveredMapFor(DELIVERED_MAPS, {
    type: 'architecture',
    source: demoFleetSource(slug),
  });

  return (
    <MapView
      geometry={geometry}
      beacons={beacons}
      describe={describe}
      compact
      passportEyebrow="Workflow passport"
      ariaLabel={`${slug} fleet map`}
      actions={
        delivered ? (
          <a
            href={deliveredMapUrl(delivered.slug, { theme })}
            target="_blank"
            rel="noreferrer"
            title="The map archify delivered for this fleet — route probe, exports, presentation"
          >
            Open delivered map ↗
          </a>
        ) : undefined
      }
    />
  );
}
