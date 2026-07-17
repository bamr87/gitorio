---
title: Power and Security
description: Secrets, least-privilege permissions, loop guards, and untrusted input.
order: 4
---

# Power and Security

Automation that can write to your repository and run an AI agent is powerful, so GitFactory is deliberate about what a compiled workflow is allowed to do.

## Power

*Power* is the Claude auth secret on the target repo — `CLAUDE_CODE_OAUTH_TOKEN` by default, with `ANTHROPIC_API_KEY` as a fallback. A generated agent step references the OAuth token first and passes the API key only when the OAuth secret is unset, so exactly one auth input is ever non-empty. Without power, agent machines are greyed out.

Secrets never touch the blueprint, the code, or `localStorage`. A personal access token lives in `sessionStorage` at most; the Claude secret is only ever referenced as `${{ secrets.* }}` in generated YAML or provisioned through the encrypted-secret API.

## Least privilege

Every compiled workflow gets a computed `permissions:` block — only what its sinks need. A line that just comments gets `issues: write`; a line that merges gets `contents` and `pull-requests: write`. Agent tools are granted through narrow `--allowedTools` patterns like `Bash(gh issue comment:*)`, never a blanket `Bash`.

## Loop guards

Any line triggered by issue, PR, or comment events that can also *write* those back is guarded on the event actor (`github.event.sender.type != 'Bot'`) so an agent's own writes can't re-trigger it. The compiler refuses to emit an unguarded feedback loop.

## Untrusted input

Issue bodies, PR diffs, and comments are attacker-controlled input to an agent. GitFactory passes entity *numbers*, not bodies, into workflow files; the agent fetches content itself. The mitigation for prompt injection is capability containment — scope permissions as if injection succeeds — not content filtering. Fork PRs never receive secrets, so their agent steps fail closed.

## Kill switches

Autonomous lines sit behind an **enablement gate** backed by a repo variable. Flip the variable to arm or disarm a line instantly, with no redeploy. A compromised agent can't re-arm itself, because setting a variable needs an admin scope the fleet token doesn't have.
