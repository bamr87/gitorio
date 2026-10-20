import { NAV } from "./nav";
import { PRD } from "./prd";
import { FEATURES } from "./features";
import { PHASES } from "./pipeline";
import { NODE_TABLES, RELATIONS } from "./schema";
import { MCP_TOOLS, CLI, SKILLS, RESOURCES } from "./surfaces";
import { LANGUAGES } from "./languages";
import { PLAYBOOK } from "./playbook";
import { MODELS } from "./models";
import type { SearchHit } from "./types";

export const SEARCH_INDEX: SearchHit[] = [
  ...NAV.map((n) => ({
    id: `nav-${n.id}`,
    title: n.label,
    blurb: `Spec section ${n.kicker} — ${n.label}`,
    href: n.href,
    section: n.id,
    tags: ["section"],
  })),
  ...PRD.goals.map((g, i) => ({
    id: `goal-${i}`,
    title: g,
    blurb: "Product goal",
    href: "/prd",
    section: "prd" as const,
    tags: ["prd", "goal"],
  })),
  ...FEATURES.map((f) => ({
    id: `feat-${f.id}`,
    title: f.name,
    blurb: f.summary,
    href: `/features#${f.id}`,
    section: "features" as const,
    tags: [f.layer, f.status],
  })),
  ...PHASES.map((p) => ({
    id: `phase-${p.id}`,
    title: `Phase ${p.id}`,
    blurb: p.output,
    href: `/pipeline#${p.id}`,
    section: "pipeline" as const,
    tags: ["phase", ...p.deps],
  })),
  ...NODE_TABLES.map((n) => ({
    id: `node-${n.name}`,
    title: `Node ${n.name}`,
    blurb: n.note,
    href: `/schema#node-${n.name}`,
    section: "schema" as const,
    tags: ["node", n.kind],
  })),
  ...RELATIONS.map((r) => ({
    id: `rel-${r.type}`,
    title: `Edge ${r.type}`,
    blurb: `${r.from} → ${r.to}. ${r.note}`,
    href: `/schema#rel-${r.type}`,
    section: "schema" as const,
    tags: ["edge", r.pdg ? "pdg" : "core"],
  })),
  ...MCP_TOOLS.map((t) => ({
    id: `tool-${t.name}`,
    title: t.name,
    blurb: t.purpose,
    href: `/mcp#${t.name}`,
    section: "mcp" as const,
    tags: ["mcp", ...(t.pdg ? ["pdg"] : []), ...(t.group ? ["group"] : [])],
  })),
  ...RESOURCES.map((r) => ({
    id: `res-${r.uri}`,
    title: r.uri,
    blurb: r.purpose,
    href: "/mcp#resources",
    section: "mcp" as const,
    tags: ["resource"],
  })),
  ...SKILLS.map((s) => ({
    id: `skill-${s.id}`,
    title: s.name,
    blurb: s.body,
    href: "/mcp#skills",
    section: "mcp" as const,
    tags: ["skill"],
  })),
  ...CLI.map((c) => ({
    id: `cli-${c.cmd}`,
    title: c.cmd,
    blurb: c.purpose,
    href: "/cli",
    section: "cli" as const,
    tags: ["cli"],
  })),
  ...LANGUAGES.map((l) => ({
    id: `lang-${l.language}`,
    title: l.language,
    blurb: l.notes,
    href: `/languages#${l.language}`,
    section: "languages" as const,
    tags: ["language", l.importStrategy, l.mro],
  })),
  ...MODELS.map((m) => ({
    id: `model-${m.name}`,
    title: m.name,
    blurb: m.purpose,
    href: `/models#${m.name}`,
    section: "models" as const,
    tags: ["model"],
  })),
  ...PLAYBOOK.map((p) => ({
    id: `ms-${p.id}`,
    title: `${p.phase} ${p.title}`,
    blurb: p.goal,
    href: `/playbook#${p.id}`,
    section: "playbook" as const,
    tags: ["milestone"],
  })),
];

export function searchSpec(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return SEARCH_INDEX.filter((h) => {
    const hay = `${h.title} ${h.blurb} ${h.tags.join(" ")}`.toLowerCase();
    return hay.includes(needle);
  }).slice(0, 24);
}
