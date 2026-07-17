---
title: "Defaulting the Agent Runtime to Claude Code OAuth (with an API-Key Fallback)"
description: "Making GitFactory's compiled workflows authenticate the way a real fleet does — Claude Code OAuth token first, Anthropic API key as fallback — using one Actions expression that guarantees exactly one auth input is ever set."
date: 2026-07-04
categories: [it-journey, ai-engineering]
tags: [github-actions, claude-code, oauth, compilers, auth, claude-code-action]
draft: true
---

GitFactory compiled every agent step with `anthropic_api_key`. But the real fleet it's meant to plug into — `lifehacker.dev` — authenticates its agents with a **Claude Code OAuth token** (`claude setup-token`) and falls back to the API key. So the framework should default the same way.

## Verify the contract before you template it

The project's golden rule #4 is "verify, don't recall" for anything touching `claude-code-action`. So before changing a line, I fetched the live `action.yml`. Two facts mattered: `claude_code_oauth_token` exists (described as "alternative to anthropic_api_key"), and both auth inputs are optional. Good — the default is switchable without breaking API-key users.

## One expression, exactly one non-empty input

"OAuth primary, API fallback" is easy to get *subtly* wrong. If you pass both secrets and let the action pick, you're betting on undocumented precedence — and if both happen to be set, behavior is ambiguous. So the compiler emits an expression that makes the choice itself:

```yaml
claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
anthropic_api_key: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets.ANTHROPIC_API_KEY || '' }}
```

The API key is non-empty **only** when the OAuth secret is unset. So at runtime exactly one input is populated — OAuth if present, else the key, else neither (factory greys out). No precedence guessing, and the action never sees both. The power-hookup UI follows suit: a two-option selector (OAuth default), the LED lights when *either* secret exists, and the dev `.env` gained a build-guarded `VITE_CLAUDE_CODE_OAUTH_TOKEN`.

## Working-with-AI tip

**When you wire "primary with fallback," don't delegate the choice to a component whose precedence you haven't verified — encode the selection where you control it.** The instinct is "pass both, it'll figure it out." But "it'll figure it out" is an assumption, and assumptions in generated code fail silently in someone else's repo. A single conditional that guarantees *exactly one* value is set turns an untested dependency-behavior into a property you can assert in a test (`toContain("CLAUDE_CODE_OAUTH_TOKEN == '' && …")`). The broader move: push ambiguity to the edge you own, and leave the third-party thing a boring, unambiguous input.
