#!/usr/bin/env bash
#
# pin-actions.sh - resolve GitHub Action tag references to commit SHAs.
#
# Rewrites lines of the form
#
#     uses: owner/repo@v4
#
# into
#
#     uses: owner/repo@<40-char-commit-sha> # v4
#
# The trailing "# <tag>" comment is intentional: it is the convention
# Dependabot and Renovate use to know which release a pinned SHA came from,
# so they can keep bumping it.
#
# Annotated tags are dereferenced twice, because
# `repos/:o/:r/git/ref/tags/:tag` returns the *tag object* rather than the
# commit when the tag is annotated. Doing that by hand is the error-prone
# part this script exists to remove.
#
# Usage:
#   bash .github/scripts/pin-actions.sh                 # dry run (default)
#   bash .github/scripts/pin-actions.sh --write         # apply changes
#   bash .github/scripts/pin-actions.sh --check         # exit 1 if unpinned
#   bash .github/scripts/pin-actions.sh --write FILE... # limit to files
#
# Requires: gh (authenticated).

set -euo pipefail

WORKFLOW_DIR=".github/workflows"

usage() {
  sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
}

WRITE=0
CHECK=0
FILES=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    -w|--write)
      WRITE=1
      shift
      ;;
    -n|--dry-run)
      WRITE=0
      shift
      ;;
    -c|--check)
      CHECK=1
      WRITE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [ "$#" -gt 0 ]; do
        FILES+=("$1")
        shift
      done
      ;;
    -*)
      printf 'pin-actions: unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "pin-actions: the GitHub CLI (gh) is required but was not found on PATH." >&2
  echo "             See https://cli.github.com/ for installation instructions." >&2
  exit 127
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "pin-actions: gh is installed but not authenticated. Run 'gh auth login'" >&2
  echo "             or export GH_TOKEN before running this script." >&2
  exit 127
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  if [ ! -d "$WORKFLOW_DIR" ]; then
    echo "pin-actions: no files given and $WORKFLOW_DIR does not exist." >&2
    exit 2
  fi
  while IFS= read -r discovered; do
    FILES+=("$discovered")
  done < <(find "$WORKFLOW_DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | LC_ALL=C sort)
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "pin-actions: no workflow files found under $WORKFLOW_DIR." >&2
  exit 0
fi

CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$CACHE_DIR"' EXIT

SHA_RE='^[0-9a-f]{40}$'

# resolve_sha <owner/repo> <ref> -> prints a 40-char commit SHA
#
# Lightweight tags point straight at a commit; annotated tags point at a tag
# object that must be followed one more hop. If the ref is not a tag at all we
# fall back to the commits endpoint, which resolves branches too.
resolve_sha() {
  local repo="$1"
  local ref="$2"
  local key cache_file response object_type sha

  key="$(printf '%s@%s' "$repo" "$ref" | tr '/@' '__')"
  cache_file="$CACHE_DIR/$key"

  if [ -f "$cache_file" ]; then
    cat "$cache_file"
    return 0
  fi

  sha=""
  if response="$(gh api "repos/$repo/git/ref/tags/$ref" \
      --jq '.object.type + " " + .object.sha' 2>/dev/null)"; then
    object_type="${response%% *}"
    sha="${response##* }"
    if [ "$object_type" = "tag" ]; then
      # Annotated tag: hop from the tag object to the commit it wraps.
      sha="$(gh api "repos/$repo/git/tags/$sha" --jq '.object.sha' 2>/dev/null || printf '')"
    fi
  else
    # Not a tag (branch, or a ref name gh could not match) - try commits.
    sha="$(gh api "repos/$repo/commits/$ref" --jq '.sha' 2>/dev/null || printf '')"
  fi

  if ! printf '%s' "$sha" | grep -Eq "$SHA_RE"; then
    return 1
  fi

  printf '%s' "$sha" >"$cache_file"
  printf '%s' "$sha"
}

total_changed=0
total_failed=0

for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "pin-actions: skipping $file (not a regular file)" >&2
    continue
  fi

  tmp="$(mktemp)"
  file_changed=0

  while IFS= read -r line || [ -n "$line" ]; do
    new_line="$line"

    # Only "<indent>[- ]uses: <spec>" lines. A commented-out '# uses:' line
    # cannot match, because the prefix admits whitespace and an optional
    # sequence-dash only.
    if [[ "$line" =~ ^([[:space:]]*(-[[:space:]]+)?)uses:[[:space:]]*(.*)$ ]]; then
      prefix="${BASH_REMATCH[1]}"
      rest="${BASH_REMATCH[3]}"

      # Strip any existing trailing comment; '#' never appears in an action ref.
      spec="${rest%%#*}"
      # Trim trailing whitespace left behind by the comment strip.
      spec="${spec%"${spec##*[![:space:]]}"}"

      quote=""
      case "$spec" in
        \"*\") quote='"'; spec="${spec%\"}"; spec="${spec#\"}" ;;
        \'*\') quote="'"; spec="${spec%\'}"; spec="${spec#\'}" ;;
      esac

      skip=0
      case "$spec" in
        ''|./*|../*|docker://*) skip=1 ;;
        *@*) : ;;
        *) skip=1 ;;   # no ref at all - nothing to pin
      esac

      if [ "$skip" -eq 0 ]; then
        ref="${spec##*@}"
        path="${spec%@*}"

        if printf '%s' "$ref" | grep -Eq "$SHA_RE"; then
          : # already pinned - leave the line exactly as it is
        else
          owner="${path%%/*}"
          remainder="${path#*/}"
          repo="${remainder%%/*}"

          if [ -z "$owner" ] || [ -z "$repo" ] || [ "$owner" = "$path" ]; then
            echo "pin-actions: $file: cannot parse owner/repo from '$spec', skipping" >&2
          elif sha="$(resolve_sha "$owner/$repo" "$ref")"; then
            new_line="${prefix}uses: ${quote}${path}@${sha}${quote} # ${ref}"
            if [ "$new_line" != "$line" ]; then
              file_changed=$((file_changed + 1))
              total_changed=$((total_changed + 1))
              printf '%s\n  - %s\n  + %s\n' "$file" "$line" "$new_line"
            fi
          else
            total_failed=$((total_failed + 1))
            echo "pin-actions: $file: could not resolve ${owner}/${repo}@${ref}" >&2
          fi
        fi
      fi
    fi

    printf '%s\n' "$new_line" >>"$tmp"
  done <"$file"

  if [ "$file_changed" -gt 0 ] && [ "$WRITE" -eq 1 ]; then
    mv "$tmp" "$file"
  else
    rm -f "$tmp"
  fi
done

if [ "$total_failed" -gt 0 ]; then
  printf 'pin-actions: %d reference(s) could not be resolved.\n' "$total_failed" >&2
  exit 1
fi

if [ "$total_changed" -eq 0 ]; then
  echo "pin-actions: all action references are already pinned to commit SHAs."
  exit 0
fi

if [ "$WRITE" -eq 1 ]; then
  printf 'pin-actions: pinned %d reference(s).\n' "$total_changed"
  exit 0
fi

printf 'pin-actions: %d reference(s) would be pinned (re-run with --write to apply).\n' "$total_changed"
if [ "$CHECK" -eq 1 ]; then
  exit 1
fi
exit 0
