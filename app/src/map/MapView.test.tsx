// @vitest-environment jsdom
// The in-app map surface (specs/013-archify-console, AC-2): one semantic node per IR node,
// a legend of the kinds present, and archify's reader model — `/` finder, focus → passport,
// authored reachability, guided views, Escape order.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_BLUEPRINT } from '../blueprint/example';
import { assemblyLines } from '../compiler/compile';
import { toWorkflowIR } from '../archify/ir';
import { layoutWorkflow } from './layout';
import { MapView } from './MapView';

afterEach(cleanup);

const bp = EXAMPLE_BLUEPRINT;
// The example's first line is loop-prone (issue trigger → agent → label + comment), so it
// carries the exception lane, a security edge, and two guided views — the richest map to
// assert on.
const line = assemblyLines(bp)[0];
const ir = toWorkflowIR(bp, line, { source: 'example' });
const geometry = layoutWorkflow(ir);

describe('MapView', () => {
  it('renders one semantic node per IR node, the frames, and a legend of the kinds present', () => {
    const { container } = render(<MapView geometry={geometry} />);
    for (const n of ir.nodes) {
      const g = container.querySelector(`g.map-node.c-${n.type}[data-id="${n.id}"]`);
      expect(g, n.id).toBeTruthy();
      expect(g!.textContent).toContain(n.label);
    }
    expect(container.querySelectorAll('.map-frame--lane').length).toBe(ir.lanes.length);
    expect(container.querySelector('.map-frame--exception')).toBeTruthy();
    const legend = screen.getByRole('list', { name: 'Legend' });
    const kinds = new Set(ir.nodes.map((n) => n.type));
    expect(within(legend).getAllByRole('listitem').length).toBe(kinds.size + 1); // + main path
    expect(within(legend).getByText('Trigger')).toBeTruthy();
    expect(screen.getByRole('heading', { name: ir.meta.title })).toBeTruthy();
  });

  it('paints the security belt into the guard lane and the main path in emphasis', () => {
    const { container } = render(<MapView geometry={geometry} compact />);
    expect(container.querySelector('.map-edge--security')).toBeTruthy();
    expect(container.querySelectorAll('.map-edge--role-main').length).toBe(
      geometry.mainPath.length - 1,
    );
    expect(screen.queryByRole('heading')).toBeNull(); // compact hides the title block
  });

  it('opens the finder on `/`, filters, and focuses the chosen node into a passport', () => {
    const { container } = render(<MapView geometry={geometry} />);
    const root = container.querySelector('.map') as HTMLElement;
    fireEvent.keyDown(root, { key: '/' });
    const finder = screen.getByRole('dialog', { name: 'Node finder' });
    const input = within(finder).getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'guard' } });
    const options = within(finder).getAllByRole('option');
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain('Bot guard');
    fireEvent.keyDown(finder, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Node finder' })).toBeNull();
    const passport = screen.getByRole('region', { name: /Semantic passport: Bot guard/ });
    expect(within(passport).getByText('guard-bot-actor')).toBeTruthy();
    expect(within(passport).getByText('Gate / guard')).toBeTruthy();
    // Escape closes the passport (nothing else is open).
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /Semantic passport/ })).toBeNull();
  });

  it('click focuses, the passport traces authored reach, and the receipt counts hops', () => {
    const { container } = render(<MapView geometry={geometry} />);
    const trigger = geometry.nodes.find((n) => n.frame === 'lane-triggers')!;
    fireEvent.click(container.querySelector(`[data-id="${trigger.id}"]`)!);
    const passport = screen.getByRole('region', { name: new RegExp(trigger.label) });
    const down = within(passport).getByRole('button', { name: /Downstream/ });
    fireEvent.click(down);
    expect(down.getAttribute('aria-pressed')).toBe('true');
    expect(
      within(passport).getByText(/downstream · \d+ nodes? · \d+ links? · \d+ hops? max/),
    ).toBeTruthy();
    // Reach recedes everything outside the subgraph; the origin never dims.
    expect(
      container.querySelector(`[data-id="${trigger.id}"]`)!.getAttribute('class'),
    ).not.toContain('is-dim');
    expect(container.querySelector('.map-node.is-reach-down')).toBeTruthy();
    // Upstream from a trigger is empty → its button is disabled.
    expect(
      (within(passport).getByRole('button', { name: /Upstream/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('guided views keep the chapter strong and let the rest recede; beacons carry text', () => {
    const beacons = {
      [geometry.nodes[0].id]: { label: 'ok', tone: 'ok' as const, title: 'Last run: success' },
    };
    const { container } = render(<MapView geometry={geometry} beacons={beacons} />);
    const views = screen.getByRole('group', { name: 'Guided views' });
    const loop = within(views).getByRole('button', { name: 'Loop guard' });
    fireEvent.click(loop);
    expect(loop.getAttribute('aria-pressed')).toBe('true');
    const chapter = geometry.views.find((v) => v.id === 'loop-guard')!;
    for (const n of geometry.nodes) {
      const dimmed = container
        .querySelector(`[data-id="${n.id}"]`)!
        .getAttribute('class')!
        .includes('is-dim');
      expect(dimmed, n.id).toBe(!chapter.focus.includes(n.id));
    }
    const beacon = container.querySelector('.map-beacon--ok text');
    expect(beacon?.textContent).toBe('ok');
    expect(
      container.querySelector(`[data-id="${geometry.nodes[0].id}"]`)!.getAttribute('aria-label'),
    ).toContain('Last run: success');
  });

  it('host sections and controlled focus: describe() feeds the passport, onFocus reports', () => {
    const onFocus = vi.fn();
    const describe = (id: string) => [
      { kind: 'facts' as const, title: 'Dials', rows: [{ label: 'id', value: id }] },
      { kind: 'action' as const, label: 'Edit on the floor', onClick: vi.fn() },
    ];
    const node = geometry.nodes[1];
    render(
      <MapView
        geometry={geometry}
        focusId={node.id}
        onFocus={onFocus}
        describe={describe}
        passportEyebrow="Machine passport"
      />,
    );
    const passport = screen.getByRole('region', { name: `Machine passport: ${node.label}` });
    expect(within(passport).getByText('Dials')).toBeTruthy();
    expect(within(passport).getByRole('button', { name: 'Edit on the floor' })).toBeTruthy();
    fireEvent.click(within(passport).getByRole('button', { name: 'Close passport' }));
    expect(onFocus).toHaveBeenCalledWith(null);
  });

  it('zoom nav steps the SVG width and resets to 100%', () => {
    const { container } = render(<MapView geometry={geometry} />);
    const svg = container.querySelector('svg.map__svg') as SVGSVGElement;
    expect(svg.style.width).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(svg.style.width).toBe('125%');
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(svg.style.width).toBe('100%');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${geometry.width} ${geometry.height}`);
  });
});
