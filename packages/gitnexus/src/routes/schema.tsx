import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { CAPTURE_TAGS, ID_RULES, NODE_TABLES, RELATIONS } from "@/data/schema";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/schema")({ component: SchemaPage });

function SchemaPage() {
  const [node, setNode] = useState<string | null>(null);
  const related = useMemo(() => {
    if (!node) return RELATIONS;
    return RELATIONS.filter((r) => r.from.includes(node) || r.to.includes(node) || r.type.includes(node));
  }, [node]);

  return (
    <div>
      <PageHead
        kicker="05 / GRAPH SCHEMA"
        title="One CodeRelation table. Many node tables."
        lede="LadybugDB schema in gitnexus/src/core/lbug/schema.ts. PDG types stay out of VALID_RELATION_TYPES and the web graph unless --pdg."
      />

      <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">NODE TABLES</h2>
      <p className="mt-2 text-sm text-muted">Select a node to filter incident relations.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => setNode(null)}
          className={cn(
            "h-9 border px-3 font-mono text-[11px]",
            !node ? "border-signal bg-signal text-void" : "border-line text-muted",
          )}
        >
          All
        </button>
        {NODE_TABLES.map((n) => (
          <button
            key={n.name}
            id={`node-${n.name}`}
            onClick={() => setNode(n.name)}
            className={cn(
              "h-9 border px-3 font-mono text-[11px] scroll-mt-20",
              node === n.name ? "border-signal bg-signal text-void" : "border-line text-paper hover:border-signal",
            )}
          >
            {n.name}
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Table</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {NODE_TABLES.filter((n) => !node || n.name === node).map((n) => (
              <tr key={n.name} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-signal">{n.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{n.kind}</td>
                <td className="px-4 py-3 text-paper">{n.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">RELATIONS</h2>
      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {related.map((r) => (
              <tr key={r.type + r.from} id={`rel-${r.type}`} className="scroll-mt-20 border-t border-line">
                <td className="px-4 py-3 font-mono text-signal">
                  {r.type}
                  {r.pdg ? <span className="ml-2 text-[10px] text-muted">PDG</span> : null}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{r.from}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{r.to}</td>
                <td className="px-4 py-3 text-paper">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">ID RULES</h2>
      <ul className="mt-4 space-y-2">
        {ID_RULES.map((r) => (
          <li key={r} className="border border-line bg-plate px-4 py-3 text-sm text-muted">
            {r}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">UNIFIED CAPTURE TAGS</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {CAPTURE_TAGS.map((t) => (
          <span key={t} className="border border-line bg-inset px-3 py-1.5 font-mono text-xs text-signal">
            {t}
          </span>
        ))}
      </div>
      <Panel className="mt-4">
        <p className="text-sm text-muted">
          Per-language tree-sitter queries use different AST node names but must emit these tags.
          Downstream extraction never branches on language. Defined in tree-sitter-queries.ts.
        </p>
      </Panel>
    </div>
  );
}
