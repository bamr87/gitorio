---
description: Compiler health check — invariant tests, blueprint schema validation, example drift, claude-code-action input freshness
allowed-tools: Read, Write, Bash(npm test:*), Bash(node:*), Bash(npx:*), Bash(diff:*), WebFetch
---

Run the compiler health check:

1. `cd app && npm test` — all invariant tests green.
2. Validate `.factory/blueprint.json` and every blueprint fixture in tests against
`schema/blueprint.schema.json` (use ajv via a quick node script if no helper exists yet).
3. Compile `.factory/blueprint.json` and diff the output against
   `examples/compiled/factory--issue-triage-line-1.yml`; report drift line by line.
4. Fetch https://raw.githubusercontent.com/anthropics/claude-code-action/main/action.yml
and confirm every input we emit still exists and no input we rely on is deprecated. Report findings.

Output: a short PASS/FAIL table for the four checks plus recommended fixes. Fix nothing unless asked.
