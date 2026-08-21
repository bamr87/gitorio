import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MACHINES } from './registry';
import type { FieldDef } from './registry';

// Single-source-of-truth guard for the per-type config subschemas: every machine type in the
// registry must have an allOf if/then branch in schema/blueprint.schema.json whose config
// properties mirror the registry field keys and JSON types (kind number → number, everything
// else → string). Companion to registry.test.ts, which guards the type enum itself.
// Dependency-free by design: the schema shape is navigated and checked by hand, no ajv.

interface ConfigSubschema {
  type: string;
  additionalProperties: boolean;
  properties: Record<string, { type: string }>;
}

interface ConfigBranch {
  if: { properties: { type: { const: string } }; required: string[] };
  then: { properties: { config: ConfigSubschema } };
}

const schema = JSON.parse(
  readFileSync(new URL('../../../schema/blueprint.schema.json', import.meta.url), 'utf8'),
) as { properties: { nodes: { items: { allOf: ConfigBranch[] } } } };
const branches: ConfigBranch[] = schema.properties.nodes.items.allOf;

const branchByType = new Map<string, ConfigSubschema>(
  branches.map((b) => [b.if.properties.type.const, b.then.properties.config]),
);

const jsonTypeFor = (kind: FieldDef['kind']): 'number' | 'string' =>
  kind === 'number' ? 'number' : 'string';

describe('machine config registry ↔ schema drift guard', () => {
  it('every registry type has exactly one config branch, and no branch is orphaned', () => {
    const branchTypes = branches.map((b) => b.if.properties.type.const);
    expect(branchTypes.length).toBe(new Set(branchTypes).size);
    expect([...branchTypes].sort()).toEqual(MACHINES.map((m) => m.type).sort());
  });

  it('every branch guards on type and constrains config to an object with no unknown keys', () => {
    for (const b of branches) {
      const type = b.if.properties.type.const;
      expect(b.if.required, `${type} if-branch must require "type"`).toContain('type');
      const config = b.then.properties.config;
      expect(config.type, `${type} config must be typed object`).toBe('object');
      expect(config.additionalProperties, `${type} config must reject unknown keys`).toBe(false);
    }
  });

  it('branch config property names and JSON types match the registry fields', () => {
    for (const m of MACHINES) {
      const config = branchByType.get(m.type);
      expect(config, `no schema branch for ${m.type}`).toBeDefined();
      const schemaKeys = Object.keys(config!.properties).sort();
      const registryKeys = m.fields.map((f) => f.key).sort();
      expect(schemaKeys, `${m.type} config keys drifted from the registry`).toEqual(registryKeys);
      for (const f of m.fields) {
        expect(
          config!.properties[f.key].type,
          `${m.type}.${f.key} (kind: ${f.kind}) has the wrong JSON type in the schema`,
        ).toBe(jsonTypeFor(f.kind));
      }
    }
  });

  it('the committed docs-gardener blueprint node configs conform to their branches', () => {
    const bp = JSON.parse(
      readFileSync(new URL('../../../.factory/docs-gardener.blueprint.json', import.meta.url), 'utf8'),
    ) as { nodes: Array<{ id: string; type: string; config: Record<string, unknown> }> };
    expect(bp.nodes.length).toBeGreaterThan(0);
    for (const node of bp.nodes) {
      const branch = branchByType.get(node.type);
      expect(branch, `node ${node.id}: no schema branch for ${node.type}`).toBeDefined();
      expect(typeof node.config, `node ${node.id}: config must be an object`).toBe('object');
      for (const [key, value] of Object.entries(node.config)) {
        const prop = branch!.properties[key];
        expect(prop, `node ${node.id} (${node.type}): unknown config key "${key}"`).toBeDefined();
        expect(
          typeof value,
          `node ${node.id} (${node.type}): config.${key} must be a ${prop.type}`,
        ).toBe(prop.type);
      }
    }
  });
});
