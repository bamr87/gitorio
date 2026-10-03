// @vitest-environment node
// The delivered-map index (specs/013 FR-7, AC-5/AC-6 half): the manifest `gen-maps` writes is
// what the app consults before it links or embeds a map.

import { describe, expect, it } from 'vitest';
import { DELIVERED_MAPS, deliveredMapFor, deliveredMapUrl, demoFleetSource } from './manifest';

describe('delivered-map manifest', () => {
  it('lists the nine dogfood + demo maps with their sources', () => {
    expect(DELIVERED_MAPS.map((m) => m.slug)).toEqual([
      'demo--acme--design-system',
      'demo--acme--infra',
      'demo--acme--storefront',
      'demo--fleet',
      'docs-gardener',
      'gitorio-factory-1',
      'gitorio-factory-2',
      'gitorio-factory-3',
      'gitorio-factory-4',
    ]);
    for (const m of DELIVERED_MAPS) {
      expect(['workflow', 'architecture']).toContain(m.type);
      expect(m.hash).toMatch(/^[0-9a-f]{8,12}$/);
      expect(m.source.length).toBeGreaterThan(0);
    }
  });

  it('resolves by slug, by demo fleet source, and refuses a stale hash', () => {
    expect(deliveredMapFor(DELIVERED_MAPS, { slug: 'docs-gardener' })?.type).toBe('workflow');
    const demo = deliveredMapFor(DELIVERED_MAPS, {
      type: 'architecture',
      source: demoFleetSource('acme/storefront'),
    });
    expect(demo?.slug).toBe('demo--acme--storefront');
    const line = deliveredMapFor(DELIVERED_MAPS, { slug: 'gitorio-factory-1' })!;
    expect(deliveredMapFor(DELIVERED_MAPS, { slug: 'gitorio-factory-1', hash: line.hash })).toBe(
      line,
    );
    expect(
      deliveredMapFor(DELIVERED_MAPS, { slug: 'gitorio-factory-1', hash: 'deadbeef' }),
    ).toBeNull();
    expect(deliveredMapFor(DELIVERED_MAPS, { slug: 'not-a-map' })).toBeNull();
  });

  it('builds embed and open URLs with theme parity', () => {
    expect(deliveredMapUrl('docs-gardener', { base: '/' })).toBe('/maps/docs-gardener.html');
    expect(deliveredMapUrl('docs-gardener', { base: '/gitorio/', embed: true })).toBe(
      '/gitorio/maps/docs-gardener.html?embed=1',
    );
    expect(deliveredMapUrl('docs-gardener', { base: '/', embed: true, theme: 'light' })).toBe(
      '/maps/docs-gardener.html?embed=1&theme=light',
    );
    // `system` passes nothing: the map's own preference detection decides.
    expect(deliveredMapUrl('docs-gardener', { base: '/', theme: 'system' })).toBe(
      '/maps/docs-gardener.html',
    );
    expect(deliveredMapUrl('x', { base: '/no-slash' })).toBe('/no-slash/maps/x.html');
  });
});
