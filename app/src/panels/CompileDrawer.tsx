import { useState } from 'react';
import { compile, type CompileResult } from '../compiler/compile';
import { useFactoryStore } from '../state/store';

export function CompileDrawer() {
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [open, setOpen] = useState(false);

  const run = () => {
    setResult(compile(toBlueprint()));
    setOpen(true);
  };

  return (
    <section className={`drawer${open ? ' is-open' : ''}`} aria-label="Compile output">
      <div className="drawer__bar">
        <button className="btn btn--primary" onClick={run}>
          ⚙ Compile blueprint
        </button>
        {result && (
          <button className="btn" onClick={() => setOpen(!open)}>
            {open ? 'Hide output' : `Show output (${result.workflows.length})`}
          </button>
        )}
        <span className="drawer__note">
          Compiles to .github/workflows/factory--*.yml — press Deploy (top bar) to push to the repo.
        </span>
      </div>

      {open && result && (
        <div className="drawer__body">
          {result.diagnostics.map((d, i) => (
            <p key={i} className={`diag diag--${d.level}`}>
              {d.level.toUpperCase()}: {d.message}
            </p>
          ))}
          {result.workflows.length === 0 && result.diagnostics.length === 0 && (
            <p className="diag diag--info">Empty floor — drag a trigger on and belt it to a machine.</p>
          )}
          {result.workflows.map((wf) => (
            <details key={wf.filename} open className="wf">
              <summary className="wf__name">
                {wf.filename}
                <button
                  className="btn btn--small"
                  onClick={(e) => {
                    e.preventDefault();
                    void navigator.clipboard.writeText(wf.yaml);
                  }}
                >
                  Copy YAML
                </button>
              </summary>
              {wf.diagnostics.map((d, i) => (
                <p key={i} className={`diag diag--${d.level}`}>
                  {d.level.toUpperCase()}
                  {d.nodeId ? ` [${d.nodeId}]` : ''}: {d.message}
                </p>
              ))}
              {wf.yaml && <pre className="wf__yaml">{wf.yaml}</pre>}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
