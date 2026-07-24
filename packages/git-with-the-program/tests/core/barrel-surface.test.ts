// Implements tests for: docs/adr/0003-judge-blindness.md, docs/spec/03-judge.md §2, INV-003
// clause 1 and 2 — the RUNTIME half of the boundary that src/core/index.ts declares.
//
// WHY THIS FILE EXISTS
//
// `Blind<T>` proves that a sentencing VALUE cannot sit in an evidence bundle. It proves
// nothing about a plain `number` that a declassifier handed back on the other side of the
// boundary. The three declassifiers used to be reachable through the barrel and used to mint
// their own warrant, so this compiled, with no deep import anywhere:
//
//     import { toAccumulatorSnapshot } from '../core/index.js';
//     const meter: number = toAccumulatorSnapshot(state).value;   // 2.67, in a plain number
//
// tsc cannot catch that: the value is a number by the time it is named. The only thing that
// can is the EXPORT SURFACE, which is data, and data is testable. So this file asserts the
// surface itself: what the barrel hands out, and what it must never hand out.
//
// A future `export * from './accumulator.js'` fails here, by name, with a message saying why.

import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/core/index.js';
import * as accumulator from '../../src/core/accumulator.js';
import * as dispersion from '../../src/core/dispersion.js';
import * as sentencing from '../../src/core/sentencing.js';

/**
 * Every VALUE whose signature crosses the INV-003 boundary in the untainting direction, or
 * which mints the warrant that authorises one. None may be reachable from `src/core/index.js`.
 *
 * Two groups, for two different reasons:
 *   - sentencing.ts: constructors and revealers for `ActorId` / `Surprise`, plus the warrant
 *     issuer and the raw symbols a forger would need.
 *   - accumulator.ts / dispersion.ts: the DECLASSIFIERS — functions returning plain `number`s
 *     (or records of them) computed from sentencing values.
 */
const MUST_NOT_BE_REACHABLE_FROM_BARREL = [
  // sentencing.ts — identity and the meter
  'actorId',
  'revealActor',
  'actorGroupKey',
  'surprise',
  'parseSurprise',
  'revealSurprise',
  'addSurprise',
  'scaleSurprise',
  'surpriseFrom',
  'compareSurprise',
  'surpriseReachesBudget',
  'surpriseBelowFraction',
  'withSentencingWarrant',
  'blindCommit',
  'isSentencingValue',
  'SENTENCING_TAG',
  'SENTENCING_WARRANT',
  'ZERO_SURPRISE',
  // accumulator.ts / dispersion.ts — the declassifiers
  'rawSurprise',
  'toAccumulatorSnapshot',
  'computeDispersion',
  'toDispersionSnapshot',
] as const;

/**
 * The values SEED-02's fold is promised by src/ledger/index.ts's header. If the withholding
 * above ever over-reaches and takes these with it, the barrel stops being usable and someone
 * "fixes" it with `export *` — which is exactly the regression this file guards. So the
 * counter-assertion is as load-bearing as the assertion.
 */
const MUST_REMAIN_REACHABLE_FROM_BARREL = [
  'decayFactor',
  'decay',
  'accumulatorStep',
  'surpriseOf',
  'decayStateTo',
  'emptyAccumulator',
  'shouldFire',
  'rearm',
  'knobsDigest',
  'ARMED',
  'REARM_FRACTION_DEFAULT',
  'shannonEntropy',
] as const;

const barrelKeys = new Set(Object.keys(barrel));

describe('src/core/index.ts export surface (INV-003)', () => {
  it('is non-trivial — the test would pass vacuously on an empty barrel', () => {
    expect(barrelKeys.size).toBeGreaterThan(100);
  });

  it.each(MUST_NOT_BE_REACHABLE_FROM_BARREL)(
    'does not re-export `%s` (a deep import is required, and it is what the prescreen greps for)',
    (name) => {
      expect(barrelKeys.has(name)).toBe(false);
    },
  );

  it.each(MUST_REMAIN_REACHABLE_FROM_BARREL)('still re-exports `%s` for src/ledger', (name) => {
    expect(barrelKeys.has(name)).toBe(true);
  });

  it('every withheld name really exists in the module it was withheld from', () => {
    // Guards the other failure mode: a typo in the list above would make the ban vacuous.
    const deep = new Set([
      ...Object.keys(sentencing),
      ...Object.keys(accumulator),
      ...Object.keys(dispersion),
    ]);
    for (const name of MUST_NOT_BE_REACHABLE_FROM_BARREL) {
      expect(deep.has(name)).toBe(true);
    }
  });

  it('exports no value from the barrel that carries the runtime sentencing tag', () => {
    for (const [name, value] of Object.entries(barrel)) {
      if (typeof value !== 'object' || value === null) continue;
      expect(
        Object.prototype.hasOwnProperty.call(value, sentencing.SENTENCING_TAG),
        `barrel export \`${name}\` is a sentencing value`,
      ).toBe(false);
    }
  });
});

describe('the declassifiers take the warrant from their caller', () => {
  // `Function.length` counts parameters before the first default/rest. A declassifier that
  // stops requiring a warrant loses an argument here, and this fails — the arity IS the check,
  // because the warrant type is erased at runtime.
  it('rawSurprise takes (event, precisionOverride, warrant)', () => {
    expect(accumulator.rawSurprise.length).toBe(3);
  });

  it('toAccumulatorSnapshot takes (state, warrant)', () => {
    expect(accumulator.toAccumulatorSnapshot.length).toBe(2);
  });

  it('computeDispersion takes (input, warrant)', () => {
    expect(dispersion.computeDispersion.length).toBe(2);
  });

  it('toDispersionSnapshot takes (stats, warrant)', () => {
    expect(dispersion.toDispersionSnapshot.length).toBe(2);
  });

  it('none of them mints its own warrant', async () => {
    // The textual half: `withSentencingWarrant` must appear in exactly one module of src/core.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../src/core/', import.meta.url));
    for (const file of ['accumulator.ts', 'dispersion.ts']) {
      const src = readFileSync(root + file, 'utf8');
      expect(src.includes('withSentencingWarrant('), `${file} mints a warrant`).toBe(false);
    }
  });
});
