// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ContentPanel } from './ContentPanel';
import { useContentStore } from '../state/content';
import { useGithubStore } from '../state/github';

afterEach(cleanup);

beforeEach(() => {
  // No client → the mount-time refresh() returns early, leaving the seeded state intact.
  useGithubStore.setState({ login: null, repo: null, client: null as never });
  useContentStore.setState({
    loading: false, error: null, saving: false, prUrl: null, mode: 'pr',
    config: {
      model: 'claude-opus-4-8', maxDailyRuns: 4, brandVoice: 'wry', contentPaths: ['pages/_posts/**'],
      docsDir: '_docs', itemsPerRun: 3,
      reviewCriteria: ['Accuracy: claims match behavior'],
      skills: [{ id: 'tech', name: 'Technical Writer', focus: 'precision' }],
    },
    configSha: 'c1',
    backlog: [{ id: 'a-1', kind: 'post', title: 'Hello world', brief: '', priority: 'high', status: 'todo' }],
    backlogSha: 'b1',
    switches: [{ variable: 'CONTENT_FACTORY_ENABLED', on: false, known: true, busy: false }],
  });
});

describe('ContentPanel', () => {
  it('prompts to connect when signed out', () => {
    render(<ContentPanel />);
    expect(screen.getByText(/Connect a repo/i)).toBeTruthy();
  });

  it('renders the config, backlog, and kill switch when connected', () => {
    useGithubStore.setState({ login: 'me', repo: { owner: 'o', repo: 'r' }, client: null as never });
    render(<ContentPanel />);
    // central config
    expect((screen.getByDisplayValue('claude-opus-4-8') as HTMLSelectElement).tagName).toBe('SELECT');
    expect(screen.getByDisplayValue('wry')).toBeTruthy();
    // backlog row
    expect(screen.getByDisplayValue('Hello world')).toBeTruthy();
    // kill switch
    expect(screen.getByText('CONTENT_FACTORY_ENABLED')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arm' })).toBeTruthy();
    // docs settings + skill specialization + review criterion
    expect(screen.getByDisplayValue('_docs')).toBeTruthy();
    expect(screen.getByDisplayValue('Technical Writer')).toBeTruthy();
    expect(screen.getByDisplayValue('Accuracy: claims match behavior')).toBeTruthy();
  });

  it('adds a skill specialization via the editor', () => {
    useGithubStore.setState({ login: 'me', repo: { owner: 'o', repo: 'r' }, client: null as never });
    render(<ContentPanel />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add skill' }));
    expect(useContentStore.getState().config.skills).toHaveLength(2);
    expect(useContentStore.getState().config.skills[1]).toMatchObject({ name: '', focus: '' });
  });
});
