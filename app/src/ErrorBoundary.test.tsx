// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('gear seized');
}

beforeEach(() => {
  // React logs caught render errors loudly; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>factory floor</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('factory floor')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('catches a render crash and shows the fault with the error message + reload hint', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Line jam/)).toBeTruthy();
    expect(screen.getByText(/gear seized/)).toBeTruthy();
    expect(screen.getByText(/Reload to restart the line/)).toBeTruthy();
  });

  it('offers a reload button that restarts the line', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Restart the line/ }));
    expect(reload).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});
