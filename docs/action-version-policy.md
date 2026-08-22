# Action version policy

This repository enforces one rule about GitHub Actions versions, and it is
stricter than what most repositories do:

> **Every third-party action referenced anywhere in this repository must be
> pinned to the same version everywhere.** One distinct version per action, repo-wide.

A CI check (`scripts/check-action-versions.sh`) fails the build when it finds
the same action referenced at two different versions. If you have landed here
from a red CI job, skip to [Fixing a failure](#fixing-a-failure).

## Why the rule is this strict

In a normal repository, `actions/checkout@v4` in one workflow and
`actions/checkout@v3` in another is untidy but harmless — the drift is contained
by the repo boundary.

This repository does not have that boundary. Blueprints compile to real GitHub
Actions workflows that are written into **other people's repositories**. The
`uses:` tags in a blueprint or a compiler template are not consumed here; they
are *propagated* — copied verbatim into every repo that deploys a factory built
from them. That changes the blast radius of a stale tag in two ways:

- **It ships.** A version that is deprecated, yanked, or carrying a known
  advisory does not just sit in our CI — it lands in downstream repos, on
  workflows the downstream maintainer did not write and may not read closely.
- **We cannot patch it back.** Once a workflow is committed downstream, we have
  no mechanism to update it. Correcting the tag here only affects repos that
  deploy *after* the fix. Everything already emitted keeps the old pin.

So the pin in a blueprint template is closer to a published artifact than to a
CI detail. Uniformity is what makes that artifact auditable: if there is exactly
one version of an action in the tree, then "what version of `actions/checkout`
do we emit?" has one answer you can grep for, and a bump is one reviewable diff
rather than an archaeology exercise.

The secondary benefit is ordinary hygiene. Divergent pins are how an action
quietly stays three majors behind in the one workflow nobody looks at.

## Bumping an action everywhere at once

Bumping is deliberately an all-or-nothing operation. The workflow:

1. **Find every reference.** Grep the whole tree, not just `.github/workflows/` —
   blueprint templates, examples, seeds, and docs snippets all count, because
   examples get copied:

   ```bash
   grep -rn 'actions/checkout@' . --exclude-dir=node_modules --exclude-dir=.git
   ```

2. **Change all of them in one commit.** Same version everywhere, including any
   occurrences inside `examples/` and `_docs/`. A partial bump will fail the
   check just as a partial drift would — which is the point.

3. **Re-run the checker locally** before pushing (see below).

4. **Say what changed in the PR description.** Because the new pin propagates
   downstream, an action bump is a user-visible change, not a chore. Note the
   old and new versions and anything in the action's release notes that alters
   behaviour for emitted workflows.

Keeping a bump to a single self-contained commit also makes it trivially
revertable if the new version misbehaves downstream.

### Running it locally

Run the checker from the repository root before opening a PR:

```bash
bash scripts/check-action-versions.sh
```

It reports the conflicting references, so the fix is usually mechanical.

## Fixing a failure

When the check fails, it is telling you that an action now appears at two or
more versions. In nearly every case the cause is one of these:

- You added a new workflow or blueprint and pinned an action to whatever version
  the docs or a snippet you copied happened to use. **Fix:** match the version
  already in the tree.
- You bumped an action in the file you were working on, without bumping its
  siblings. **Fix:** finish the bump — see above.
- A dependency-update bot bumped one file. **Fix:** extend the bot's PR to cover
  the rest, or bump the rest in a follow-up commit on the same branch.

The fix is almost never an ignore-list entry.

## The escape hatch: `.github/action-version-ignore.txt`

Entries in `.github/action-version-ignore.txt` exempt an action from the
one-version rule. It exists because the rule is a heuristic and heuristics have
edges — but every entry is a permanent hole in the audit story, so the bar is
high.

### When an entry is legitimate

- **Genuinely version-locked consumers.** A fixture, regression test, or example
  that exists specifically to demonstrate an *older* pin — for instance, a
  compiler test asserting that legacy blueprints still compile. The old version
  is the subject of the test, so bumping it would destroy what the test is for.
- **A pinned-by-necessity action.** An action where one call site is stuck on an
  older version by a real, documented constraint (a runner requirement, a
  breaking change that has no migration yet). Record the constraint and, ideally,
  the condition under which the entry can be removed.
- **Documentation that quotes the outside world.** Prose reproducing a third
  party's example verbatim, where silently editing the version would
  misrepresent the source.

### When an entry is *not* legitimate

- To make a red build green so a PR can merge today. That converts a five-minute
  bump into a permanent exemption, and the exemption long outlives the deadline.
- Because bumping everywhere "touches too many files". Breadth is the intended
  cost of the policy, not an unintended side effect of it.
- For an action that appears in blueprint or compiler output. These are exactly
  the references the rule exists to protect, since they propagate downstream.
  An exemption here needs an explicit sign-off in review, not a quiet line in a
  text file.

### Adding an entry

Add the action to `.github/action-version-ignore.txt` **and explain yourself in
the PR** — reviewers should be able to judge the exemption without reverse
engineering it from the diff. Where the file's format supports comments, keep
the rationale next to the entry so it survives after the PR falls out of memory:

```
# Pinned to the pre-2.0 tag: the compiler regression fixture in
# examples/legacy/ asserts that blueprints emitted before the v2 rewrite
# still compile. Remove once that fixture is retired.
some-org/some-action
```

Check the existing entries in the file for the exact syntax it expects.

An ignore entry is a debt, not a decision. Revisit the list when you touch it:
if the constraint that justified an entry is gone, delete the entry in the same
PR that removes the constraint.
