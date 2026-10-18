// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { useGithubStore } from '../state/github';
import { useSettingsStore } from '../state/settings';

beforeEach(() => {
  cleanup();
  useSettingsStore.setState({ recentRepos: ['bamr87/gitorio', 'bamr87/lifehacker.dev'], defaultDeployMode: 'pr', pollMs: 15_000, defaultModel: 'claude-sonnet-5-5' });
});

describe('SettingsPanel', () => {
  it('renders preferences from the settings store and updates the poll interval', () => {
    useGithubStore.setState({ login: 'me', repo: { owner: 'bamr87', repo: 'gitorio' }, preflight: null });
    render(<SettingsPanel />);
    const select = screen.getByDisplayValue('15s') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '30000' } });
    expect(useSettingsStore.getState().pollMs).toBe(30_000);
  });

  it('lists remembered repos; Switch is disabled when not connected', () => {
    useGithubStore.setState({ login: null, repo: null, switchRepo: vi.fn() as never });
    render(<SettingsPanel />);
    expect(screen.getByText('bamr87/lifehacker.dev')).toBeTruthy();
    const switches = screen.getAllByRole('button', { name: 'Switch' }) as HTMLButtonElement[];
    expect(switches.every((b) => b.disabled)).toBe(true);
  });

  it('Remove forgets a connection', () => {
    useGithubStore.setState({ login: 'me', repo: { owner: 'bamr87', repo: 'gitorio' } });
    render(<SettingsPanel />);
    const rows = screen.getByText('bamr87/lifehacker.dev').closest('.settings__repo') as HTMLElement;
    fireEvent.click(rows.querySelector('.iconbtn') as HTMLElement);
    expect(useSettingsStore.getState().recentRepos).toEqual(['bamr87/gitorio']);
  });
});
