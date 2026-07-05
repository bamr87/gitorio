// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TemplateGallery } from './TemplateGallery';
import { TEMPLATES } from '../templates/catalog';
import { useFactoryStore } from '../state/store';

describe('TemplateGallery', () => {
  it('renders every template with a machine count', () => {
    render(<TemplateGallery onClose={() => {}} />);
    for (const t of TEMPLATES) expect(screen.getByText(t.name)).toBeTruthy();
    expect(screen.getAllByText(/Stamp onto floor/).length).toBe(TEMPLATES.length);
    cleanup();
  });

  it('stamping loads the blueprint onto the canvas and closes', () => {
    const onClose = vi.fn();
    render(<TemplateGallery onClose={onClose} />);
    const warden = TEMPLATES.find((t) => t.id === 'dependency-warden')!;

    // Click the Stamp button inside the Warden card.
    const card = screen.getByText(warden.name).closest('.tpl') as HTMLElement;
    fireEvent.click(card.querySelector('button.btn') as HTMLElement);

    const nodes = useFactoryStore.getState().nodes;
    expect(nodes.length).toBe(warden.blueprint.nodes.length);
    expect(useFactoryStore.getState().meta.name).toBe('Dependency Warden');
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});
