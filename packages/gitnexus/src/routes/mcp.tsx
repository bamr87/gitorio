import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { MCP_TOOLS, PROMPTS, RESOURCES, SKILLS } from "@/data/surfaces";

export const Route = createFileRoute("/mcp")({ component: McpPage });

function McpPage() {
  return (
    <div>
      <PageHead
        kicker="07 / MCP SURFACE"
        title="The agent API is the product."
        lede="stdio MCP via gitnexus mcp. Same LocalBackend as HTTP and CLI. Group tools are list/sync only — group state lives on resources."
      />

      <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">TOOLS ({MCP_TOOLS.length})</h2>
      <div className="mt-4 grid gap-3">
        {MCP_TOOLS.map((t) => (
          <Panel key={t.name} className="scroll-mt-20">
            <div id={t.name} />
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-mono text-lg text-signal">{t.name}</h3>
              {t.pdg ? <span className="font-mono text-[10px] text-muted">REQUIRES --pdg</span> : null}
              {t.group ? <span className="font-mono text-[10px] text-muted">GROUP</span> : null}
            </div>
            <p className="mt-2 text-sm text-paper">{t.purpose}</p>
            <p className="mt-2 font-mono text-[11px] text-muted">params: {t.params.join(" · ")}</p>
            {t.notes ? <p className="mt-2 text-sm text-muted">{t.notes}</p> : null}
          </Panel>
        ))}
      </div>

      <h2 id="resources" className="mt-12 scroll-mt-20 font-mono text-[11px] tracking-[0.2em] text-signal">
        RESOURCES
      </h2>
      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">URI</th>
              <th className="px-4 py-3">Purpose</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((r) => (
              <tr key={r.uri} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-xs text-signal">{r.uri}</td>
                <td className="px-4 py-3 text-paper">{r.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">PROMPTS</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {PROMPTS.map((p) => (
          <Panel key={p.name}>
            <h3 className="font-mono text-signal">{p.name}</h3>
            <p className="mt-2 text-sm text-muted">{p.purpose}</p>
          </Panel>
        ))}
      </div>

      <h2 id="skills" className="mt-12 scroll-mt-20 font-mono text-[11px] tracking-[0.2em] text-signal">
        AGENT SKILLS
      </h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {SKILLS.map((s) => (
          <Panel key={s.id}>
            <p className="font-mono text-[11px] text-signal">{s.id}</p>
            <h3 className="mt-1 font-semibold text-paper">{s.name}</h3>
            <p className="mt-2 text-sm text-muted">{s.body}</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
