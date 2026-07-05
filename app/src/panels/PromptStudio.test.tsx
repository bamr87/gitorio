// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PromptStudio } from './PromptStudio';
import { useGithubStore } from '../state/github';
import { usePromptsStore } from '../state/prompts';

function fakeClient(fileContent: string) {
  return {
    login: 'me',
    listDir: vi.fn(async () => [
      { path: '.factory/prompts/triage.md', name: 'triage.md', sha: 'a', type: 'file' as const },
      { path: '.factory/prompts/notes.txt', name: 'notes.txt', sha: 'b', type: 'file' as const },
    ]),
    getFile: vi.fn(async () => ({ path: '.factory/prompts/triage.md', content: fileContent, sha: 'a' })),
    putFile: vi.fn(async () => {}),
    getDefaultBranch: vi.fn(async () => 'main'),
    createBranch: vi.fn(async () => {}),
    createPullRequest: vi.fn(async () => 'https://github.com/o/r/pull/1'),
  };
}

const CLEAN = `---\ntitle: Triage\n---\nOBLIGATIONS: label it. untrusted input note.`;

beforeEach(() => {
  cleanup();
  usePromptsStore.setState({ files: [], selectedPath: null, content: '', draft: '', sha: null, error: null, prUrl: null, mode: 'pr' });
});

describe('PromptStudio', () => {
  it('lists only .md prompts from the client', async () => {
    useGithubStore.setState({ client: fakeClient(CLEAN) as never, repo: { owner: 'o', repo: 'r' }, login: 'me' });
    render(<PromptStudio />);
    await waitFor(() => expect(screen.getByText('triage.md')).toBeTruthy());
    expect(screen.queryByText('notes.txt')).toBeNull(); // non-.md filtered out
  });

  it('opening a file shows the editor; a secret in the body flags a lint error and disables Save', async () => {
    const withSecret = `${CLEAN}\ntoken ghp_ABCDEFGHIJKLMNOPQRSTUVWX1234567890`;
    useGithubStore.setState({ client: fakeClient(withSecret) as never, repo: { owner: 'o', repo: 'r' }, login: 'me' });
    render(<PromptStudio />);
    await waitFor(() => expect(screen.getByText('triage.md')).toBeTruthy());
    fireEvent.click(screen.getByText('triage.md'));
    await waitFor(() => expect(screen.getByText('.factory/prompts/triage.md')).toBeTruthy());
    // lint error surfaced
    expect(screen.getByText(/key-like secret/)).toBeTruthy();
    // Save (Open PR) disabled — content is unchanged (not dirty) AND lint has an error
    const saveBtn = screen.getByRole('button', { name: /Open PR/ }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('editing the body clears an error and enables Save', async () => {
    useGithubStore.setState({ client: fakeClient(CLEAN) as never, repo: { owner: 'o', repo: 'r' }, login: 'me' });
    render(<PromptStudio />);
    await waitFor(() => expect(screen.getByText('triage.md')).toBeTruthy());
    fireEvent.click(screen.getByText('triage.md'));
    await waitFor(() => expect(screen.getByText('.factory/prompts/triage.md')).toBeTruthy());
    const body = document.querySelector('.ps__body') as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: 'OBLIGATIONS: label it and comment. untrusted input note.' } });
    const saveBtn = screen.getByRole('button', { name: /Open PR/ }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });
});
