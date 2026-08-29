# Vendored: tt-a1i/archify

- **Upstream**: https://github.com/tt-a1i/archify
- **Commit**: `7fe139ebe2e532941eb4c315057294348e88a2c0` (package version `2.16.0-dev.0`, upstream date 2026-08-28)
- **Vendored on**: 2026-08-28 (ADR-034, specs/010-archify-maps)
- **License**: MIT — see `LICENSE` (unchanged)

## What is here

The runnable skill: `bin/`, `renderers/`, `schemas/`, `assets/template.html`, `brand-marks/`, `recipes/`, `references/`, `delta/`, `scripts/` (validator/brand-mark generators), `examples/*.json` (the IR examples, used as determinism fixtures), `SKILL.md`, `DESIGN.md`, `PRODUCT.md`, `package.json`.

## What was omitted

`test/` (1.1 MB), rendered `examples/*.html`, the docs site, `benchmarks/`, `experiments/`, `integrations/`, `archify.zip`, and `scripts/render-examples.mjs`.

## Rules

- Never edit files here; bump the pin instead (re-copy from upstream, update this file, re-run `npm run maps` and the tests).
- Never invoke `brands capture` from scripts or CI — it reaches the network (spec NFR-SEC-1).
- Nothing under `vendor/` may be imported by `app/src/**` (golden rule #1); only `app/scripts/*` and tests may spawn the CLI.
