import './promptstudio.css';
import { useEffect, useMemo, useState } from 'react';
import { usePromptsStore } from '../state/prompts';
import { useGithubStore } from '../state/github';
import { DemoInvite } from './DemoBanner';
import { useFactoryStore } from '../state/store';
import { splitPrompt, joinPrompt } from '../prompts/frontmatter';
import { lintPrompt, lintPasses } from '../prompts/lint';
import { diffLines } from '../prompts/diff';
import { PageHeader } from '../ui/primitives';

const MARK: Record<string, string> = { error: '✗', warning: '⚠', info: 'ℹ' };

/** Machine ids on the current canvas that reference a given prompt path. */
function referencedBy(path: string, nodes: { id: string; type: string; config: Record<string, unknown> }[]): string[] {
  return nodes
    .filter((n) => n.type === 'agent.claude' && typeof n.config.promptRef === 'string' && (n.config.promptRef === path || path.endsWith(String(n.config.promptRef))))
    .map((n) => n.id);
}

export function PromptStudio() {
  const login = useGithubStore((s) => s.login);
  const nodes = useFactoryStore((s) => s.nodes);
  const files = usePromptsStore((s) => s.files);
  const loading = usePromptsStore((s) => s.loading);
  const error = usePromptsStore((s) => s.error);
  const selectedPath = usePromptsStore((s) => s.selectedPath);
  const content = usePromptsStore((s) => s.content);
  const draft = usePromptsStore((s) => s.draft);
  const saving = usePromptsStore((s) => s.saving);
  const prUrl = usePromptsStore((s) => s.prUrl);
  const mode = usePromptsStore((s) => s.mode);
  const { refresh, open, edit, setMode, save, create } = usePromptsStore.getState();

  const [showDiff, setShowDiff] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (login) void refresh();
  }, [login, refresh]);

  const bpNodes = useMemo(
    () => nodes.map((n) => ({ id: n.id, type: n.data.machineType, config: n.data.config })),
    [nodes],
  );

  const split = useMemo(() => splitPrompt(draft), [draft]);
  const findings = useMemo(() => lintPrompt(draft), [draft]);
  const dirty = draft !== content;
  const canSave = dirty && lintPasses(findings) && !saving;

  const setFm = (key: string, value: string) => {
    const fm = { ...(split.frontmatter ?? {}), [key]: value };
    edit(joinPrompt(fm, split.body));
  };
  const setBody = (body: string) => edit(joinPrompt(split.frontmatter, body));

  if (!login) {
    return (
      <div className="tabpane promptstudio">
        <p className="tabpane__empty">Connect a repo (top bar) to browse and edit its <code>.factory/prompts/</code>.</p>
        <DemoInvite />
      </div>
    );
  }

  return (
    <div className="tabpane promptstudio">
      <PageHeader
        title="Prompt Studio"
        subtitle="The agents’ operating instructions live in the repo at .factory/prompts/ — reviewable, versioned, hot-editable without recompiling."
        live={loading || saving}
      />
      <div className="ps">
        <aside className="ps__library panel">
          <div className="ps__libhead">
            <span className="panel__eyebrow">Prompts</span>
            <button type="button" className="btn btn--small" onClick={() => void refresh()}>↻</button>
          </div>
          {loading && files.length === 0 && <p className="tabpane__empty">Loading…</p>}
          {!loading && files.length === 0 && <p className="tabpane__empty">No prompts yet.</p>}
          <ul className="ps__list">
            {files.map((f) => {
              const refs = referencedBy(f.path, bpNodes);
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    className={`ps__file${selectedPath === f.path ? ' is-active' : ''}`}
                    onClick={() => void open(f.path)}
                  >
                    <span className="ps__filename">{f.name}</span>
                    {refs.length > 0 && <span className="ps__refs" title={`Referenced by ${refs.join(', ')}`}>⚙ {refs.length}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="ps__new">
            <input
              className="palette__search"
              placeholder="new-prompt.md"
              aria-label="New prompt name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="button" className="btn btn--small" disabled={!newName.trim() || saving} onClick={() => { void create(newName.trim()); setNewName(''); }}>
              + New
            </button>
          </div>
        </aside>

        <section className="ps__editor panel">
          {!selectedPath ? (
            <p className="tabpane__empty">Select a prompt to edit its frontmatter and body. Edits ship as a PR (or a direct commit).</p>
          ) : (
            <>
              <div className="ps__edhead">
                <span className="ps__path">{selectedPath}</span>
                {dirty && <span className="ps__dirty">● unsaved</span>}
              </div>

              <div className="panel__eyebrow">Frontmatter</div>
              {split.frontmatter && Object.keys(split.frontmatter).length > 0 ? (
                Object.entries(split.frontmatter).map(([k, v]) => (
                  <label key={k} className="field">
                    <span className="field__label">{k}</span>
                    <input aria-label={k} value={String(v ?? '')} onChange={(e) => setFm(k, e.target.value)} />
                  </label>
                ))
              ) : (
                <p className="inspector__blurb">No frontmatter — add a <code>title</code> below to create it.</p>
              )}
              <div className="ps__addkey">
                <input className="palette__search" placeholder="add key (e.g. title)" aria-label="Add frontmatter key" onKeyDown={(e) => {
                  if (e.key === 'Enter') { const key = (e.target as HTMLInputElement).value.trim(); if (key) { setFm(key, ''); (e.target as HTMLInputElement).value = ''; } }
                }} />
              </div>

              <div className="panel__eyebrow ps__section">Body</div>
              <textarea className="ps__body" value={split.body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />

              <div className="panel__eyebrow ps__section">Lint</div>
              {findings.length === 0 ? (
                <p className="diag diag--info">✓ clean</p>
              ) : (
                findings.map((f, i) => (
                  <p key={i} className={`diag diag--${f.level}`}>{MARK[f.level]} {f.message}</p>
                ))
              )}

              <div className="ps__actions">
                <label className="check">
                  <input type="radio" name="psmode" checked={mode === 'pr'} onChange={() => setMode('pr')} /> PR
                </label>
                <label className="check">
                  <input type="radio" name="psmode" checked={mode === 'commit'} onChange={() => setMode('commit')} /> commit direct
                </label>
                <button type="button" className="btn btn--small" disabled={!dirty} onClick={() => setShowDiff((v) => !v)}>
                  {showDiff ? 'Hide diff' : 'Review diff'}
                </button>
                <button type="button" className="btn btn--primary btn--small" disabled={!canSave} title={!lintPasses(findings) ? 'Fix lint errors first' : undefined} onClick={() => void save()}>
                  {saving ? 'Saving…' : mode === 'pr' ? 'Open PR' : 'Commit'}
                </button>
              </div>
              {prUrl && (
                <p className="diag diag--info">✓ PR opened: <a href={prUrl} target="_blank" rel="noreferrer">{prUrl}</a></p>
              )}
              {error && <p className="diag diag--error">{error}</p>}

              {showDiff && dirty && (
                <pre className="ps__diff">
                  {diffLines(content, draft).map((r, i) => (
                    <div key={i} className={`ps__diffrow ps__diffrow--${r.kind}`}>
                      {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '} {r.text}
                    </div>
                  ))}
                </pre>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
