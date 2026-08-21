# Action pinning policy

> **Status: draft.** Several repo-specific details below are marked
> `TODO(maintainer)` because they could not be confirmed against the validator
> source at the time of writing. Please correct them before relying on this page.

Every GitHub Actions reference this project ships — in `.factory/blueprint.json`,
in the workflows the compiler emits, and in the workflows under
`.github/workflows/` — must be pinned to an immutable commit SHA. The generator
enforces this and **fails the build** rather than emitting an unpinned workflow.

If you landed here from a red build, jump to
[When the generator rejects a ref](#when-the-generator-rejects-a-ref).

---

## Why

A tag or branch is a *mutable pointer*. `actions/checkout@v4` means "whatever
commit the `v4` tag points at right now", and that pointer is controlled by
whoever owns the action's repository, not by us. If that account is compromised,
or a maintainer force-moves a release tag, every workflow that references the tag
silently starts executing different code — with whatever secrets and token scopes
the job was granted.

A 40-character commit SHA is immutable. Pinning to one means the code that runs
tomorrow is the code you reviewed today, and any change to it shows up as a diff
in a pull request.

This matters more here than in an average repo: the workflows this project
generates run Claude Code agents with write access to real repositories. An
unreviewed action in that pipeline is an unreviewed agent in that pipeline.

## The rule

**Every `uses:` reference resolves to a full 40-character commit SHA, and carries
the human-readable version alongside it so reviewers can tell what they're
looking at.**

| Reference | Verdict |
| --- | --- |
| `actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955` | ✅ pinned |
| `actions/checkout@v4` | ❌ mutable tag |
| `actions/checkout@main` | ❌ mutable branch |
| `actions/checkout@08eba0b` | ❌ abbreviated SHA — ambiguous, and not an immutable guarantee |
| `actions/checkout` | ❌ no ref at all |
| `actions/checkout@` / `@v4` | ❌ unparseable |

> `TODO(maintainer)`: confirm whether first-party `actions/*` and
> `github/*` references are held to the same standard as third-party actions, and
> whether job-level reusable workflows (`uses: owner/repo/.github/workflows/x.yml@ref`)
> are covered by the same gate. This page currently assumes "yes" to both.

### Recording the version

In YAML, the convention is a trailing comment:

```yaml
- uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955 # v4.3.0
```

JSON has no comments, so `.factory/blueprint.json` cannot use that form.

> `TODO(maintainer)`: document how the blueprint schema carries the
> human-readable version — a sibling field on the step object, a suffix
> convention, or "the compiler re-derives it when emitting YAML". Show the real
> object shape from `schema/` here.

## Before and after

The change is confined to the value of the `uses` reference:

```diff
- "uses": "actions/checkout@v4"
+ "uses": "actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955"
```

…and, in the emitted workflow, the version survives as a comment so that a
reviewer reading `.github/workflows/*.yml` still knows which release this is:

```diff
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955 # v4.3.0
```

The SHA above is an example of the *shape* of a valid pin. Always resolve the
version you actually want using the commands below rather than copying a SHA out
of documentation.

## Resolve a tag to a commit SHA

Either of these works; both print a full 40-character SHA.

**With the GitHub CLI** (resolves any ref — tag, branch, or release — to the
commit it points at, including annotated tags):

```bash
gh api repos/actions/checkout/commits/v4.3.0 --jq .sha
```

**With plain Git** (no auth, no CLI install). The `^{}` suffix peels an annotated
tag down to the commit it wraps, which is what you want — without it you may get
the tag object's SHA instead of the commit's:

```bash
git ls-remote https://github.com/actions/checkout 'refs/tags/v4.3.0^{}'
```

If that prints nothing, the tag is lightweight; drop the `^{}`:

```bash
git ls-remote https://github.com/actions/checkout refs/tags/v4.3.0
```

Before you paste the result in, open
`https://github.com/<owner>/<repo>/commit/<sha>` and confirm the commit is on the
release you expected and belongs to the repository you think it does.

## Update an existing pin

1. Find the release you want to move to (the action's releases page or
   `gh release list --repo actions/checkout`).
2. Resolve it to a commit SHA with one of the commands above.
3. Edit the reference in `.factory/blueprint.json` (or in the workflow file, if
   it is hand-maintained rather than generated), updating both the SHA and the
   recorded version.
4. Re-run the compile step so the generated workflows under `.github/workflows/`
   match the blueprint. In a Claude Code session the repo provides
   `/compile-check` for this (see `.claude/commands/`, referenced in the
   [README](../README.md)).
5. Review the diff. A pin bump should change the SHA, the version comment, and
   nothing else. If the generated YAML changes in other ways, that's the new
   action version's doing and deserves a closer read.
6. Commit the blueprint change and the regenerated workflows together, and say in
   the commit message which version you moved from and to.

### Keeping pins current automatically

Dependabot understands SHA-pinned actions: it bumps the SHA and rewrites the
trailing version comment for you, which removes most of the excuse for pinning to
a tag "so it stays up to date". If this repo does not yet have a
`.github/dependabot.yml` with a `github-actions` ecosystem entry, adding one is a
reasonable follow-up.

## When the generator rejects a ref

The validator classifies a bad reference and fails the run. The categories:

| Failure | What it means | Fix |
| --- | --- | --- |
| `UNPINNED` | The ref is a tag or branch — mutable. | Resolve it to a commit SHA (above) and replace it. |
| `UNRESOLVED` | A pin is expected but missing, empty, or still a placeholder. | Fill in the real SHA. Do not commit a placeholder to unblock yourself; the gate exists to catch exactly that. |
| `MALFORMED` | The ref cannot be parsed as `owner/repo@<sha>` — abbreviated SHA, missing `@`, stray whitespace, non-hex characters. | Re-copy the reference. A full SHA is exactly 40 lowercase hex characters. |

> `TODO(maintainer)`: confirm these three identifiers match the strings the
> validator actually emits, and link the validator's source file (somewhere under
> `tools/`) here so a contributor can read the check itself.

## Is there a bypass?

No opt-out flag or environment variable is documented here, because none could be
confirmed in the validator at the time of writing. Treat the gate as absolute:
the fix for a rejected ref is to resolve the pin, not to route around the check.

> `TODO(maintainer)`: if a bypass exists, name it here (flag *and* env var),
> state the narrow case it's meant for — e.g. local iteration against an
> unreleased action — and say explicitly that it must never be set in CI or on
> `main`. If no bypass exists, delete this section and say so in one line.

## Checklist before you open a PR

- [ ] Every `uses:` you touched is a full 40-character SHA.
- [ ] Each SHA has its human-readable version recorded alongside it.
- [ ] You opened the commit on GitHub and confirmed it belongs to the release and
      the repository you intended.
- [ ] The generated workflows were regenerated and committed with the blueprint.
- [ ] No bypass flag or env var is set anywhere in the diff.
