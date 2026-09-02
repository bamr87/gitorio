// @vitest-environment node
// The hub reader over the real hub's files (specs/014 AC-1/AC-2): bamr87/bamr87's committed
// harness_health.yml, read back through `readHub`, re-derives with no differences — the
// Harness tab's "matches the hub" note is earned, not asserted.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRepo, type GithubClient } from '../github/types';
import { compareHealth, readHub } from '../harness/hubread';
import { HUB_PATHS, signalPath } from './hub';

const DIR = fileURLToPath(new URL('../harness/fixtures/hub/', import.meta.url));
const fixture = (name: string): string => readFileSync(join(DIR, name), 'utf8');

/** A client that serves the hub fixtures under the hub's real paths and nothing else. */
function fixtureClient(files: Record<string, string>): GithubClient {
  return {
    getFile: async (_repo: unknown, path: string) =>
      path in files ? { path, content: files[path], sha: 'fixture' } : null,
  } as unknown as GithubClient;
}

describe('readHub over the real hub fixtures', () => {
  const files: Record<string, string> = {
    [HUB_PATHS.config]: fixture('fleet-harness.yml'),
    [HUB_PATHS.health]: fixture('harness_health.yml'),
    [signalPath('actions_usage')]: fixture('actions_usage.yml'),
    [signalPath('fleet_triage')]: fixture('fleet_triage.yml'),
    [signalPath('issue_pipeline')]: fixture('issue_pipeline.yml'),
    [signalPath('token_rotation')]: fixture('token_rotation.yml'),
    [HUB_PATHS.pulse]: "on:\n  schedule:\n    - cron: '0 6 * * *'   # daily\n",
  };

  it('re-derives the committed file with no differences', async () => {
    const snap = await readHub(fixtureClient(files), parseRepo('bamr87/bamr87')!, new Date('2026-09-02T00:00:00Z'));
    expect(snap.committed).toBeTruthy();
    expect(snap.parity).toEqual([]);
    expect(snap.recomputed.generated_at).toBe(snap.committed!.generated_at);
    expect(snap.recomputed.tripped_count).toBe(snap.committed!.tripped_count);
    expect(snap.pulseCron).toBe('0 6 * * *');
    expect(snap.manifest).toBeNull();
    expect(snap.found[HUB_PATHS.manifest]).toBe(false);
  });

  it('a hub with signals but no health file still yields a derived health; an empty hub yields neither', async () => {
    const { [HUB_PATHS.health]: _health, ...withoutHealth } = files;
    void _health;
    const derived = await readHub(fixtureClient(withoutHealth), parseRepo('bamr87/bamr87')!);
    expect(derived.committed).toBeNull();
    expect(derived.parity).toEqual([]);
    expect(derived.recomputed.scorecard.completion_rate_pct.value).toBe(88.2);

    const empty = await readHub(fixtureClient({}), parseRepo('acme/nothing')!);
    expect(empty.committed).toBeNull();
    expect(Object.values(empty.found).every((v) => v === false)).toBe(true);
    expect(empty.recomputed.sources.actions_usage.present).toBe(false);
    expect(empty.recomputed.trip_wires.find((w) => w.id === 'stale-data')!.tripped).toBe(true);
  });

  it('compareHealth names what moved', async () => {
    const snap = await readHub(fixtureClient(files), parseRepo('bamr87/bamr87')!);
    const moved = structuredClone(snap.recomputed);
    moved.scorecard.standing_failures.value = 99;
    moved.trip_wires[1].tripped = !moved.trip_wires[1].tripped;
    const diffs = compareHealth(snap.committed!, moved);
    expect(diffs.map((d) => d.where)).toEqual([
      'scorecard.standing_failures.value',
      `trip_wires.${moved.trip_wires[1].id}.tripped`,
    ]);
  });
});
