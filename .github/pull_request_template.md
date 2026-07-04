<!-- Thanks for contributing to GitFactory! Keep the factory metaphor consistent. -->

## What & why

<!-- One or two sentences. Link the seed or issue this advances. -->

## Checklist

<!-- The compiler and security invariants are load-bearing — see CLAUDE.md § Golden rules. -->

- [ ] `cd app && npm test && npm run build` pass locally
- [ ] The **blueprint stays the source of truth** — I did not hand-edit generated workflow YAML; I changed the compiler
- [ ] **Least privilege**: any new sink emits only the `permissions:` and `--allowedTools` it actually needs
- [ ] **Loop guards** intact — no workflow can retrigger itself unguarded
- [ ] **No secrets** in blueprint, code, or `localStorage` (PATs in `sessionStorage` at most; `ANTHROPIC_API_KEY` only as `${{ secrets.* }}`)
- [ ] New machine type? Completed the **Definition of Done** (registry + config + emitter + invariant test + ARCHITECTURE catalog line + renders on canvas) — see `/add-machine`
- [ ] Verified `anthropics/claude-code-action` input names against the upstream `action.yml` if I touched agent emission

## Notes for reviewers

<!-- Trade-offs, follow-ups parked in docs/ROADMAP.md § Backlog, screenshots, etc. -->
