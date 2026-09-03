// Content cockpit (ADR-017) — the headless-CMS control panel:
//   • Central config  → .factory/config.yml   (model/budget/voice/paths the agents honor)
//   • Content backlog → .factory/backlog.yml   (the work queue the writer pulls from)
//   • Kill switches    → the gate.enablement repo variables that arm/disarm each line
// PR-by-default writes for the two files; instant repo-variable flips for the switches.

import './content.css';
import { useEffect } from 'react';
import { useContentStore } from '../state/content';
import { useGithubStore } from '../state/github';
import { DemoInvite } from './DemoBanner';
import { slugId, starvedKinds, type BacklogPriority, type BacklogStatus } from '../content/model';
import { PageHeader, Panel } from '../ui/primitives';

const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const PRIORITIES: BacklogPriority[] = ['low', 'normal', 'high'];
const STATUSES: BacklogStatus[] = ['todo', 'in-progress', 'done'];

export function ContentPanel() {
  const login = useGithubStore((s) => s.login);
  const { config, backlog, switches, loading, saving, error, prUrl, mode, configSha, backlogSha } =
    useContentStore();
  const {
    refresh, setMode, clearPr, setConfig, saveConfig,
    addBacklogItem, updateBacklogItem, removeBacklogItem, saveBacklog, toggleSwitch,
  } = useContentStore.getState();

  useEffect(() => {
    if (login) void refresh();
  }, [login, refresh]);

  if (!login) {
    return (
      <div className="tabpane contentpane">
        <p className="tabpane__empty">
          Connect a repo (top bar) to manage its content factory — <code>.factory/config.yml</code>,{' '}
          <code>.factory/backlog.yml</code>, and the enablement kill switches.
        </p>
        <DemoInvite />
      </div>
    );
  }

  const starved = starvedKinds(backlog);

  // Review-criteria + skill editors mutate the in-memory config; one "Save config" persists all.
  const setCriterion = (i: number, v: string) =>
    setConfig({ reviewCriteria: config.reviewCriteria.map((c, j) => (j === i ? v : c)) });
  const addCriterion = () => setConfig({ reviewCriteria: [...config.reviewCriteria, ''] });
  const removeCriterion = (i: number) =>
    setConfig({ reviewCriteria: config.reviewCriteria.filter((_, j) => j !== i) });
  const setSkill = (i: number, patch: { name?: string; focus?: string }) =>
    setConfig({ skills: config.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSkill = () =>
    setConfig({ skills: [...config.skills, { id: slugId('skill', config.skills.length + 1), name: '', focus: '' }] });
  const removeSkill = (i: number) => setConfig({ skills: config.skills.filter((_, j) => j !== i) });

  return (
    <div className="tabpane contentpane">
      <div className="content">
        <PageHeader
          title="Content factory"
          subtitle="The headless-CMS cockpit — configure the writer, curate its queue, and arm the autonomous lines."
          live={loading}
        >
          <label className="content__mode">
            <input type="checkbox" checked={mode === 'pr'} onChange={(e) => setMode(e.target.checked ? 'pr' : 'commit')} />
            Save as PR
          </label>
          <button type="button" className="btn btn--small" onClick={() => void refresh()} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </PageHeader>

        {error && <div className="content__error" role="alert">{error}</div>}
        {prUrl && (
          <div className="content__pr">
            Opened a PR: <a href={prUrl} target="_blank" rel="noreferrer">{prUrl}</a>
            <button type="button" className="btn btn--small" onClick={clearPr}>dismiss</button>
          </div>
        )}

        {/* ── Kill switches ── */}
        <Panel className="content__sec">
          <div className="panel__eyebrow">Kill switches — arm the autonomous lines</div>
          {switches.length === 0 ? (
            <p className="content__note">
              No enablement gates in this blueprint yet. Add a <b>gate.enablement</b> machine (or stamp the{' '}
              <b>Headless CMS</b> template) to put a line behind a default-OFF kill switch.
            </p>
          ) : (
            <ul className="switches">
              {switches.map((sw) => (
                <li key={sw.variable} className={`switch${sw.on ? ' is-on' : ''}`}>
                  <span className={`switch__led${sw.on ? ' is-on' : ''}`} aria-hidden />
                  <code className="switch__var">{sw.variable}</code>
                  <span className="switch__state">
                    {sw.on ? 'armed' : sw.known ? 'idle' : 'unset (idle)'}
                  </span>
                  <button
                    type="button"
                    className={`btn btn--small${sw.on ? ' btn--danger' : ' btn--go'}`}
                    onClick={() => void toggleSwitch(sw.variable)}
                    disabled={sw.busy}
                  >
                    {sw.busy ? '…' : sw.on ? 'Disarm' : 'Arm'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="content__note">
            A switch flips a repo <b>variable</b> — it takes effect on the next run with no redeploy. Default-OFF:
            an unset switch keeps the line idle.
          </p>
        </Panel>

        {/* ── Central config ── */}
        <Panel className="content__sec">
          <div className="panel__eyebrow">Central config · <code>.factory/config.yml</code></div>
          <div className="content__grid">
            <label className="field">
              <span>Default model</span>
              <select value={config.model} onChange={(e) => setConfig({ model: e.target.value })}>
                {(MODELS.includes(config.model) ? MODELS : [config.model, ...MODELS]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Max content runs / day</span>
              <input
                type="number"
                min={1}
                value={config.maxDailyRuns}
                onChange={(e) => setConfig({ maxDailyRuns: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <label className="field field--wide">
              <span>Brand voice</span>
              <input
                type="text"
                value={config.brandVoice}
                placeholder="e.g. wry, concrete, second-person"
                onChange={(e) => setConfig({ brandVoice: e.target.value })}
              />
            </label>
            <label className="field field--wide">
              <span>Content paths (comma-separated globs)</span>
              <input
                type="text"
                value={config.contentPaths.join(', ')}
                placeholder="pages/_posts/**, docs/**"
                onChange={(e) => setConfig({ contentPaths: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
              />
            </label>
            <label className="field">
              <span>Docs directory (the collection to tend)</span>
              <input
                type="text"
                value={config.docsDir}
                placeholder="_docs"
                onChange={(e) => setConfig({ docsDir: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Docs reviewed per run</span>
              <input
                type="number"
                min={1}
                value={config.itemsPerRun}
                onChange={(e) => setConfig({ itemsPerRun: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
          </div>

          {/* review criteria — the docs reviewer's checklist */}
          <div className="content__sub2">
            <span className="content__sublabel">Review criteria — the checklist every doc is held to</span>
            <ul className="editlist">
              {config.reviewCriteria.map((c, i) => (
                <li key={i} className="editlist__row">
                  <input
                    type="text"
                    value={c}
                    placeholder="e.g. Accuracy: claims match current behavior"
                    onChange={(e) => setCriterion(i, e.target.value)}
                  />
                  <button type="button" className="btn btn--small btn--danger" aria-label={`remove criterion ${i + 1}`} onClick={() => removeCriterion(i)}>✕</button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn--small" onClick={addCriterion}>+ Add criterion</button>
          </div>

          {/* skill specializations — the lens the agent adopts per item */}
          <div className="content__sub2">
            <span className="content__sublabel">Skill specializations — the lens the agent adopts per item</span>
            <ul className="editlist">
              {config.skills.map((sk, i) => (
                <li key={sk.id} className="editlist__row editlist__row--skill">
                  <input
                    type="text"
                    className="skill__name"
                    value={sk.name}
                    placeholder="Technical Writer"
                    onChange={(e) => setSkill(i, { name: e.target.value })}
                  />
                  <input
                    type="text"
                    className="skill__focus"
                    value={sk.focus}
                    placeholder="what this specialist optimizes for"
                    onChange={(e) => setSkill(i, { focus: e.target.value })}
                  />
                  <button type="button" className="btn btn--small btn--danger" aria-label={`remove skill ${sk.name || i + 1}`} onClick={() => removeSkill(i)}>✕</button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn--small" onClick={addSkill}>+ Add skill</button>
          </div>

          <button type="button" className="btn" onClick={() => void saveConfig()} disabled={saving}>
            {saving ? 'Saving…' : configSha ? 'Save config' : 'Create config'}
          </button>
        </Panel>

        {/* ── Backlog ── */}
        <Panel className="content__sec">
          <div className="panel__eyebrow">
            Content backlog · <code>.factory/backlog.yml</code>
            {starved.length > 0 && (
              <span className="content__warn" title="kinds with no todo item — the writer will improvise">
                ⚠ starved: {starved.join(', ')}
              </span>
            )}
          </div>
          {backlog.length === 0 ? (
            <p className="content__note">Empty queue. Add an item to give the content writer something to draft.</p>
          ) : (
            <table className="backlog">
              <thead>
                <tr><th>Kind</th><th>Title</th><th>Priority</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {backlog.map((it) => (
                  <tr key={it.id} className={`backlog__row backlog__row--${it.status}`}>
                    <td>
                      <input className="backlog__kind" value={it.kind} onChange={(e) => updateBacklogItem(it.id, { kind: e.target.value })} />
                    </td>
                    <td>
                      <input className="backlog__title" value={it.title} placeholder="untitled — will be dropped on save" onChange={(e) => updateBacklogItem(it.id, { title: e.target.value })} />
                    </td>
                    <td>
                      <select value={it.priority} onChange={(e) => updateBacklogItem(it.id, { priority: e.target.value as BacklogPriority })}>
                        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={it.status} onChange={(e) => updateBacklogItem(it.id, { status: e.target.value as BacklogStatus })}>
                        {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </td>
                    <td>
                      <button type="button" className="btn btn--small btn--danger" aria-label={`remove ${it.title || 'item'}`} onClick={() => removeBacklogItem(it.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="content__backlogctl">
            <button type="button" className="btn btn--small" onClick={addBacklogItem}>+ Add item</button>
            <button type="button" className="btn" onClick={() => void saveBacklog()} disabled={saving}>
              {saving ? 'Saving…' : backlogSha ? 'Save backlog' : 'Create backlog'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
