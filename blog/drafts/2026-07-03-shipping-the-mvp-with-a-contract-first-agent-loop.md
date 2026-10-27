---
title: "Shipping GitFactory's MVP with a Contract-First Agent Loop"
description: "Taking GitFactory from a canvas-that-compiles-YAML to an actual product — connect a repo, deploy real workflows, hook up power — by fanning out parallel coding agents against a fixed TypeScript contract, then integrating the shared files by hand."
date: 2026-07-03
categories: [it-journey, ai-engineering]
tags: [github-actions, claude-code, react, typescript, multi-agent, mvp, zustand, sealed-box]
draft: true
---

GitFactory could already draw a factory and compile it to GitHub Actions YAML — but the YAML went nowhere. You copy-pasted it. That's a demo, not a product. The MVP boundary was **Phase 3: GitHub connect** — connect a repo with a token, load/save the blueprint, *deploy* the compiled workflows, and hook up power (the `ANTHROPIC_API_KEY` secret). This session built that, driven as a loop of AI agents, and it landed green: 49 tests (up from 13), typecheck, prod build, and a browser smoke test.

## The shape of the work

The feature is a cohesive slab: a GitHub REST client, a sealed-box crypto helper, a pure deploy planner, an I/O executor, a Zustand connection store, two modal dialogs, and wiring into the app shell. Naive parallelism would have three agents all editing `App.tsx` and `store.ts` at once and clobbering each other.

So I split the work by **file-disjointness**, not by feature:

1. **Write the contract first.** Before spawning anything, I hand-wrote
`github/types.ts` — every interface the modules share (`GithubClient`, `Preflight`, `DeployPlan`, `DriftItem`) plus the error type. This is the seam.
2. **Fan out on disjoint new files.** Three agents built `client.ts`, `crypto.ts`, and
`deploy.ts` *in parallel*, each against the fixed contract, each with its own test file, each told explicitly: do not touch `types.ts` or any file another agent owns. They came back with 17 + 4 + 15 passing tests.
3. **Integrate the shared files solo.** The store slice, the executor, the two dialogs,
and the `App.tsx`/`CompileDrawer.tsx` edits — everything that touches shared state — I wrote in one coherent pass while the agents ran, against the same contract.
4. **One central verify.** `tsc` + vitest + `vite build` over the *combined* tree. It compiled on the first try because everyone had built against the same types.

The payoff of the contract: the deploy module's author noted the example blueprint compiles to *two* assembly lines and wrote its assertions accordingly — a detail the integration code never had to care about, because the boundary was a type, not a conversation.

## One decision worth recording

`fetch`, not Octokit. The client is a thin typed wrapper over `fetch` with an injectable `fetchImpl`, so the entire GitHub surface is unit-tested with zero network and the static bundle stays lean. Power provisioning uses a libsodium **sealed box** (`tweetnacl`): the API key is read from an *uncontrolled* input, encrypted against the repo's public key in-browser, and PUT as a secret — the plaintext never enters React state or storage.

```
Canvas → compile() → buildDeployPlan(blueprint, repoState) → executePlan(client, …)
                          (pure)                                 (commit or PR)
```

The pure planner is deliberately split from the I/O executor: the planner is property-testable; the executor just applies its verdict.

## Working-with-AI tip

**Parallelize agents on files, not on features — and mint a type contract before you fan out.** The instinct with "build the GitHub layer" is to hand three agents three features and let them coordinate. They can't; they can't see each other's buffers, and they'll collide on the shared files. Instead: (a) write the shared interfaces yourself first — it's 20 minutes that removes every cross-agent ambiguity; (b) give each agent an exclusive set of *new* files and an explicit "do not touch" list; (c) keep the shared-file integration for a single serial pass. The tell that you've drawn the boundary right: the combined tree type-checks the first time, with no reconciliation round. If you find yourself about to run a second "make the modules agree" pass, the contract was too thin.

Corollary: let each parallel agent self-verify only its *own* test file (esbuild-transpiled, no cross-module type errors), and run the authoritative `tsc` once, centrally, after the barrier. Full typechecks mid-fan-out just produce false failures from half-written peers.
