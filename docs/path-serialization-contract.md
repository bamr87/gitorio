# Project-root contract for path serialization

**Status:** Proposed — not yet ratified. Sections marked `UNVERIFIED` describe an
intended rule that has not been checked against the current implementation.

**Audience:** anyone writing or reviewing code that puts a filesystem path into a
string that outlives the process.

**Why this document exists:** "rewrite absolute paths as relative ones" is not a
reviewable instruction until three things are settled — what the paths are
relative *to*, what happens to paths that live outside that anchor, and whether
the rule applies to error messages. Until those are answered, every normalization
patch is a judgement call and no two reviewers make the same one. This document
is the prerequisite for reviewing such a patch.

---

## 1. The problem, concretely

The same logical file has more than one absolute path in this project's normal
workflows:

- **Host vs. container.** `docker-compose.yml` mounts the working tree into the
  `dev` container. `README.md` documents both `npm test` and
  `docker compose run --rm dev npm test` as supported ways to run the suite. The
  absolute prefix differs between them; the file does not.
- **Developer vs. CI runner.** Blueprints compile to GitHub Actions workflows
  that execute on ephemeral runners whose checkout path is not the author's.
- **Author vs. recipient.** The README describes blueprints as "versioned,
  reviewable, and shareable as an encoded blueprint string." A string that
  embeds `/Users/someone/dev/gitorio` is not shareable; it is a leak and a
  broken reference in one.

So an absolute path in a persisted artifact is a bug with three distinct
symptoms: spurious diffs, failed reproduction, and incidental disclosure of a
developer's directory layout.

---

## 2. Rule 1 — what declares the project root

> The project root is **the directory containing the nearest `fleet.manifest.yml`,
> searched upward from the file being processed** — not from the process's
> working directory.
>
> This may be overridden by an **explicit** `--project-root <path>` argument (or
> its programmatic equivalent). It is **never** derived from the invocation CWD.

### Why not CWD

CWD is the failure mode being fixed, not a fallback for it. `npm test` run from
`app/` and the same suite run from the repo root would produce different
serialized output for identical inputs. Any rule that consults CWD makes the
output a function of how the command was typed, which is precisely the
non-determinism this contract exists to eliminate.

### Why the manifest and not the git root

A git root is invisible in a tarball, an npm package, or a Docker `COPY` of a
subtree. A manifest travels with the code it describes. Anchoring to a file the
project actually owns keeps resolution working in contexts where `.git` is
absent.

### Why an explicit flag is still allowed

Upward search is a heuristic; heuristics need an override for the cases they get
wrong (vendored copies, test fixtures that contain their own manifests, tools
invoked against a directory they are not inside). The override is safe *because
it is explicit* — it is a value someone typed or configured, recorded in the
command, and reproducible by the next person who runs it. CWD has none of those
properties.

### Resolution order

1. Explicit `--project-root` / configured value, if present.
2. Nearest ancestor directory of the input file containing `fleet.manifest.yml`.
3. **Error.** Do not guess, and do not fall back to CWD. A tool that cannot
   locate a root should say so and exit rather than emit output whose meaning
   depends on where it was launched.

> `UNVERIFIED` — this document assumes `fleet.manifest.yml` is a suitable root
> marker because it sits at the repository root, but it has not been confirmed
> that it is mandatory, unique, or absent from subdirectories. If a different
> file is the real anchor (for example something under `.factory/` or
> `schema/`), substitute it here; the resolution *order* is the part that
> matters. The flag name `--project-root` is likewise a suggestion and should be
> reconciled with whatever CLI surface `tools/` already exposes.

---

## 3. Rule 2 — the serialized form

A path that satisfies this contract is:

- **Relative to the project root**, with no leading `./`.
- **POSIX-separated** (`/`), on every platform, including Windows.
- **Free of `.` and `..` segments**, normalized before writing.
- **Not symlink-resolved.** Serialize the path as addressed, not as
  `realpath()` returns it; resolving symlinks makes output depend on how the
  checkout was created.
- **Case-preserving.** Do not lowercase paths to paper over case-insensitive
  filesystems; that hides real bugs on case-sensitive CI.

```
good   app/src/compiler/emit.ts
bad    ./app/src/compiler/emit.ts        leading ./
bad    app\src\compiler\emit.ts          native separators
bad    /Users/ada/gitorio/app/src/...    absolute
bad    ../gitorio/app/src/...            escapes the root (see §4)
```

---

## 4. Rule 3 — paths outside the project root

A relative path to something outside the root is **not** a fix. `../../../.npm/_cacache/...`
is every bit as machine-specific as the absolute path it replaced; it has merely
become harder to recognise as such, because it now *looks* portable. It also
silently changes meaning if the project is checked out at a different depth.

> Paths outside the project root **must not** be serialized as relative paths.
> They are serialized as a **named root plus a relative remainder**, or they are
> an error.

### Named roots

