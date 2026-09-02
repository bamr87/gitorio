// The Blueprint passport's Lanes section (specs/014, FR-7): each assembly line as the fleet/v1
// lane its `fleet.manifest.yml` would record. A chunk of its own so the floor's first paint
// does not carry the lane vocabulary (NFR-STATIC-1); the passport lazy-loads it.

import { useMemo } from 'react';
import type { Blueprint } from '../blueprint/types';
import { HarnessCard } from '../harness/HarnessCard';
import { toFleetLanes } from '../harness/lanes';

export function BlueprintLanes({ blueprint }: { blueprint: Blueprint }) {
  const lanes = useMemo(() => toFleetLanes(blueprint), [blueprint]);
  if (lanes.length === 0) return null;
  return (
    <div className="passport__section">
      <span className="passport__label">Lanes · fleet/v1</span>
      <p className="passport__note">
        What the hub&apos;s <code>fleet.manifest.yml</code> records for each line — id, harness, switch,
        tokens, guardrails — the same card the Harness tab and Fleet Observe show.
      </p>
      <div className="lanes lanes--stack">
        {lanes.map((lane) => (
          <HarnessCard key={lane.id} lane={lane} compact />
        ))}
      </div>
    </div>
  );
}
