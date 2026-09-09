// Deep links — the one URL an operator bookmarks. `?tab=` picks the view, `?hub=` overrides
// the hub for the session, `?demo=1` seats the demo client, and (ADR-038) `?roster=` adds
// repos to the Fleet Ops roster so a fleet can be shared as a link:
//   /?tab=fleet&roster=bamr87/lifehacker.dev,bamr87/irony-works
// Pure: parses `location.search`; the stores are wired in App. Slugs are validated by the
// same parser the roster box uses (`parseRosterText`), so junk never reaches the store.

import { parseRosterText } from '../fleet/manifest';

export interface DeepLink {
  /** `?tab=` as given (App checks it against its own view ids). */
  tab: string | null;
  /** `?hub=owner/repo` — a session-only hub override. */
  hub: string | null;
  /** `?roster=` — valid `owner/repo` slugs, deduped, in URL order. */
  roster: string[];
}

/** Parse the deep-link params out of a `location.search` string. Never throws. */
export function parseDeepLink(search: string): DeepLink {
  const params = new URLSearchParams(search);
  const rawRoster = params.getAll('roster').join(' ');
  return {
    tab: params.get('tab'),
    hub: params.get('hub'),
    roster: parseRosterText(rawRoster).map((r) => r.slug),
  };
}

/** The shareable link for a roster (and optionally a tab) on this deployment. */
export function rosterLink(base: string, slugs: string[], tab = 'fleet'): string {
  const params = new URLSearchParams({ tab, roster: slugs.join(',') });
  return `${base.replace(/\/?$/, '/')}?${params.toString()}`;
}
