import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import {
  ABSTRACTION_STACK,
  FLOWS,
  LAYERS,
  PACKAGES,
  STORAGE,
  WHERE_TO_CHANGE,
} from "@/data/architecture";

export const Route = createFileRoute("/architecture")({ component: ArchPage });

function ArchPage() {
  return (
    <div>
      <PageHead
        kicker="02 / ARCHITECTURE"
        title="Three faces, one graph."
        lede="CLI/MCP native core, a thin React explorer, and shared contracts. Ingestion builds a KnowledgeGraph; LadybugDB stores it; LocalBackend answers every query path."
      />

      <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">PACKAGES</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {PACKAGES.map((p) => (
          <Panel key={p.id}>
            <p className="font-mono text-[11px] text-signal">{p.path}</p>
            <h3 className="mt-1 text-lg font-semibold text-paper">{p.id}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.role}</p>
            <p className="mt-2 font-mono text-[11px] text-muted">{p.npm}</p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">LAYERS</h2>
      <div className="mt-4 space-y-3">
        {LAYERS.map((l, i) => (
          <Panel key={l.name} className="flex flex-col gap-2 md:flex-row md:gap-8">
            <span className="font-mono text-[11px] text-signal">L{i}</span>
            <div>
              <h3 className="font-semibold text-paper">{l.name}</h3>
              <p className="font-mono text-[11px] text-muted">{l.path}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{l.body}</p>
            </div>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">CONTROL FLOW</h2>
      <div className="mt-4 grid gap-4">
        {FLOWS.map((f) => (
          <Panel key={f.title}>
            <h3 className="font-semibold text-paper">{f.title}</h3>
            <ol className="mt-3 space-y-2">
              {f.steps.map((s, i) => (
                <li key={s} className="flex gap-3 text-sm leading-relaxed text-muted">
                  <span className="font-mono text-[11px] text-signal">{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">ABSTRACTION STACK</h2>
      <ol className="mt-4 space-y-0 border border-line">
        {ABSTRACTION_STACK.map((s, i) => (
          <li key={s} className="flex gap-4 border-b border-line px-4 py-3 last:border-0">
            <span className="font-mono text-[11px] text-signal">{i + 1}</span>
            <span className="text-sm text-paper">{s}</span>
          </li>
        ))}
      </ol>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">ON-DISK LAYOUT</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel>
          <h3 className="font-semibold text-paper">Per repo</h3>
          <ul className="mt-3 space-y-2 font-mono text-xs text-muted">
            {STORAGE.repo.map((r) => (
              <li key={r.path}>
                <span className="text-signal">{r.path}</span>
                <span className="block text-[11px]">{r.note}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h3 className="font-semibold text-paper">Global</h3>
          <ul className="mt-3 space-y-2 font-mono text-xs text-muted">
            {STORAGE.global.map((r) => (
              <li key={r.path}>
                <span className="text-signal">{r.path}</span>
                <span className="block text-[11px]">{r.note}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">WHERE TO CHANGE WHAT</h2>
      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Concern</th>
              <th className="px-4 py-3">Start here</th>
            </tr>
          </thead>
          <tbody>
            {WHERE_TO_CHANGE.map((w) => (
              <tr key={w.concern} className="border-t border-line">
                <td className="px-4 py-3 text-paper">{w.concern}</td>
                <td className="px-4 py-3 font-mono text-xs text-signal">{w.start}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
