// The delivered-map index (specs/013-archify-console, FR-7). `app/public/maps/manifest.json`
// is written by `npm run maps` beside the maps it describes and byte-checked by `maps:check`;
// importing it at build time (no fetch, golden rule #1) lets a surface say "a delivered map
// exists for exactly this source" — a Build line whose blueprint hash still matches, a demo
// repo's fleet — and link to it. Pure lookups; the URL helper only concatenates.

import type { ThemePref } from '../state/settings';
import manifest from '../../public/maps/manifest.json';

export interface DeliveredMap {
  slug: string;
  type: 'workflow' | 'architecture';
  /** What the map was generated from: a blueprint path or `demo fleet <owner/name>`. */
  source: string;
  /** Blueprint hash (workflow) or IR digest (architecture) at generation time. */
  hash: string;
}

export const DELIVERED_MAPS: readonly DeliveredMap[] = (manifest as { maps: DeliveredMap[] }).maps;

export interface DeliveredMapQuery {
  slug?: string;
  type?: DeliveredMap['type'];
  source?: string;
  /** When given, the entry must carry exactly this hash (a Build line edited since delivery no longer matches). */
  hash?: string;
}

/** The delivered map matching every given field, or null. */
export function deliveredMapFor(
  maps: readonly DeliveredMap[],
  q: DeliveredMapQuery,
): DeliveredMap | null {
  return (
    maps.find(
      (m) =>
        (q.slug === undefined || m.slug === q.slug) &&
        (q.type === undefined || m.type === q.type) &&
        (q.source === undefined || m.source === q.source) &&
        (q.hash === undefined || m.hash === q.hash),
    ) ?? null
  );
}

/** The source string `gen-maps` records for a demo repo's fleet map. */
export const demoFleetSource = (slug: string): string => `demo fleet ${slug}`;

/**
 * URL of a delivered map for embedding or opening. `embed=1` trims the viewer's page chrome;
 * a pinned theme is passed through so the frame matches the app, while `system` passes
 * nothing and the map's own preference detection decides (parity by construction).
 */
export function deliveredMapUrl(
  slug: string,
  opts: { theme?: ThemePref; embed?: boolean; base?: string } = {},
): string {
  const base = opts.base ?? import.meta.env.BASE_URL ?? '/';
  const params: string[] = [];
  if (opts.embed) params.push('embed=1');
  if (opts.theme && opts.theme !== 'system') params.push(`theme=${opts.theme}`);
  return `${base}${base.endsWith('/') ? '' : '/'}maps/${slug}.html${params.length ? `?${params.join('&')}` : ''}`;
}
