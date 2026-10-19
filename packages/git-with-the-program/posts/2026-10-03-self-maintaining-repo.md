---
title: "The Self-Maintaining Repo: Letting AI Write the Words, Never the Rules"
date: 2026-10-03
draft: true
tags: [github, automation, ai-agents, github-actions, json-schema, semver, release-engineering, prompt-injection]
---

*Draft for it-journey. Built in one Claude Code session on top of Git with the Program (GWTP).*

Here's an embarrassing audit. The day this feature was built, the repository for an **AI governance framework** had all of these problems:

- an empty GitHub description and zero topics,
- no tags and no releases, despite `package.json` saying `0.1.0` for months,
- none of the labels its own engine applies when it files issues,
- `"license": "MIT"` in `package.json` but no `LICENSE` file, so GitHub showed "no license",
- a README that said *"Implementation not started"* above 80 source files.

None of this is code rot. Call it **presentation rot**: the things a stranger reads first quietly stop matching the repository. Every repo gets it, because nobody owns "the GitHub sidebar." The goal here was a repo that keeps its own sidebar honest, on demand or weekly, with an AI providing the words.

## The trap: "just let an agent tidy it up"

The obvious build is a weekly cron that runs an AI agent with a GitHub token and the instruction "keep the repo tidy." It works in a demo. Then it fails in three predictable ways:

1. **It oscillates.** Ask a model to "improve the description" every week and it rewrites it every week. The output is stochastic, so nothing converges.
2. **It's unauditable.** What did it change, and why? You get a transcript, not a contract.
3. **It's steerable by whatever it reads.** The agent reads READMEs and commit messages, which is text other people write. A weekly job with a write token, steered by untrusted text, is a prompt-injection target with a schedule.

## The pattern: a deterministic plan with content slots

The design that works splits the job along one line: **derive what can be derived, and author only what must be authored.**

```
config (.github/upkeep.yaml)  ─┐
tree + git history (read-only) ├─► PLAN (pure, schema-validated) ──► APPLY (forge only)
GitHub API (read)             ─┘     │  findings                        tags, releases,
                                     │  actions                         labels, description,
                                     │  content slots ◄── AI author     topics
                                     └─► in-tree checklist ──► reviewed PR (opt-in agent)
```

- **The plan is pure.** Same inputs, same plan, byte for byte. It lists *findings* (what drifted), *actions* (API calls that fix remote drift), and *content slots*.
- **A content slot** is a value only an author can provide: a release summary, a missing description, extra topics, a review of stale docs. Each slot carries a brief (instructions plus context as JSON), a contract (one line and at most 350 chars; valid topic syntax; markdown under 20k), and a **deterministic fallback**. If no AI is configured, or the AI refuses or returns garbage, the run still completes with the fallback, and the report says so.
- **Apply writes GitHub, never the repository.** Anything that needs a commit (a version bump, a README fix, a LICENSE file) becomes a checklist item, and an opt-in job hands that checklist to an agent that opens a **draft PR**. Automatic for the sidebar, reviewed for the tree.

## Convergence is a property you can test

"Self-maintaining" only means something if a second run is quiet. Three rules made that true:

1. **AI fills only what is empty.** A missing description gets written once. An existing one is never "improved."
2. **Add and set, never delete.** Topics merge with the ones humans added, and labels are never removed. The adapter has no delete method at all, so this is structural, not a matter of discipline.
3. **Anything that needs a commit isn't an action.** It's a finding with a remedy.

The test is short: build a plan, simulate applying it, observe again, and assert there are no remote actions. Write that test first. It catches oscillation before production does.

## Programmatic references beat "remember to update the docs"

"The README lists every schema" is a promise nobody keeps. Here it's a rule:

```yaml
references:
  - id: schemas-in-readme
    doc: README.md
    items: { glob: "schemas/*.schema.json", capture: '^schemas/(.+)\.schema\.json$' }
    mention: "{item}"
  - id: cli-in-claude-md
    doc: CLAUDE.md
    items: { file: src/cli/index.ts, pattern: '^  ([a-z]+): \{$' }
    mention: "gwtp {item}"
```

