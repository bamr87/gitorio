import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { ENV, STACK } from "@/data/stack";

export const Route = createFileRoute("/stack")({ component: StackPage });

function StackPage() {
  return (
    <div>
      <PageHead
        kicker="10 / FRAMEWORKS & STACK"
        title="Pin these. Don't improvise the database."
        lede="The published CLI is Node + tree-sitter + LadybugDB + MCP. The web app is a thin Vite/React client. Embeddings are local arctic-embed-xs, never a hosted vector DB."
      />
      <div className="grid gap-8">
        {STACK.map((g) => (
          <section key={g.layer}>
            <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">{g.layer}</h2>
            <div className="mt-3 grid gap-3">
              {g.items.map((it) => (
                <Panel key={it.name}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold text-paper">{it.name}</h3>
                    <span className="font-mono text-[11px] text-signal">{it.ver}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{it.why}</p>
                </Panel>
              ))}
            </div>
          </section>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">ENVIRONMENT</h2>
      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Variable</th>
              <th className="px-4 py-3">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {ENV.map((e) => (
              <tr key={e.key} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-xs text-signal">{e.key}</td>
                <td className="px-4 py-3 text-paper">{e.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
