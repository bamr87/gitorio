import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { PLAYBOOK } from "@/data/playbook";
import { usePlaybook } from "@/lib/playbook-store";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/playbook")({ component: PlaybookPage });

function PlaybookPage() {
  const checked = usePlaybook((s) => s.checked);
  const toggle = usePlaybook((s) => s.toggle);
  const reset = usePlaybook((s) => s.reset);
  const total = PLAYBOOK.reduce((n, m) => n + m.tasks.length, 0);
  const done = PLAYBOOK.reduce(
    (n, m) => n + m.tasks.filter((t) => checked[t.id]).length,
    0,
  );
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <PageHead
        kicker="12 / REBUILD PLAYBOOK"
        title="Implement in this order."
        lede="Fourteen milestones from an empty monorepo to MCP + web + groups + PDG. Check tasks off locally — progress stays in this browser."
      />

      <Panel className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] text-signal">PROGRESS</p>
            <p className="mt-1 font-mono text-3xl tabular-nums text-paper">
              {done}
              <span className="text-lg text-muted"> / {total}</span>
            </p>
          </div>
          <button
            onClick={reset}
            className="h-10 border border-line px-4 font-mono text-[11px] text-muted hover:border-signal hover:text-signal"
          >
            Reset checklist
          </button>
        </div>
        <div className="mt-4 h-1 bg-line">
          <div className="h-full bg-signal" style={{ width: `${pct}%` }} />
        </div>
      </Panel>

      <div className="grid gap-6">
        {PLAYBOOK.map((m) => {
          const mDone = m.tasks.filter((t) => checked[t.id]).length;
          return (
            <Panel key={m.id} className="scroll-mt-20">
              <div id={m.id} />
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="font-mono text-[11px] text-signal">{m.phase}</p>
                <p className="font-mono text-[11px] tabular-nums text-muted">
                  {mDone}/{m.tasks.length}
                </p>
              </div>
              <h2 className="mt-1 text-xl font-semibold text-paper">{m.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{m.goal}</p>
              {m.depends.length ? (
                <p className="mt-2 font-mono text-[11px] text-muted">depends: {m.depends.join(", ")}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {m.files.map((f) => (
                  <span key={f} className="border border-line bg-inset px-2 py-1 font-mono text-[10px] text-muted">
                    {f}
                  </span>
                ))}
              </div>
              <ul className="mt-5 space-y-3">
                {m.tasks.map((t) => {
                  const on = Boolean(checked[t.id]);
                  return (
                    <li key={t.id}>
                      <label className="flex cursor-pointer gap-3">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(t.id)}
                          className="mt-1 size-4 shrink-0 accent-signal"
                        />
                        <span>
                          <span className={cn("block text-sm", on ? "text-muted line-through" : "text-paper")}>
                            {t.title}
                          </span>
                          <span className="mt-1 block text-xs text-muted">{t.doneHint}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
