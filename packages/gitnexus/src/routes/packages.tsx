import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { HTTP_API, TREE } from "@/data/packages";

export const Route = createFileRoute("/packages")({ component: PackagesPage });

function PackagesPage() {
  return (
    <div>
      <PageHead
        kicker="11 / PACKAGE MAP"
        title="Where every concern lives."
        lede="Rebuild the tree in this shape. gitnexus-shared must build before gitnexus and gitnexus-web."
      />
      {TREE.map((t) => (
        <section key={t.path} className="mb-8">
          <h2 className="font-mono text-sm text-signal">{t.path}</h2>
          <ul className="mt-3 border border-line">
            {t.children.map((c) => (
              <li key={c} className="border-b border-line px-4 py-2.5 font-mono text-xs text-paper last:border-0">
                {c}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">HTTP BRIDGE</h2>
      <p className="mt-2 text-sm text-muted">gitnexus serve — Express 5 wrapping LocalBackend.</p>
      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Path</th>
              <th className="px-4 py-3">Purpose</th>
            </tr>
          </thead>
          <tbody>
            {HTTP_API.map((r) => (
              <tr key={r.path} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-xs text-signal">{r.method}</td>
                <td className="px-4 py-3 font-mono text-xs text-paper">{r.path}</td>
                <td className="px-4 py-3 text-muted">{r.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Panel className="mt-6">
        <p className="text-sm text-muted">
          Web UI never talks to LadybugDB directly. All queries go through this HTTP API (or, in the hosted
          WASM explorer, through in-browser ports of the same pipeline).
        </p>
      </Panel>
    </div>
  );
}
