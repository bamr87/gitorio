import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { PRD } from "@/data/prd";

export const Route = createFileRoute("/prd")({ component: PrdPage });

function PrdPage() {
  return (
    <div>
      <PageHead
        kicker="01 / PRODUCT REQUIREMENTS"
        title="PRD — GitNexus"
        lede="What to build, who it is for, what success looks like, and what must never ship."
      />

      <Panel>
        <p className="font-mono text-[11px] text-signal">{PRD.name}</p>
        <p className="mt-1 text-xl font-semibold text-paper">{PRD.tagline}</p>
        <p className="mt-3 max-w-3xl leading-relaxed text-muted">{PRD.oneLiner}</p>
      </Panel>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">PROBLEM</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {PRD.problem.map((p) => (
          <Panel key={p.title}>
            <h3 className="text-lg font-semibold text-paper">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">USERS</h2>
      <div className="mt-4 grid gap-4">
        {PRD.users.map((u) => (
          <Panel key={u.persona}>
            <h3 className="text-lg font-semibold text-paper">{u.persona}</h3>
            <p className="mt-2 text-sm text-paper">{u.need}</p>
            <p className="mt-1 text-sm text-muted">{u.job}</p>
          </Panel>
        ))}
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Panel>
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">GOALS</h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-paper">
            {PRD.goals.map((g) => (
              <li key={g} className="border-l border-signal pl-3">
                {g}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">NON-GOALS</h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
            {PRD.nonGoals.map((g) => (
              <li key={g} className="border-l border-line pl-3">
                {g}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">PRINCIPLES</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {PRD.principles.map((p) => (
          <Panel key={p.name}>
            <h3 className="font-semibold text-paper">{p.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">SUCCESS METRICS</h2>
      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="px-4 py-3">Metric</th>
              <th className="px-4 py-3">Target</th>
            </tr>
          </thead>
          <tbody>
            {PRD.success.map((s) => (
              <tr key={s.metric} className="border-t border-line">
                <td className="px-4 py-3 font-medium text-paper">{s.metric}</td>
                <td className="px-4 py-3 text-muted">{s.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">CONSTRAINTS</h2>
      <ul className="mt-4 space-y-2 text-sm text-muted">
        {PRD.constraints.map((c) => (
          <li key={c} className="border border-line bg-plate px-4 py-3">
            {c}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">JOURNEYS</h2>
      <div className="mt-4 grid gap-4">
        {PRD.journeys.map((j) => (
          <Panel key={j.name}>
            <h3 className="text-lg font-semibold text-paper">{j.name}</h3>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
              {j.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>
    </div>
  );
}