The list is *extracted* from the tree: schema files from a glob, CLI commands from the command table's source. When someone adds a schema or a command and forgets the doc, the next run reports exactly which mention is missing and where. On its first run this caught `CLAUDE.md` failing to name three CLI commands.

The same idea applies to labels. Upkeep doesn't keep its own list of "labels the repo needs." It imports the function the issue-filing code uses to label proposals. If that code changes, the maintained label set changes with it, and nothing has to be restated.

## Release engineering details that matter

- **Tag where the version was introduced, not at HEAD.** `package.json` said `0.1.0` from the v0 engine commit onward, and 11 more commits landed after it. Tagging HEAD would claim those commits shipped in 0.1.0. Instead the engine walks back through the commits that touched `package.json` to find where `0.1.0` began, tags that commit, and reports the 11 later commits as *unreleased*, with a suggested `0.2.0`.
- **Suggest bumps from commit messages, with reasons.** Conventional commits (`feat:` → minor, `!` → major) are read when present. Plain-English subjects fall back to a verb heuristic (`Build…`, `Add…` → minor). Below 1.0, breaking changes bump minor. The suggestion ships with the commits that decided it, so a reviewer can disagree quickly.
- **Release notes = AI summary + deterministic changelog.** The commit list between tags is generated and never touched by the AI. The model writes the paragraph *above* it. That gives you facts you can trust and prose that reads well.
- **No author identities in release notes.** The git format strings never request `%an` or `%ae`. Who wrote a change isn't evidence of what it did, and it keeps the notes privacy-light.

## Securing the AI step

The AI author can be a direct API call or a Claude Code agent editing the plan file. The agent path is the interesting one, because the plan file is the *work order* for the job that holds the write token. Four layers keep it honest:

1. **Separate jobs, separate tokens.** The job where the AI runs is read-only. The job that writes to GitHub runs no AI.
2. **Path-scoped tools.** The agent gets `Edit(.gwtp/upkeep/plan.json)` and `Bash(… upkeep check:*)`, and nothing broader.
3. **An enforced write surface.** `gwtp upkeep check --against <engine's plan>` diffs the plan the engine wrote against the one the agent returned. If anything other than `content[].status/value/provider/note` changed (an added action, a moved tag SHA, an edited fallback), it's flagged as tampering and the run stops before apply sees it.
4. **Re-validation at use.** Apply re-checks every authored value against its contract. An invalid value falls back to the deterministic one.

The worst-case outcome of a successful prompt injection becomes "a bounded, schema-valid string in a content slot." That's a far smaller problem than an agent holding a write token.

I wrote the first version without layer 3, and the spec already claimed "the agent can't add actions." An adversarial re-read of my own diff before pushing caught that the claim was an instruction, not a check. **If your design doc says "cannot," find the line of code that makes it so.**

## AI-assisted building: what worked

- **Point the agent at the real thing first.** Before writing code, a read-only `gh api` call showed the actual repo state: null description, empty topics, missing labels. That turned an abstract feature into a list of concrete bugs, and the first live plan became the acceptance test.
- **Make the AI's job a schema.** "Set these three fields so `check` prints PASS" is an agent task with a verifiable finish line. "Tidy the repo" isn't.
- **Every AI output needs a fallback.** Design the no-AI path first. If the system is correct without the model, the model can only make it better.
- **Fit the house style.** This codebase cites spec sections in module headers, returns errors as data, and uses injectable seams for every I/O boundary. Matching that (a forge-neutral port, fake transports in tests, no network in CI) made 89 new tests cheap to write and kept the full suite green: 1487 tests.
- **Write the open questions down.** Where existing law was silent (is the plan inside the "everything validates" invariant? is a PR-opening agent a "machine actor"?), the session shipped the least-committal reading and recorded each question, pinned to the line of code a human would change.

## Try the pattern

You don't need GWTP to use this. The portable recipe:

1. A config that declares where each piece of presentation comes from (README, `package.json`, or literal).
2. A pure planner that diffs config + tree + history against the forge API.
3. Content slots with contracts and fallbacks for anything that needs writing.
4. An apply step that only adds and sets, through an adapter with no delete method.
5. A checklist, not a commit, for anything in the tree.
6. A weekly workflow, plus a manual "run now" button.

Your sidebar is documentation too. Hold it to the same standard as the code.
