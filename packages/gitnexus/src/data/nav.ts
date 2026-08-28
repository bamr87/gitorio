import type { NavItem } from "./types";

export const APP = {
  name: "Nexus Forge",
  product: "GitNexus",
  version: "1.6.10",
  source: "https://github.com/abhigyanpatwari/GitNexus",
  live: "https://gitnexus.vercel.app",
  stars: "46,140",
  forks: "5,099",
  engines: "Node ^22.18.0 || >=24.11.0",
  license: "Custom (see LICENSE in source repo)",
  snapshot: "2026-08-28 · main @ b059ab3",
};

export const NAV: NavItem[] = [
  { id: "overview", href: "/", label: "Overview", kicker: "00" },
  { id: "prd", href: "/prd", label: "PRD", kicker: "01" },
  { id: "architecture", href: "/architecture", label: "Architecture", kicker: "02" },
  { id: "features", href: "/features", label: "Features", kicker: "03" },
  { id: "pipeline", href: "/pipeline", label: "Pipeline DAG", kicker: "04" },
  { id: "schema", href: "/schema", label: "Graph Schema", kicker: "05" },
  { id: "models", href: "/models", label: "Models", kicker: "06" },
  { id: "mcp", href: "/mcp", label: "MCP Surface", kicker: "07" },
  { id: "cli", href: "/cli", label: "CLI", kicker: "08" },
  { id: "languages", href: "/languages", label: "Languages", kicker: "09" },
  { id: "stack", href: "/stack", label: "Stack", kicker: "10" },
  { id: "packages", href: "/packages", label: "Packages", kicker: "11" },
  { id: "playbook", href: "/playbook", label: "Rebuild Playbook", kicker: "12" },
  { id: "quality", href: "/quality", label: "Quality Bar", kicker: "13" },
];