| Token       | Meaning                                              |
|-------------|------------------------------------------------------|
| `{project}` | The project root as resolved in §2. Usually implicit. |
| `{home}`    | The invoking user's home directory.                  |
| `{cache}`   | The package-manager / tool cache root.               |
| `{tmp}`     | The system temporary directory.                      |

```
{cache}/_cacache/content-v2/sha512/ab/cd/...
{home}/.config/gitorio/credentials
```

The token names the *role* the directory plays, which is stable across machines,
rather than its location, which is not. A consumer re-expands the token using its
own environment. Two machines then agree on what the path means even though they
disagree on where it is — which is the actual goal, and something a relative walk
cannot achieve.

### When to error instead

For artifacts that are committed or shared — blueprints above all — an out-of-root
path is usually a design bug rather than a serialization problem: a blueprint
that references a developer's cache will not compile anywhere else. Prefer
failing loudly at serialization time over emitting a token that will dangle on
the next machine.

> `UNVERIFIED` — the `{...}` token syntax is proposed here, not observed. If
> `schema/` already defines a placeholder convention, adopt that spelling
> instead. What must survive review is the principle: **out-of-root paths are
> represented symbolically or not at all.**

---

## 5. Rule 4 — scope: what is bound, and what is exempt

The boundary is **not** "stdout versus files". It is:

> **Is this string going to be compared, hashed, committed, cached, or read on a
> different machine?**
>
> If yes, it is a *machine-readable artifact* and this contract binds it.
> If it exists only to be read by a human, right now, on the machine that
> produced it, this contract exempts it.

### Bound — must be root-relative

- Compiled GitHub Actions workflow YAML.
- Encoded blueprint strings and anything else round-tripped through the repo.
- Test snapshots and golden files.
- Cache keys, lockfile-adjacent metadata, content hashes.
- Structured machine output (JSON/NDJSON intended for another program).
- Anything written under version control.

### Exempt — may be absolute, and usually should be

- Error messages, warnings, and stack traces.
- Interactive CLI progress output and logs meant for a human tail.
- Debugger and editor integrations.

### Why diagnostics are deliberately exempt

This is a real trade-off, not an oversight. A root-relative path in an error
message is *worse* for its actual purpose: terminals and editors linkify absolute
paths, a relative path is ambiguous the moment the reader's shell is somewhere
unexpected, and the container/host split described in §1 means a relative path
may not even resolve in the reader's context. Determinism buys nothing here —
nobody diffs an error message — and it costs the one thing the message is for,
which is getting a human to the file.

The rule is therefore scoped by consequence, not by convenience. A path is
normalized where variation causes harm, and left absolute where variation is
invisible and absoluteness is useful.

### The one exception to the exemption

If a diagnostic is *asserted on* — a test that matches error text, a snapshot of
CLI output — it has become a machine-readable artifact and is bound. Fix this at
the assertion (match on a relative fragment, or scrub the prefix), not by
degrading the message for every human who will ever read it.

---

## 6. Conformance checklist for reviewers

When reviewing a change that touches path handling:

- [ ] Does the root come from the manifest or an explicit flag, and **never**
      from `process.cwd()`? (§2)
- [ ] Does the code error out when no root is found, rather than falling back?
      (§2)
- [ ] Are separators normalized to `/` at the serialization boundary, not left
      to the platform? (§3)
- [ ] Are `.`/`..` segments normalized away, and is the result free of leading
      `./`? (§3)
- [ ] Is any out-of-root path represented as a named root or rejected — never as
      a `../` walk? (§4)
- [ ] For each changed output: was it classified as bound or exempt, and does
      the treatment match? (§5)
- [ ] Were error messages left absolute, and if any were changed, was it because
      a test asserts on them? (§5)
- [ ] Is there a test that would fail if the tool were run from a different
      working directory?

That last item is the highest-value one. A normalization change with no such test
has not demonstrated that it fixed anything.

---

## 7. Open questions

These are unresolved and should be settled before or alongside the first
normalization PR:

1. **Nested manifests.** Can a `fleet.manifest.yml` appear below the repository
   root — in `examples/`, `seeds/`, or a test fixture? If so, upward search from
   a fixture file finds the *fixture's* root, which may or may not be intended.
2. **Which artifacts already contain absolute paths.** This document defines the
   rule; it does not audit compliance. A survey of current outputs is needed to
   size the work.
3. **Enforcement.** A hand-checked rule decays. A lint rule, or a test that runs
   a serializer from two different CWDs and asserts byte-identical output, would
   make the contract self-enforcing.
4. **Symlink policy under Docker.** §3 says do not resolve symlinks. This should
   be confirmed against how the bind mount in `docker-compose.yml` presents the
   working tree inside the container.
5. **Whether `.gitattributes` already covers a related normalization.** Line-ending
   normalization is a sibling determinism concern; the two policies should at
   least be aware of each other.
