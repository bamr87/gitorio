import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import {
  IMPORT_STRATEGIES,
  IMPORT_TIERS,
  MRO,
  PARSE_CHUNK,
  PDG_LAYERS,
  PDG_PHASES,
  PHASES,
  ROUTE_SOURCES,
  RUNNER_RULES,
  SCOPE_STAGES,
  type Phase,
} from "@/data/pipeline";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/pipeline")({ component: PipelinePage });

function PipelinePage() {
  const [active, setActive] = useState<string>(PHASES[0].id);
  const phase = useMemo(() => PHASES.find((p) => p.id === active) ?? PHASES[0], [active]);
  const bands = Math.max(...PHASES.map((p) => p.band)) + 1;

  return (
    <div>
      <PageHead
        kicker="04 / PIPELINE DAG"
        title="Nineteen phases, one accumulator."
        lede="scan → structure → parse → resolve → cluster → processes. --pdg adds taint and call summaries (21 total). The runner is a static typed DAG — no plugins."
      />

      <div className="overflow-x-auto border border-line bg-inset p-4">
        <div className="min-w-[720px]">
          {Array.from({ length: bands }, (_, band) => {
            const row = PHASES.filter((p) => p.band === band).sort((a, b) => a.col - b.col);
            return (
              <div key={band} className="mb-3 flex flex-wrap items-center justify-center gap-2">
                {row.map((p) => (
                  <PhaseChip key={p.id} phase={p} active={p.id === active} onClick={() => setActive(p.id)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <Panel className="mt-6 scroll-mt-20">
        <div id={phase.id} />
        <p className="font-mono text-[11px] text-signal">{phase.file}</p>
        <h2 className="mt-1 text-2xl font-semibold text-paper">{phase.id}</h2>
        <p className="mt-2 text-sm text-muted">{phase.output}</p>
        <p className="mt-3 font-mono text-[11px] text-muted">
          deps: {phase.deps.length ? phase.deps.join(" · ") : "(root)"}
        </p>
      </Panel>

      <div className="mt-8 overflow-x-auto border border-line">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Phase</th>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Deps</th>
              <th className="px-4 py-3">Output</th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map((p) => (
              <tr
                key={p.id}
                id={`row-${p.id}`}
                className={cn("border-t border-line", p.id === active && "bg-signal/10")}
              >
                <td className="px-4 py-3 font-mono text-signal">{p.id}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{p.file}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{p.deps.join(", ") || "—"}</td>
                <td className="px-4 py-3 text-paper">{p.output}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">RUNNER RULES</h2>
      <ul className="mt-4 space-y-2">
        {RUNNER_RULES.map((r) => (
          <li key={r} className="border border-line bg-plate px-4 py-3 text-sm text-muted">
            {r}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">CHUNKED PARSE</h2>
      <ul className="mt-4 space-y-2">
        {PARSE_CHUNK.map((r) => (
          <li key={r} className="border-l border-signal pl-4 text-sm leading-relaxed text-muted">
            {r}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">SCOPE-RESOLUTION STAGES</h2>
      <ol className="mt-4 space-y-0 border border-line">
        {SCOPE_STAGES.map((s, i) => (
          <li key={s} className="flex gap-4 border-b border-line px-4 py-2.5 last:border-0">
            <span className="font-mono text-[11px] text-signal">{String(i + 1).padStart(2, "0")}</span>
            <span className="font-mono text-xs text-paper">{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Panel>
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">IMPORT TIERS</h2>
          <ul className="mt-4 space-y-3">
            {IMPORT_TIERS.map((t) => (
              <li key={t.tier}>
                <p className="text-sm font-semibold text-paper">
                  {t.tier} <span className="font-mono text-signal">{t.confidence}</span>
                </p>
                <p className="text-xs text-muted">{t.mechanism}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">IMPORT STRATEGIES</h2>
          <ul className="mt-4 space-y-3">
            {IMPORT_STRATEGIES.map((t) => (
              <li key={t.strategy}>
                <p className="font-mono text-sm text-paper">{t.strategy}</p>
                <p className="text-xs text-signal">{t.langs}</p>
                <p className="text-xs text-muted">{t.behavior}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">MRO STRATEGIES</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {MRO.map((m) => (
          <div key={m.strategy} className="border border-line bg-plate px-4 py-3">
            <p className="font-mono text-sm text-signal">{m.strategy}</p>
            <p className="text-xs text-muted">{m.langs}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">ROUTE SOURCES</h2>
      <div className="mt-4 grid gap-3">
        {ROUTE_SOURCES.map((r) => (
          <Panel key={r.source}>
            <h3 className="font-semibold text-paper">{r.source}</h3>
            <p className="mt-1 font-mono text-xs text-signal">{r.shape}</p>
            <p className="mt-1 text-sm text-muted">{r.examples}</p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">PDG (--pdg)</h2>
      <div className="mt-4 grid gap-3">
        {PDG_PHASES.map((p) => (
          <div key={p.id} className="border border-line px-4 py-3">
            <p className="font-mono text-sm text-signal">{p.id}</p>
            <p className="text-sm text-muted">{p.note}</p>
          </div>
        ))}
        {PDG_LAYERS.map((p) => (
          <div key={p.id} className="border border-line px-4 py-3">
            <p className="font-mono text-sm text-signal">{p.id}</p>
            <p className="text-sm text-muted">{p.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhaseChip({
  phase,
  active,
  onClick,
}: {
  phase: Phase;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "min-h-10 border px-3 py-1.5 font-mono text-[11px]",
        active ? "border-signal bg-signal text-void" : "border-line bg-plate text-paper hover:border-signal",
      )}
    >
      {phase.id}
    </button>
  );
}
