import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { ADD_LANGUAGE, LANGUAGES } from "@/data/languages";

export const Route = createFileRoute("/languages")({ component: LangPage });

const COLS = ["Imp", "Named", "Exp", "Her", "Types", "Ctor", "Cfg", "Fw", "Entry", "PDG"] as const;

function LangPage() {
  return (
    <div>
      <PageHead
        kicker="09 / LANGUAGES"
        title="Sixteen languages, one schema."
        lede="A language is a LanguageProvider plus a ScopeResolver. Shared ingestion never names a language. Missing a provider is a compile error."
      />

      <div className="overflow-x-auto border border-line">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            <tr>
              <th className="px-3 py-3">Language</th>
              {COLS.map((c) => (
                <th key={c} className="px-2 py-3 text-center">
                  {c}
                </th>
              ))}
              <th className="px-3 py-3">Import</th>
              <th className="px-3 py-3">MRO</th>
            </tr>
          </thead>
          <tbody>
            {LANGUAGES.map((l) => (
              <tr key={l.language} id={l.language} className="scroll-mt-20 border-t border-line">
                <td className="px-3 py-3 font-medium text-paper">{l.language}</td>
                <Cell on={l.imports} />
                <Cell on={l.named} />
                <Cell on={l.exports} />
                <Cell on={l.heritage} />
                <Cell on={l.types} />
                <Cell on={l.ctor} />
                <Cell on={l.config} />
                <Cell on={l.frameworks} />
                <Cell on={l.entry} />
                <Cell on={l.pdg} />
                <td className="px-3 py-3 font-mono text-[11px] text-muted">{l.importStrategy}</td>
                <td className="px-3 py-3 font-mono text-[11px] text-muted">{l.mro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[11px] text-muted">
        Imp=imports Named=named bindings Exp=exports Her=heritage Ctor=constructor inference Cfg=config
        parsing Fw=frameworks
      </p>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">NOTES</h2>
      <div className="mt-4 grid gap-3">
        {LANGUAGES.map((l) => (
          <Panel key={l.language}>
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-semibold text-paper">{l.language}</h3>
              <span className="font-mono text-[11px] text-signal">{l.extensions.join(" ")}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{l.notes}</p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">ADD A LANGUAGE</h2>
      <ol className="mt-4 space-y-3">
        {ADD_LANGUAGE.map((s, i) => (
          <li key={s} className="flex gap-3 border border-line bg-plate px-4 py-3 text-sm text-muted">
            <span className="font-mono text-[11px] text-signal">{String(i + 1).padStart(2, "0")}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Cell({ on }: { on: boolean }) {
  return (
    <td className="px-2 py-3 text-center font-mono text-xs">
      {on ? <span className="text-signal">●</span> : <span className="text-line">○</span>}
    </td>
  );
}
