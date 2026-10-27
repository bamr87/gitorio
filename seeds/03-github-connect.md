# Seed 03 — GitHub connect (read/write/deploy)

**Objective:** the app talks to a real repository: load/save blueprints and prompts, deploy compiled workflows, hook up power.

**Context:** docs/ARCHITECTURE.md §1–3, §8 · app/src/github/client.ts

**Tasks**
1. Octokit setup with fine-grained PAT from a connect dialog; token in
sessionStorage only; "disconnect" wipes it. Preflight: check token scopes/repo permissions and show a red/green checklist (Contents, Issues, PRs, Actions, Workflows, Secrets).
2. Repo picker → loads `.factory/blueprint.json` if present (else offers to initialize from the current canvas), loads prompt files referenced by agents.
3. Deploy: single commit (or PR when "propose changes" is checked) writing
blueprint + `.github/workflows/factory--*.yml` + new/changed prompts. Show the diff before committing. Delete workflows for assembly lines that no longer exist.
4. Power hookup: sealed-box provisioning of ANTHROPIC_API_KEY (fetch repo public
key → tweetnacl sealed box → PUT secret); UI shows power LED per repo. Manual fallback instructions if Secrets permission is missing.
5. Drift check: compare deployed workflow hashes to compiled output on load.

**Acceptance:** ROADMAP Phase 3 boxes; end-to-end demo on a scratch repo: deploy the Issue Triage Line, open an issue, watch the agent label + comment. **Out of scope:** telemetry UI (next seed), GitHub App auth.
