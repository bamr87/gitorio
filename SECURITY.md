# Security Policy

> How to report a vulnerability privately, and a summary of the security invariants every compiled workflow keeps.

GitFactory compiles user-designed blueprints into **real GitHub Actions workflows that run agents with write access to real repositories**, so security is a first-class design constraint, not an afterthought. The threat model and defenses live in [`docs/ARCHITECTURE.md` § 8 (Security model)](docs/ARCHITECTURE.md); this file is the disclosure policy and a summary of the load-bearing invariants.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (the **Security → Report a vulnerability** tab on this repo). Include a description, repro steps, and the impact. We aim to acknowledge within a few days and will coordinate a fix and disclosure timeline with you.

## Security invariants (see AGENTS.md § Golden rules)

These are the guarantees the codebase must never break — a change that weakens one is a security regression:

1. **Secrets never touch the blueprint, the code, or `localStorage`.** Fine-grained PATs
live in `sessionStorage` at most (or a DEV-only `.env` that a build guard keeps out of any bundle). The Claude auth secrets — `CLAUDE_CODE_OAUTH_TOKEN` (default) and `ANTHROPIC_API_KEY` (fallback) — are only ever referenced as `${{ secrets.* }}` in generated YAML, or provisioned via the encrypted-secret API (libsodium sealed box) — never logged, never persisted client-side.
2. **Least privilege.** Every compiled workflow gets a *computed* `permissions:` block
granting only what its sinks require, and agent tools are granted via narrow `--allowedTools` patterns (e.g. `Bash(gh issue comment:*)`), never blanket `Bash`.
3. **Loop guards are mandatory.** A workflow that can both be triggered by and write
comments/issues must guard against retriggering itself; the compiler refuses to emit an unguarded feedback loop.
4. **Untrusted content is untrusted.** Issue bodies, PR diffs, and comments are
attacker-controlled input to agents. Generated prompts pass entity *numbers*, not bodies (the agent fetches content via `gh`), so injection is contained by capability scoping rather than content trust. **Fork PRs never receive secrets.**

## Supported versions

Pre-alpha. Security fixes land on `main`; there are no released versions yet.
