import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { DOD, LIMITS } from "@/data/quality";

export const Route = createFileRoute("/quality")({ component: QualityPage });

function QualityPage() {
  return (
    <div>
      <PageHead
        kicker="13 / QUALITY BAR"
        title="Done means the graph is honest."
        lede={DOD.statement}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {DOD.axes.map((a) => (
          <Panel key={a.name}>
            <h2 className="font-semibold text-paper">{a.name}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {a.items.map((i) => (
                <li key={i} className="border-l border-line pl-3">
                  {i}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">NOT DONE — EVEN IF CI IS GREEN</h2>
      <ul className="mt-4 space-y-2">
        {DOD.notDone.map((n) => (
          <li key={n} className="border border-line bg-plate px-4 py-3 text-sm text-muted">
            {n}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">AGENT RULES</h2>
      <ul className="mt-4 space-y-2">
        {DOD.agentRules.map((n) => (
          <li key={n} className="border-l-2 border-signal bg-plate px-4 py-3 text-sm text-paper">
            {n}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">VALIDATION</h2>
      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Command</th>
              <th className="px-4 py-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {DOD.tests.map((t) => (
              <tr key={t.cmd} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-xs text-signal">{t.cmd}</td>
                <td className="px-4 py-3 text-paper">{t.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">KNOWN LIMITS TO PRESERVE</h2>
      <ul className="mt-4 space-y-2">
        {LIMITS.map((n) => (
          <li key={n} className="border border-line px-4 py-3 text-sm text-muted">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}
