// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BuildToolbar } from './BuildToolbar';
import { useFactoryStore } from '../state/store';

afterEach(cleanup);

const noop = () => {};
const props = {
  onTemplates: noop, onImportFile: noop, onImportString: noop, onExport: noop,
  onCopyString: noop, onDeploy: noop, canDeploy: false, loggedIn: false,
  showTelemetry: false, onToggleTelemetry: noop,
  mode: 'floor' as const, onMode: noop, finderOpen: false, onFinder: noop,
  passportOpen: false, onPassport: noop,
};

beforeEach(() => {
  useFactoryStore.setState({ canUndo: false, canRedo: false });
});

describe('BuildToolbar', () => {
  it('shows Templates, the Blueprint menu, and Deploy; hides LEDs when logged out', () => {
    render(<BuildToolbar {...props} />);
    expect(screen.getByRole('button', { name: /Templates/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Blueprint/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Deploy/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /LEDs/ })).toBeNull();
  });

  it('shows the LEDs toggle only when logged in', () => {
    render(<BuildToolbar {...props} loggedIn />);
    expect(screen.getByRole('button', { name: /LEDs/ })).toBeTruthy();
  });

  it('disables Deploy until canDeploy, and undo/redo track store state', () => {
    const onDeploy = vi.fn();
    const { rerender } = render(<BuildToolbar {...props} onDeploy={onDeploy} />);
    const deploy = screen.getByRole('button', { name: /Deploy/ }) as HTMLButtonElement;
    expect(deploy.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '↶' }) as HTMLButtonElement).disabled).toBe(true);

    useFactoryStore.setState({ canUndo: true });
    rerender(<BuildToolbar {...props} onDeploy={onDeploy} canDeploy />);
    expect((screen.getByRole('button', { name: /Deploy/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '↶' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Deploy/ }));
    expect(onDeploy).toHaveBeenCalled();
  });
});

describe('BuildToolbar — console controls (specs/013 FR-5)', () => {
  it('offers Floor | Map, the Machine Finder on the floor only, and the blueprint passport', () => {
    const onMode = vi.fn();
    const onFinder = vi.fn();
    const onPassport = vi.fn();
    const { rerender } = render(
      <BuildToolbar {...props} onMode={onMode} onFinder={onFinder} onPassport={onPassport} />,
    );
    const floor = screen.getByRole('button', { name: /Floor/ });
    const map = screen.getByRole('button', { name: /Map/ });
    expect(floor.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(map);
    expect(onMode).toHaveBeenCalledWith('map');
    fireEvent.click(screen.getByRole('button', { name: /\+ Machine/ }));
    expect(onFinder).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/Blueprint passport/));
    expect(onPassport).toHaveBeenCalled();
    rerender(<BuildToolbar {...props} mode="map" onMode={onMode} />);
    expect(screen.queryByRole('button', { name: /\+ Machine/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Map/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
