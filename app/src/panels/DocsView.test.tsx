// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DocsView } from './DocsView';
import { loadDocs } from '../docs/load';

afterEach(cleanup);

describe('DocsView', () => {
  it('loadDocs picks up the seeded _docs collection (outside-root glob resolves)', () => {
    const docs = loadDocs();
    expect(docs.length).toBeGreaterThanOrEqual(3);
    // ordered by frontmatter `order` — the intro doc comes first
    expect(docs[0].title).toBe('What is GitFactory?');
  });

  it('renders the first doc and switches on nav click', () => {
    render(<DocsView />);
    // first doc's title heading rendered from markdown
    expect(screen.getAllByText('What is GitFactory?').length).toBeGreaterThan(0);
    // switch to another doc via the nav
    fireEvent.click(screen.getByRole('button', { name: 'Power and Security' }));
    expect(screen.getAllByText('Power and Security').length).toBeGreaterThan(0);
    // a code span from that doc's markdown renders
    expect(screen.getByText('CLAUDE_CODE_OAUTH_TOKEN')).toBeTruthy();
  });
});
