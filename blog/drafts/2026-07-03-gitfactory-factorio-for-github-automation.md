---
title: "GitFactory: Seeding a Factorio-Style Builder for GitHub Automation"
description: "Designing a static, serverless factory game whose blueprints compile into real GitHub Actions workflows powered by Claude Code agents — and the starter pack that lets Claude Code build it."
date: 2026-07-03
categories: [it-journey, ai-engineering]
tags: [github-actions, github-apps, claude-code, react-flow, ai-agents, automation, prompt-engineering]
draft: true
---

I've wanted a way to *see* repository automation for a while. GitHub workflows are powerful but invisible: triggers, permissions, and agent behaviors are scattered across YAML files, and the mental model lives only in your head. So the new project is unapologetically a video game: **GitFactory**, a Factorio-style canvas where you drag machines onto a factory floor, connect them with conveyor belts, and the blueprint compiles into workflows that run against your actual repos — with Claude Code agents as the machines' motors.

This post covers the architecture decisions baked into the starter pack, before a single feature session has run.

## Three moves that shape everything

**1. The blueprint lives in the repo it automates.** The factory graph is `.factory/blueprint.json` in the *target* repository, alongside the agent prompts in `.factory/prompts/*.md`. That one choice buys versioning, PR review of your automation design, portability, and shareability — blueprints export as base64url strings you can paste to a teammate, exactly like the game. It also means the UI can be completely stateless.

**2. GitHub Actions is the runtime; the app is just a compiler.** There is no server. The frontend is a static Vite/React site (deployable to GitHub Pages) that talks straight to the GitHub REST API. Pressing *Deploy* compiles the graph into `.github/workflows/factory--*.yml` files that use `anthropics/claude-code-action@v1` as the agent step. GitHub becomes the database (repo contents), the event bus (issues, PRs, comments, cron), and the compute layer (Actions runners). The emitted YAML is readable and works even if GitFactory disappears tomorrow.

**3. Sinks become obligations.** The interesting compiler trick: when a Claude agent machine has downstream sinks — *apply labels*, *post comment*, *open PR* — those sinks don't compile into steps. They compile into a numbered **obligations contract** appended to the agent's prompt, paired with narrowly scoped tool grants like `--allowedTools "Bash(gh issue edit:*),Bash(gh issue comment:*)"`. The graph you draw literally becomes the agent's job description and its capability boundary. Chains with no agent in them compile to plain deterministic `gh` CLI steps instead.

## The part that keeps you up at night

An agent that comments on issues, triggered by issue comments, is a perpetual motion machine — the bad kind. So loop safety is a *compiler* concern, not a documentation concern: every comment-ish trigger gets an automatic `github.event.*.user.type != 'Bot'` guard, every workflow gets per-entity `concurrency` groups, and the compiler flat-out refuses to emit a graph where a self-feeding loop would be unguarded. Same posture for prompt injection: issue bodies are attacker-controlled, so workflow files carry entity *numbers* (the agent fetches content itself), and permissions are scoped as if injection will succeed.

## The starter pack

The scaffold is built to be **constructed by Claude Code, session by session**:

- `CLAUDE.md` — architecture in ten lines, the metaphor glossary, and ten golden
rules (the compiler is pure and tested; least privilege always; verify upstream action inputs before templating; every session ends with a blog draft).
- `seeds/00–07` — ordered session prompts, each with context files, tasks, explicit
acceptance criteria, and an out-of-scope line. Canvas MVP → compiler → GitHub I/O → telemetry → prompt studio → agent patterns → GitHub App auth.
- `.claude/commands/` — `/add-machine` (a definition-of-done checklist for new
  machine types), `/compile-check` (drift + upstream verification), `/session-log`.
- A runnable canvas MVP (React Flow, industrial control-room theme, copper belts),
a working compiler with 13 passing invariant tests, and a dogfood blueprint whose compiled output is checked in as a *verified* reference example.

Kickoff is one line: `Read CLAUDE.md, then execute seeds/00-bootstrap.md.`

## Working-with-AI tips

**Verify, don't recall — and write the rule down.** The `claude-code-action` inputs changed at v1 (`direct_prompt`/`allowed_tools` → `prompt`/`claude_args`). Instead of trusting anyone's memory (mine or the model's), the scaffold was built by fetching the live `action.yml` first, and CLAUDE.md golden rule #4 makes that fetch a required step before any compiler change. Encoding "check upstream before templating" as a standing rule turns a one-time verification into a permanent habit for every future session.

**Seeds are session contracts.** Each seed file states acceptance criteria *and* an out-of-scope line. That second part matters more: it gives the AI (and me) permission to park good ideas in the backlog instead of scope-creeping a session. The unit of progress becomes "a seed passed its criteria," which is reviewable.

**Make the AI converge on a verified example.** The repo ships `examples/compiled/factory--issue-triage-line-1.yml` — not hand-written, but captured from the actual compiler's output after the tests passed, with a header saying how to regenerate it. Future sessions now have a concrete target: diff against the reference, and any drift is either a bug or a deliberate, documented decision. Reference artifacts beat prose specs for keeping multi-session AI work honest.

Next session: seed 01, making the factory floor feel like a tool.
