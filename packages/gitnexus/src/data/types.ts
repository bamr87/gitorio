export type SpecSection =
  | "overview"
  | "prd"
  | "architecture"
  | "features"
  | "pipeline"
  | "schema"
  | "models"
  | "mcp"
  | "cli"
  | "languages"
  | "stack"
  | "packages"
  | "playbook"
  | "quality";

export type FeatureLayer =
  | "ingestion"
  | "graph"
  | "search"
  | "mcp"
  | "cli"
  | "web"
  | "groups"
  | "pdg"
  | "wiki"
  | "skills"
  | "platform";

export type FeatureStatus = "core" | "opt-in" | "web-only" | "cli-only";

export type NavItem = {
  id: SpecSection;
  href: string;
  label: string;
  kicker: string;
};

export type SearchHit = {
  id: string;
  title: string;
  blurb: string;
  href: string;
  section: SpecSection;
  tags: string[];
};
