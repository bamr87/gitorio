# Action pinning policy

Every external GitHub Action referenced from a workflow in this repository must be
pinned to a **full 40-character commit SHA**. A CI gate ("pin-check") enforces this,
and it will fail your pull request if it finds an unpinned reference.

If you have landed here because the gate failed: you are in the right place. Read
[How to fix a failing pin-check](#how-to-fix-a-failing-pin-check) and
[No, please do not disable the gate](#no-please-do-not-disable-the-gate).

## The rule

```yaml
# ✅ allowed — full 40-character commit SHA, with the human-readable tag in a comment
- uses: actions/checkout@<40-character-commit-sha> # v4.2.2

# ❌ rejected — mutable tag
- uses: actions/checkout@v4

# ❌ rejected — mutable branch
- uses: some-org/some-action@main

# ❌ rejected — abbreviated SHA (must be the full 40 characters)
- uses: some-org/some-action@a1b2c3d
```

## Why

A tag or a branch is a **mutable pointer**. `actions/checkout@v4` means "whatever
commit the `v4` tag points at the next time this workflow runs" — and the owner of
that repository (or anyone who compromises it) can move the tag at any moment.

That matters more here than in an average repo, for two reasons:

1. **These workflows run agents with credentials.** A GitFactory-deployed workflow
   runs Claude Code with a Claude auth secret on the target repository (see the
   "connecting power" section of the [README](../README.md)). Any step in the same
   job is a step that could read the job's environment and tokens.
2. **The blueprints are the product.** The compiler's output is meant to be
   "readable, auditable, and works without GitFactory existing" (README, *Why this
   shape*). An auditable workflow is one where you can point at every third-party
   commit that will execute.

A commit SHA is immutable. Pinning turns "trust this org forever" into "trust this
exact reviewed commit until someone deliberately bumps it in a reviewable diff".

See also [SECURITY.md](../SECURITY.md) for the wider threat model and for how to
report a vulnerability.

## Exemptions

Two forms of reference are exempt from the gate, because pinning them would be
meaningless or impossible:

### 1. Local composite actions — `uses: ./...`

```yaml
- uses: ./.github/actions/some-local-action   # exempt
```

A `./` reference resolves inside the repository at **the commit the workflow is
already running from**. There is no separate upstream to pin: the checked-out tree
*is* the pin. Adding a SHA here would either be redundant or invalid.

The security consequence is worth naming out loud: local composite actions are
trusted transitively, so a change to a file under a local action directory deserves
the same review attention as a change to the workflow itself. Reviewers should treat
edits to local composite actions as workflow edits.

### 2. Docker references — `uses: docker://...`

```yaml
- uses: docker://alpine:3.20                              # exempt from the SHA rule
- uses: docker://ghcr.io/example/tool@sha256:<digest>      # preferred, if you can
```

A `docker://` reference addresses a container image, not a Git commit. There is no
40-character Git SHA to supply, so the gate skips these.

That exemption is about the *check*, not about safety. If the registry supports it,
prefer an immutable image digest (`@sha256:...`) over a mutable image tag, for the
same reason we pin actions at all. A mutable `docker://tool:latest` is exactly the
risk the pinning policy exists to remove — it simply cannot be expressed as a Git
SHA, so it falls outside the gate's reach and lands squarely on the reviewer.

### What is *not* exempt

- Actions from `actions/`, `github/`, or any other first-party GitHub org. Popularity
  is not immutability; pin them like everything else.
- Actions you also maintain in another repository of your own. Same reasoning: a
  separate repository is a separate mutable pointer.
- Reusable workflows called with `uses:` at the job level. If you reference another
  repository, pin it.

## Adding or updating a pin

**Always record the human-readable version in a trailing comment.** The SHA is what
the runner uses; the comment is what humans and reviewers read.

```yaml
- uses: actions/checkout@<40-character-commit-sha> # v4.2.2
```

Without that comment, a diff that bumps one opaque hex string to another opaque hex
string is unreviewable. With it, the diff reads as "v4.2.1 → v4.2.2" and a reviewer
can sanity-check the upstream release notes.

To find the SHA for a tag without cloning:

```bash
git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>
```

Use the commit SHA that command prints. (For annotated tags, `git ls-remote` also
lists a `refs/tags/<tag>^{}` entry; that dereferenced entry is the commit you want.)
You can also copy the SHA from the release's commit page in the GitHub UI.

When you bump a pin:

1. Look at what changed upstream between the old tag and the new one. Pinning only
   helps if somebody actually reads the diff at bump time.
2. Update the SHA **and** the trailing comment together. A stale comment is worse
   than no comment, because it lies.
3. Keep the bump in its own commit where practical, so it is easy to revert.

## How to fix a failing pin-check

1. Read the gate's output — it should name the file and the offending `uses:` line.
2. Resolve the tag you intended to use to a full commit SHA (see above).
3. Replace the tag with the SHA and add `# <tag>` after it.
4. Push. If the gate still fails, check for an abbreviated SHA (it must be the full
   40 characters) or a second unpinned reference in the same file.

## No, please do not disable the gate

If the gate is blocking you, the fix is a pin, not a `continue-on-error`, not a
deleted job, not a widened ignore pattern. The gate is cheap to satisfy — usually one
`git ls-remote` and one edit.

If you believe a reference genuinely cannot be pinned and is not covered by the two
exemptions above, open an issue describing the reference and why, rather than
weakening the check in a PR. A documented, argued exemption is reviewable; a silently
relaxed gate is not.
