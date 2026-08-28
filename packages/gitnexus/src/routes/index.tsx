import { createFileRoute, Link } from "@tanstack/react-router";
import { APP, NAV } from "@/data/nav";
import { PRD } from "@/data/prd";
import { FEATURES } from "@/data/features";
import { PHASES } from "@/data/pipeline";
import { NODE_TABLES, RELATIONS } from "@/data/schema";
import { MCP_TOOLS } from "@/data/surfaces";
import { LANGUAGES } from "@/data/languages";
import { PLAYBOOK } from "@/data/playbook";
import { Panel } from "@/components/shell";

export const Route = createFileRoute("/")({ component: Overview });

const STATS = [
  { k: "Languages", v: String(LANGUAGES.length) },
  { k: "Pipeline phases", v: String(PHASES.length) },
  { k: "Node tables", v: String(NODE_TABLES.length) },
  { k: "Relation types", v: String(RELATIONS.length) },
  { k: "MCP tools", v: String(MCP_TOOLS.length) },
  { k: "Features", v: String(FEATURES.length) },
  { k: "Rebuild milestones", v: String(PLAYBOOK.length) },
  { k: "Source stars", v: APP.stars },
];

function Overview() {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.28em] text-signal">00 / OVERVIEW</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-paper md:text-5xl">
        Rebuild GitNexus from the graph up.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{PRD.oneLiner}</p>
      <p className="mt-4 max-w-2xl text-sm text-muted">
        This workbench is the product requirements document, architecture, feature catalog, data
        models, frameworks, and a 14-milestone playbook extracted from{" "}
        <a className="text-signal underline-offset-4 hover:underline" href={APP.source} target="_blank" rel="noreferrer">
          abhigyanpatwari/GitNexus
        </a>{" "}
        ({APP.snapshot}). Use it as the instruction set to implement the engine from scratch.
      </p>

      <dl className="mt-10 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.k} className="bg-plate px-4 py-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{s.k}</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums text-signal">{s.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {NAV.filter((n) => n.id !== "overview").map((n) => (
          <Link key={n.id} to={n.href} className="group border border-line bg-plate/70 p-5 hover:border-signal">
            <span className="font-mono text-[10px] text-signal">{n.kicker}</span>
            <h2 className="mt-2 text-lg font-semibold text-paper group-hover:text-signal">{n.label}</h2>
          </Link>
        ))}
      </div>

      <Panel className="mt-10">
        <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">THESIS</h2>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-paper">{PRD.vision}</p>
        <blockquote className="mt-6 max-w-3xl border-l-2 border-signal pl-4 text-muted">
          Agents don't fail because they are not smart enough. They fail because they lack
          structural awareness. GitNexus precomputes the map so the model can reason instead of grep.
        </blockquote>
      </Panel>
    </div>
  );
}
