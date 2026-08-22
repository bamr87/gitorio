// Canonical blueprint types — mirror schema/blueprint.schema.json.
// The compiler consumes these; the canvas store converts to/from React Flow shapes.

export interface BlueprintMeta {
  name: string;
  repo?: string;
  description?: string;
  /** SHA-pinned actions mode (ADR-026): emit `uses:` refs pinned to verified commit SHAs. */
  pinActions?: boolean;
  /** Per-line naming for multi-line blueprints (ADR-028): 'auto' names lines by agent promptRef / trigger+sink; default keeps `<name> <index>`. */
  lineNaming?: 'auto' | 'indexed';
}

export interface BlueprintNode {
  id: string;
  /** Machine type id from the registry, e.g. "agent.claude" */
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface PortRef {
  node: string;
  /** 'out' | 'in' in v0; reserved for typed belt-mode ports */
  port: string;
}

export interface BlueprintEdge {
  id: string;
  from: PortRef;
  to: PortRef;
}

export interface Blueprint {
  version: 1;
  meta: BlueprintMeta;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

/** Unicode-safe base64url — Factorio-style shareable blueprint strings. */
export function encodeBlueprintString(bp: Blueprint): string {
  const bytes = new TextEncoder().encode(JSON.stringify(bp));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBlueprintString(s: string): Blueprint {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Blueprint;
}

/** FNV-1a 32-bit — stamped into generated workflow headers for drift detection. */
export function blueprintHash(bp: Blueprint): string {
  const s = JSON.stringify({ nodes: bp.nodes, edges: bp.edges, meta: bp.meta });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function kebab(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'factory'
  );
}
