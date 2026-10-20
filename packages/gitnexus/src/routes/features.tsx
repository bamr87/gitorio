import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { FEATURES, LAYERS } from "@/data/features";
import type { FeatureLayer } from "@/data/types";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/features")({ component: FeaturesPage });

function FeaturesPage() {
  const [layer, setLayer] = useState<FeatureLayer | "all">("all");
  const items = useMemo(
    () => (layer === "all" ? FEATURES : FEATURES.filter((f) => f.layer === layer)),
    [layer],
  );

  return (
    <div>
      <PageHead
        kicker="03 / FEATURE CATALOG"
        title="What the engine actually does."
        lede="Filter by layer. Core ships in the default analyze. Opt-in needs a flag (--pdg, --embeddings, wiki). Web-only and CLI-only stay in their package."
      />

      <div className="mb-8 flex flex-wrap gap-2">
        <FilterChip active={layer === "all"} onClick={() => setLayer("all")} label="All" />
        {LAYERS.map((l) => (
          <FilterChip
            key={l.id}
            active={layer === l.id}
            onClick={() => setLayer(l.id)}
            label={l.label}
          />
        ))}
      </div>

      <p className="mb-4 font-mono text-[11px] text-muted">{items.length} features</p>

      <div className="grid gap-4">
        {items.map((f) => (
          <Panel key={f.id} className="scroll-mt-20" >
            <div id={f.id} />
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-semibold text-paper">{f.name}</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal">
                {f.layer}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                {f.status}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.summary}</p>
            <ul className="mt-3 space-y-1 text-sm text-paper">
              {f.details.map((d) => (
                <li key={d} className="border-l border-line pl-3 text-muted">
                  {d}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-9 border px-3 font-mono text-[11px] tracking-wide",
        active ? "border-signal bg-signal text-void" : "border-line text-muted hover:text-paper",
      )}
    >
      {label}
    </button>
  );
}
