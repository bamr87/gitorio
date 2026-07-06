// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Menu } from './Menu';

afterEach(cleanup);

describe('Menu', () => {
  it('is closed by default, opens on click, and shows its items', () => {
    render(<Menu label="Blueprint" items={[{ label: 'Export JSON', onClick: () => {} }]} />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Blueprint/ }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Export JSON/ })).toBeTruthy();
  });

  it('invokes the item callback and closes on select', () => {
    const onClick = vi.fn();
    render(<Menu label="Blueprint" items={[{ label: 'Copy string', onClick }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Blueprint/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy string/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Menu label="Blueprint" items={[{ label: 'X', onClick: () => {} }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Blueprint/ }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
