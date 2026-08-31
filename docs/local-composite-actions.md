# Trust boundary: local composite actions

> **Scope.** This note is about actions referenced as `uses: ./...` — composite (or
> JavaScript, or Docker) actions that live in this repository, conventionally under
> `.github/actions/`. It is the companion to the SHA-pinning policy, which exempts
> those references. See [`docs/action-pinning.md`](action-pinning.md) for the pinning
> rules themselves.

## The exemption, and why it is correct

Third-party actions are pinned to a full commit SHA, because `uses: owner/repo@v1`
is a mutable pointer: whoever controls that tag controls what runs inside our job,
with our job's secrets, retroactively. Pinning removes that mutability.

`uses: ./...` has no such pointer to pin. A local action is resolved from *this*
repository, at the commit the workflow run is operating on. There is no upstream
owner, no tag to move, and no SHA to add that would not be a tautology. Writing
`uses: ./.github/actions/foo@<sha>` is not even valid syntax. So the pinning policy
exempts it, and that is the right call.

## What the exemption costs

The pinning policy answers "can a third party change what runs in our jobs without
our review?" It does **not** answer "can *we* change what runs in our jobs without
noticing?"

A local composite action is not a helper script. It is workflow code:

- **It runs with the job's permissions.** Whatever `permissions:` the calling job
  declares, the composite action's steps inherit.
- **It runs with the job's secrets.** Any secret passed into the job — a Claude auth
  token, a `GITHUB_TOKEN` with write scopes, a deploy credential — is reachable from
  a step inside the action. It does not need to be passed in as an input; the
  environment is shared.
- **It is trusted transitively.** A workflow that has been carefully reviewed for
  least privilege can be silently widened by a one-line edit to an action it calls.
  The diff shows up under `.github/actions/`, not under `.github/workflows/`, which
  is exactly where a reviewer's attention is *not*.

**Therefore: `.github/actions/**` is inside the same trust boundary as
`.github/workflows/**`.** Changes there get workflow-grade review, not
script-grade review.

## The `pull_request` nuance

This is the part that surprises people, so it is worth stating plainly.

For a `pull_request` event, GitHub reads the **workflow definition** from the base
branch. A PR cannot change the workflow that runs against it. But `uses: ./...` is
not resolved from the base branch — it is resolved from the **workspace**, i.e.
from whatever `actions/checkout` put on disk. `actions/checkout` on a
`pull_request` event checks out the PR's merge ref by default, which contains the
PR's changes.

So a pull request *can* change the body of a local composite action that the base
branch's workflow then executes.

For `pull_request` from a fork this is bounded: GitHub withholds secrets and issues
a read-only `GITHUB_TOKEN`, so the attacker-controlled action runs with nothing
worth stealing. The danger is the combinations that remove that bound:

- **`pull_request_target`** — runs with the base repo's secrets and a writable
  token. If such a workflow checks out PR head code *and* calls a local action, the
  PR author's code runs with full credentials. This is the classic
  pwn-request shape, and the local-action exemption is one of the ways it hides.
- **Workflows that explicitly check out `github.event.pull_request.head.sha`** and
  then call `./...` steps.
- **Branch pushes from collaborators**, where secrets *are* available and the
  checked-out code is the branch under review.

### Rule

> If a workflow has access to real secrets or a writable token, it must not execute
> a local composite action whose body came from an untrusted ref. Either pin the
> checkout to a trusted ref before the `uses: ./...` step, or split the privileged
> work into a separate workflow that never checks out PR head code.

## Reviewing a change under `.github/actions/`

Treat the PR as a change to CI privilege, not as a refactor. Checklist:

1. **Read every line of the diff.** "Extract these steps into a composite action"
   is a change that moves privileged code out of the file reviewers watch. The
   extraction being behaviour-preserving is a claim to verify, not to accept.
2. **New `run:` steps** — what do they execute, and where does that come from?
   Reject anything that fetches and executes remote content at runtime
   (`curl ... | sh`, `npx <unpinned>`, downloading a binary from a URL). The whole
   point of the pinning policy is that what runs is decided at review time.
3. **Third-party `uses:` *inside* the composite action** — these are **not**
   exempt. The exemption covers the `./` reference from the workflow to the local
   action; it does not cover what the local action itself pulls in. Every
   `owner/repo@...` inside `.github/actions/**` must be pinned to a full commit SHA
   under the same policy as a workflow file.
4. **Script injection via inputs.** `${{ inputs.foo }}` and `${{ github.event.* }}`
   interpolated directly into a `run:` block are string-substituted into the shell
   *before* execution. Issue titles, branch names and PR bodies are attacker-
   controlled. Pass them through `env:` and reference `"$FOO"` in the script
   instead.
5. **Secret handling.** Does the action echo, log, or write a secret anywhere?
   Does it pass one to a subprocess whose argv lands in logs? Does it need the
   secret at all, or is it there because the job already had it?
6. **Blast radius.** Which workflows call this action, and what are *their*
   `permissions:`? An action used only by a lint job is a different risk than one
   used by a job that can push commits or comment as the app.
7. **Does the calling workflow still declare least privilege?** A composite action
   cannot raise its caller's permissions, but a change to the action can make the
   caller's currently-granted permissions newly *reachable* by new code.

## Enforcement: CODEOWNERS

Review discipline that depends on a reviewer remembering this document will fail.
The mechanical backstop is CODEOWNERS coverage of the action paths, combined with
branch protection's *Require review from Code Owners*.

If `CODEOWNERS` does not currently list `.github/actions/`, add it alongside the
workflow paths — a pattern such as:

```
/.github/workflows/   @maintainers
/.github/actions/     @maintainers
```

> **To confirm:** whether this repository has a `CODEOWNERS` file, whether it
> already covers `.github/**`, and whether branch protection requires code-owner
> review. If it does, this section should be rewritten as a statement of what is
> enforced rather than a recommendation.

## Interaction with generated workflows

The compiled `factory--*.yml` workflows carry a `GENERATED BY GITFACTORY` header
and are never hand-edited (see [`docs/GENERATED-FILES.md`](GENERATED-FILES.md)).
If the compiler ever emits `uses: ./.github/actions/...`, note that the action body
is then a *hand-maintained input to a generated file*: the generated workflow is
reproducible, but what it executes is not fully determined by the blueprint.
That is not necessarily wrong — it is how shared step logic gets factored — but it
means the determinism guarantee stops at the `./` boundary and the review
checklist above is what covers the rest.

## Summary

| | Third-party action | Local composite action |
| --- | --- | --- |
| Referenced as | `owner/repo@<sha>` | `uses: ./...` |
| Pinning required | Yes, full commit SHA | N/A — fixed at this repo's commit |
| Can change without our review | No (that is what pinning prevents) | Yes — any PR touching the action |
| Runs with job secrets | Yes | Yes |
| Reviewed as | Supply-chain dependency | **Workflow code** |

The pinning exemption closes the supply-chain hole and opens a review hole. This
document is the review hole's patch.

## See also

- [`docs/action-pinning.md`](action-pinning.md) — the pinning policy and the
  exemption itself.
- [`docs/GENERATED-FILES.md`](GENERATED-FILES.md) — which workflows are compiled,
  and the determinism / action-pinning guarantees around them.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — auth phases and the overall security
  model.
- [`SECURITY.md`](../SECURITY.md) — how to report a vulnerability.
