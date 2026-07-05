// Pure 5-field cron parsing + next-run projection (UTC). No dependencies — used by the
// Monitor tab (per-line schedule preview, overlap warnings) and Prompt Studio's cron
// overview. GitHub Actions cron is standard 5-field UTC: minute hour dom month dow.

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** Whether the raw field was `*` — needed for the standard dom/dow OR rule. */
  domStar: boolean;
  dowStar: boolean;
}

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (7 normalises to 0 = Sunday)
];

function parseField(field: string, min: number, max: number, isDow: boolean): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const [, base, stepRaw] = m;
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let lo = min;
    let hi = max;
    if (base !== '*') {
      const [a, b] = base.split('-').map(Number);
      lo = a;
      hi = b ?? a;
      if (isDow) {
        // cron allows 7 for Sunday
        if (lo === 7) lo = 0;
        if (hi === 7) hi = 0;
      }
      if (lo < min || hi > max || lo > hi) {
        // single value or malformed range
        if (base.includes('-')) return null;
        if (lo < min || lo > max) return null;
        hi = lo;
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

/** Parse a 5-field cron expression; null if malformed. */
export function parseCron(expr: string): CronSpec | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const [min, max] = FIELD_RANGES[i];
    const set = parseField(fields[i], min, max, i === 4);
    if (!set) return null;
    sets.push(set);
  }
  return {
    minute: sets[0],
    hour: sets[1],
    dom: sets[2],
    month: sets[3],
    dow: sets[4],
    domStar: fields[2] === '*',
    dowStar: fields[4] === '*',
  };
}

function matches(spec: CronSpec, d: Date): boolean {
  if (!spec.minute.has(d.getUTCMinutes())) return false;
  if (!spec.hour.has(d.getUTCHours())) return false;
  if (!spec.month.has(d.getUTCMonth() + 1)) return false;
  const domHit = spec.dom.has(d.getUTCDate());
  const dowHit = spec.dow.has(d.getUTCDay());
  // Standard cron rule: when BOTH dom and dow are restricted, either may match (OR);
  // otherwise both apply (the starred one always matches anyway).
  if (!spec.domStar && !spec.dowStar) return domHit || dowHit;
  return domHit && dowHit;
}

/**
 * The next `count` fire times (UTC) strictly after `from`. Scans minute-by-minute with a
 * 366-day horizon — plenty for a preview, and honest about impossible schedules (returns
 * fewer, possibly zero, entries rather than spinning).
 */
export function nextRuns(expr: string, count: number, from: Date = new Date()): Date[] {
  const spec = parseCron(expr);
  if (!spec || count <= 0) return [];
  const out: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1); // strictly after `from`
  const horizon = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (out.length < count && cursor.getTime() <= horizon) {
    if (matches(spec, cursor)) out.push(new Date(cursor.getTime()));
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return out;
}

/**
 * Rough per-day fire count — used to flag heavy/overlapping schedules. Counts matches
 * over one representative UTC day (2026-01-05, a Monday); dom/dow-restricted schedules
 * that skip that day return 0 for it, which is fine for a "heavy schedule" heuristic.
 */
export function firesPerDay(expr: string): number {
  const spec = parseCron(expr);
  if (!spec) return 0;
  let n = 0;
  const d = new Date(Date.UTC(2026, 0, 5, 0, 0, 0));
  for (let i = 0; i < 24 * 60; i++) {
    if (matches(spec, d)) n++;
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return n;
}
