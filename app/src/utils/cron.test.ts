import { describe, expect, it } from 'vitest';
import { firesPerDay, nextRuns, parseCron } from './cron';

const at = (iso: string) => new Date(iso);

describe('parseCron', () => {
  it('parses stars, numbers, lists, ranges, and steps', () => {
    const spec = parseCron('*/15 3,9 1-7 * 1')!;
    expect([...spec.minute]).toEqual([0, 15, 30, 45]);
    expect([...spec.hour]).toEqual([3, 9]);
    expect([...spec.dom]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(spec.month.size).toBe(12);
    expect([...spec.dow]).toEqual([1]);
  });

  it('normalises dow 7 to Sunday (0)', () => {
    expect([...parseCron('0 0 * * 7')!.dow]).toEqual([0]);
  });

  it('rejects malformed expressions', () => {
    expect(parseCron('0 3 * *')).toBeNull(); // 4 fields
    expect(parseCron('61 * * * *')).toBeNull(); // out of range
    expect(parseCron('a * * * *')).toBeNull(); // not a number
    expect(parseCron('0 0 * * 1-99')).toBeNull(); // bad range
  });
});

describe('nextRuns', () => {
  it('projects the next daily fires in UTC, strictly after `from`', () => {
    const runs = nextRuns('0 3 * * *', 3, at('2026-07-05T03:00:00Z'));
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-07-06T03:00:00.000Z', // strictly after — same-instant fire excluded
      '2026-07-07T03:00:00.000Z',
      '2026-07-08T03:00:00.000Z',
    ]);
  });

  it('handles weekly (Monday 06:00) — the Dependency Warden schedule', () => {
    // 2026-07-05 is a Sunday.
    const runs = nextRuns('0 6 * * 1', 2, at('2026-07-05T00:00:00Z'));
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-07-06T06:00:00.000Z',
      '2026-07-13T06:00:00.000Z',
    ]);
  });

  it('applies the dom/dow OR rule when both are restricted', () => {
    // Fires on the 15th OR on Mondays. From Sun 2026-07-05: Mon 6th wins first.
    const runs = nextRuns('0 0 15 * 1', 2, at('2026-07-05T00:00:00Z'));
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-07-06T00:00:00.000Z', // Monday
      '2026-07-13T00:00:00.000Z', // next Monday (before the 15th)
    ]);
  });

  it('returns [] for malformed expressions', () => {
    expect(nextRuns('nope', 3)).toEqual([]);
  });
});

describe('firesPerDay', () => {
  it('counts daily volume for heavy-schedule warnings', () => {
    expect(firesPerDay('0 3 * * *')).toBe(1);
    expect(firesPerDay('*/15 * * * *')).toBe(96);
    expect(firesPerDay('nope')).toBe(0);
  });
});
