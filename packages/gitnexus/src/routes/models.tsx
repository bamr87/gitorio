import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { MODELS, MODEL_SNIPPETS } from "@/data/models";

export const Route = createFileRoute("/models")({ component: ModelsPage });

function ModelsPage() {
  return (
    <div>
      <PageHead
        kicker="06 / MODELS"
        title="The types the rest of the system is built on."
        lede="Implement these contracts first. Shared types live in gitnexus-shared; runtime classes live in gitnexus/src/core."
      />
      <div className="grid gap-4">
        {MODELS.map((m) => (
          <Panel key={m.name} className="scroll-mt-20">
            <div id={m.name} />
            <p className="font-mono text-[11px] text-signal">{m.path}</p>
            <h2 className="mt-1 text-xl font-semibold text-paper">{m.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{m.purpose}</p>
            <ul className="mt-4 space-y-1">
              {m.fields.map((f) => (
                <li key={f} className="font-mono text-xs text-paper">
                  {f}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
      <h2 className="mt-12 font-mono text-[11px] tracking-[0.2em] text-signal">SNIPPETS</h2>
      <div className="mt-4 grid gap-4">
        {MODEL_SNIPPETS.map((s) => (
          <Panel key={s.name}>
            <h3 className="font-mono text-sm text-signal">{s.name}</h3>
            <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-paper">
              {s.code}
            </pre>
          </Panel>
        ))}
      </div>
    </div>
  );
}
