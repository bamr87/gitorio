// The shareable roster link (ADR-038): `?roster=` becomes roster slugs through the same
// parser as the Fleet Ops "add repos" box, junk is dropped, and the link round-trips.

import { describe, expect, it } from 'vitest';
import { parseDeepLink, rosterLink } from './deeplink';

describe('parseDeepLink', () => {
  it('reads tab, hub and a comma-separated roster', () => {
    const d = parseDeepLink('?tab=fleet&hub=bamr87/bamr87&roster=bamr87/lifehacker.dev,bamr87/irony-works');
    expect(d.tab).toBe('fleet');
    expect(d.hub).toBe('bamr87/bamr87');
    expect(d.roster).toEqual(['bamr87/lifehacker.dev', 'bamr87/irony-works']);
  });

  it('accepts repeated params and whitespace, dedupes, drops junk, never throws', () => {
    const d = parseDeepLink('?roster=bamr87/lifehacker.dev%20bamr87/irony-works&roster=bamr87/lifehacker.dev,not-a-slug,,/x');
    expect(d.roster).toEqual(['bamr87/lifehacker.dev', 'bamr87/irony-works']);
    expect(parseDeepLink('').roster).toEqual([]);
    expect(parseDeepLink('?roster=').roster).toEqual([]);
    expect(parseDeepLink('?tab=fleet').tab).toBe('fleet');
  });

  it('round-trips through rosterLink', () => {
    const url = rosterLink('https://bamr87.github.io/gitorio', ['bamr87/lifehacker.dev', 'bamr87/irony-works']);
    expect(url).toBe('https://bamr87.github.io/gitorio/?tab=fleet&roster=bamr87%2Flifehacker.dev%2Cbamr87%2Firony-works');
    const back = parseDeepLink(new URL(url).search);
    expect(back.tab).toBe('fleet');
    expect(back.roster).toEqual(['bamr87/lifehacker.dev', 'bamr87/irony-works']);
  });
});
