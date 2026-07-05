import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MACHINES } from './registry';
import { compile } from '../compiler/compile';
import type { Blueprint } from '../blueprint/types';

// Single-source-of-truth guard: the registry, the JSON schema enum, and the compiler must
// agree on the set of machine type ids. Drift here silently breaks deploy validation or
// leaves a machine that renders but won't compile.
const schema = JSON.parse(
  readFileSync(new URL('../../../schema/blueprint.schema.json', import.meta.url), 'utf8'),
) as { properties: { nodes: { items: { properties: { type: { enum: string[] } } } } } };
const schemaEnum: string[] = schema.properties.nodes.items.properties.type.enum;

describe('machine type registry ↔ schema ↔ compiler drift guard', () => {
  const registryTypes = MACHINES.map((m) => m.type);

  it('registry ids are unique', () => {
    expect(new Set(registryTypes).size).toBe(registryTypes.length);
  });

  it('the schema enum exactly matches the registry (same set)', () => {
    expect([...schemaEnum].sort()).toEqual([...registryTypes].sort());
  });

  it('the compiler recognises every registry machine type (no "Unknown machine type")', () => {
    for (const m of MACHINES) {
      // A one-node line: give it a trigger sibling so the component is emitted, then assert
      // the machine under test never yields an "Unknown machine type" diagnostic.
      const isTrigger = m.category === 'trigger';
      const bp: Blueprint = {
        version: 1,
        meta: { name: `probe ${m.type}` },
        nodes: isTrigger
          ? [{ id: 'n', type: m.type, position: { x: 0, y: 0 }, config: { ...m.defaults } }]
          : [
              { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
              { id: 'n', type: m.type, position: { x: 1, y: 0 }, config: { ...m.defaults } },
            ],
        edges: isTrigger ? [] : [{ id: 'e', from: { node: 't', port: 'out' }, to: { node: 'n', port: 'in' } }],
      };
      const { workflows } = compile(bp);
      const unknown = workflows.flatMap((w) => w.diagnostics).filter((d) => /Unknown machine type/.test(d.message));
      expect(unknown, `${m.type} was not recognised by the compiler`).toHaveLength(0);
    }
  });
});
