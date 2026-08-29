import { describe, expect, it } from 'vitest';
import { MACHINES } from '../machines/registry';
import { LANES, LEGEND, VOCABULARY, unmappedMachineTypes, vocabularyFor } from './vocabulary';

describe('archify vocabulary (specs/010 FR-2, AC-2)', () => {
  it('maps every registry machine type — drift guard', () => {
    expect(unmappedMachineTypes()).toEqual([]);
  });

  it('has no entries for machine types that no longer exist', () => {
    const known = new Set(MACHINES.map((m) => m.type));
    expect(Object.keys(VOCABULARY).filter((t) => !known.has(t))).toEqual([]);
  });

  it('keeps labels within the 12-character node budget and lanes within LANES', () => {
    const lanes = new Set(LANES.map((l) => l.id));
    for (const [type, entry] of Object.entries(VOCABULARY)) {
      expect(entry.label.length, type).toBeLessThanOrEqual(12);
      expect(lanes.has(entry.lane), type).toBe(true);
      expect(LEGEND[entry.component], type).toBeTruthy();
    }
  });

  it('agrees with the registry category on which lane a machine sits in', () => {
    for (const m of MACHINES) {
      const lane = VOCABULARY[m.type].lane;
      if (m.category === 'trigger') expect(lane, m.type).toBe('triggers');
      if (m.category === 'sink') expect(lane, m.type).toBe('sinks');
      if (m.category === 'processor') expect(['policy', 'agent'], m.type).toContain(lane);
    }
  });

  it('falls back by prefix for unknown types', () => {
    expect(vocabularyFor('trigger.future_event').lane).toBe('triggers');
    expect(vocabularyFor('gate.future_thing').component).toBe('security');
    expect(vocabularyFor('sink.future_output').lane).toBe('sinks');
    expect(vocabularyFor('mystery').lane).toBe('agent');
    expect(vocabularyFor('sink.a_very_long_machine_name').label.length).toBeLessThanOrEqual(12);
  });
});
