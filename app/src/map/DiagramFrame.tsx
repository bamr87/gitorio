// A delivered archify map, embedded (specs/013, FR-7). The frame loads one of the static maps
// `npm run maps` produced — same origin, no external requests (their fonts link was stripped
// by specs/010) — in the viewer's embed mode, with the app's pinned theme passed through.
// A slug the manifest does not list renders an honest note, never a broken frame.

import './map.css';
import { useSettingsStore } from '../state/settings';
import { DELIVERED_MAPS, deliveredMapFor, deliveredMapUrl } from './manifest';

export function DiagramFrame({
  slug,
  caption,
  height = 520,
}: {
  slug: string;
  caption?: string;
  height?: number;
}) {
  const theme = useSettingsStore((s) => s.theme);
  const map = deliveredMapFor(DELIVERED_MAPS, { slug });
  if (!map) {
    return (
      <p className="mapframe mapframe--missing" role="note">
        Map <code>{slug}</code> is not delivered — run <code>npm run maps</code> to generate it.
      </p>
    );
  }
  const src = deliveredMapUrl(slug, { theme, embed: true });
  const open = deliveredMapUrl(slug, { theme });
  const title = caption ?? `${map.type} map · ${map.source}`;
  return (
    <figure className="mapframe">
      <iframe src={src} title={title} loading="lazy" style={{ height }} />
      <figcaption className="mapframe__caption">
        <span className="tone-dot tone-dot--frontend" aria-hidden />
        <span>{title}</span>
        <a href={open} target="_blank" rel="noreferrer">
          Open the delivered map ↗
        </a>
      </figcaption>
    </figure>
  );
}
