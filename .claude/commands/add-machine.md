---
description: Add a new machine type end-to-end (registry + compiler emitter + invariant test + docs)
allowed-tools: Read, Edit, Bash(npm test:*), Bash(npm run build:*), Bash(npm run reference:*)
argument-hint: '<machine spec — id (category.name), behavior, config fields>'
---

Add a new machine type to GitFactory: $ARGUMENTS

Follow the definition of done (AGENTS.md golden rule #8), in this order:

1. **Registry** — add the machine to `app/src/machines/registry.ts`: id
(`category.name`), category, label, icon, one-line `describe(config)`, config `fields` with sensible defaults. Pick the category color semantics correctly (trigger/copper, processor/steel, sink/green).
2. **Compiler** — implement the emitter in `app/src/compiler/compile.ts`. Triggers
extend the `on:` merge; processors contribute guards/steps; sinks define obligations text + allowedTools grants (integrated mode) AND a deterministic emission if reachable without an agent, or a diagnostic explaining why not. Recompute permissions if the sink needs new scopes. Respect loop-guard rules.
3. **Test** — invariant test in `compile.test.ts`: build a minimal blueprint using
   the machine, assert the critical YAML fragments and permissions.
4. **Docs** — one line in `docs/ARCHITECTURE.md` §4 machine catalog, then `cd app && npm run reference` to regenerate `docs/reference/machines.md` from the registry (`npm test` fails while it is stale).
5. **Verify** — `npm test && npm run build`, then drag it on the canvas, connect it,
   compile, and eyeball the YAML.

If the machine's semantics are ambiguous, propose the config fields and obligation wording first and ask before implementing.
