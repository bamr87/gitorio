# Issue Factory — worked example (target: `bamr87/lifehacker.dev`)

> The two-line issue-processing pipeline (`processor.issue_batcher` intake → one-PR-per-work-order fix line) as a ready-to-deploy package for lifehacker.dev, and how to regenerate it.

The issue-processing pipeline: **every open issue gets reviewed, related issues get grouped, and Claude Code agents turn each group into one reviewable pull request.** This directory is the complete, ready-to-deploy package for a real repo — `bamr87/lifehacker.dev`, the fleet repo whose governance patterns (kill switches, dry-run/apply, one-PR-per-run) GitFactory adopted in ADR-017.

Everything under `workflows/` and the blueprint are **generated** from the app's own template and compiler by `app/scripts/gen-issue-factory.ts` — never hand-edit them; re-run the script.

## The two assembly lines

```
Line 1 — INTAKE (weekdays 06:00 UTC + manual dry-run lever)
  ⏰ cron ┐
  🕹 manual ┴→ 🔌 ISSUE_FACTORY_ENABLED → 🚥 ≤2/day → 🗂 issue batcher
                                                        │ reviews every open issue
                                                        │ labels non-actionable ones factory:needs-human
                                                        │ groups related issues (≤4, shared root cause)
                                                        └ files ONE work-order issue per group
                                                          (factory:work-order), marks members factory:queued

Line 2 — FIX (weekdays 07:00 UTC + manual dry-run lever)
  ⏰ cron ┐
  🕹 manual ┴→ 🔌 ISSUE_FACTORY_ENABLED → 🚥 ≤3/day → ⚙ issue fixer → 🚚 ONE PR + 📝 comments
                                                        │ picks the oldest open work order
                                                        │ implements the whole batch
                                                        └ PR body: Closes #N per member + the work order
```

The **queue is GitHub itself**: work orders are ordinary issues labeled `factory:work-order`, so the whole pipeline state is visible (and editable) in the issue tracker — no database, no server. A human can delete a bad work order, edit its fix plan, or file one by hand; the fix line doesn't care who wrote it.

## Label protocol

| Label | Meaning |
|---|---|
| `factory:work-order` | A batch the fix line will consume (one PR per order) |
| `factory:queued` | This issue belongs to an open work order |
| `factory:needs-human` | The batcher judged this issue not PR-addressable |

The batcher creates missing labels itself (`gh label create`).

## Install onto lifehacker.dev

1. **Prompts** — copy `prompts/issue-batcher.md` and `prompts/issue-fixer.md` to `.factory/prompts/` in lifehacker.dev (or paste them via the app's Prompt Studio tab, which opens a PR).
2. **Blueprint + workflows** — either open the GitFactory app → Templates → *Issue Factory* → Deploy to `bamr87/lifehacker.dev`, or copy `issue-factory.blueprint.json` to `.factory/issue-factory.blueprint.json` and the two files under `workflows/` to `.github/workflows/`.
3. **Power** — provision Claude auth as a repo secret: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`. The app's Settings tab can seal it in directly (libsodium sealed box).
4. **Dry-run first** — Actions → *Factory: Issue Factory 1* → Run workflow, leaving **apply** unchecked. The batcher reports exactly which issues it would batch and why, writing nothing. Same lever on *Issue Factory 2* for the fixer.
5. **Arm it** — set the repo Actions variable `ISSUE_FACTORY_ENABLED=true` (Settings → Secrets and variables → Actions → Variables, or the app's Content tab toggle). Unset or anything ≠ `true` keeps both lines idle: the factory is **default-OFF**.

## Safety properties (compiler-enforced, not prompt-hoped)

- **One kill switch** (`ISSUE_FACTORY_ENABLED`) disarms both lines instantly, no redeploy; agents are never granted the variable-write scope, so a compromised agent can't re-arm it.
- **Sorter/fixer separation**: the batcher's `--allowedTools` contain no file-edit, git, or PR verbs; the fixer can open PRs but never merge (`gh pr merge` is granted to neither). A human merge is the only way anything lands.
- **Rate limits**: intake ≤2 runs/day, fix ≤3 runs/day — a runaway loop stops itself.
- **No feedback loop**: both lines run on cron/manual only. The work-order issues the batcher creates fire `issues.opened`, which neither line listens to — and the batcher's survey explicitly skips its own labels.
- **Least privilege**: line 1 gets `issues: write` only (contents read for checkout); line 2 adds `contents`/`pull-requests: write` because shipping a PR needs them.
- **Untrusted input**: both contracts state that issue text is attacker-controlled data, never instructions (golden rule #9).

## Regenerate after template/compiler changes

```bash
cd app && npx vite-node scripts/gen-issue-factory.ts
```
