#!/usr/bin/env python3
"""Headless discovery half of /evolve.

Audits the repo for follow-up candidates and appends them to BACKLOG.md
under ``## Open``. Safe to run unattended (the kill-switched weekly
``.github/workflows/evolve.yml``, or locally).

Signals collected:
- TODO / FIXME / XXX / HACK comments in app/tool sources not already
  covered by an existing BL-* id.
- Missing ``docs/*.md`` files referenced from AGENTS.md or CONTRIBUTING.md.

Each new candidate becomes a ``BL-YYYYMMDD-NN`` bullet in the format expected
by ``tools/backlog_lint.py``. The script never deletes existing entries and
exits 0 even when it adds nothing (idempotent). Ported from law-ai's
``scripts/evolve_audit.py`` minus its domain scanners (coverage, LegalBench).
"""

from __future__ import annotations

import datetime as dt
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKLOG = REPO / "BACKLOG.md"
# Case-SENSITIVE deliberately (a gitorio deviation from the law-ai original):
# the comment convention is uppercase, while lowercase 'todo' is a live data
# value in the content model ('todo' | 'in-progress' | 'done') and in UI copy —
# IGNORECASE produced ~20 false positives on first run.
TODO_RE = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b[:\s-]*(.{0,100})")
EXISTING_BL_RE = re.compile(r"\bBL-\d{8}-\d{2}\b")
# tools/ is excluded on purpose: the gate scripts mention the marker words in
# their own docstrings/regexes and would flag themselves forever.
SCAN_GLOBS = (
    "app/src/**/*.ts",
    "app/src/**/*.tsx",
    "app/scripts/**/*.ts",
)
SKIP_DIRS = {"node_modules", "dist", "__pycache__", ".git", "coverage", "fixtures"}
# Docs references are parsed out of these files so the list self-maintains.
# AGENTS.md is the canonical agent file; CLAUDE.md is only an `@AGENTS.md` import pointer.
DOC_REFERRERS = ("AGENTS.md", "CONTRIBUTING.md")


@dataclass(frozen=True)
class Candidate:
    kind: str  # feature | refactor | tech-debt | test-gap | doc-gap | infra
    severity: str  # low | med | high
    title: str
    rationale: str
    surfaced: str  # provenance tail, per the house bullet format

    def render(self, bl_id: str) -> str:
        return (
            f"- **{bl_id}** — *{self.kind}, {self.severity}* — {self.title}. "
            f"{self.rationale} _Surfaced in:_ {self.surfaced}."
        )


def _iter_files() -> Iterable[Path]:
    for pattern in SCAN_GLOBS:
        for path in REPO.glob(pattern):
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if path.is_file():
                yield path


def _scan_todos() -> list[Candidate]:
    seen: set[str] = set()
    out: list[Candidate] = []
    for path in _iter_files():
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for match in TODO_RE.finditer(text):
            tag, msg = match.group(1).upper(), match.group(2).strip()
            key = f"{path.relative_to(REPO)}:{msg[:60]}"
            if key in seen or not msg:
                continue
            seen.add(key)
            sev = "high" if tag in {"FIXME", "XXX"} else "med"
            kind = "tech-debt" if tag == "HACK" else "test-gap" if "test" in msg.lower() else "refactor"
            out.append(
                Candidate(
                    kind=kind,
                    severity=sev,
                    title=f"Resolve {tag} in {path.relative_to(REPO)}",
                    rationale=f'Comment: "{msg}"',
                    surfaced="weekly evolve audit (TODO scan)",
                )
            )
    return out


def _scan_missing_docs() -> list[Candidate]:
    """Flag ``docs/*.md`` files referenced from DOC_REFERRERS that do not exist.

    The existence check is **case-insensitive** so a case-mismatched path is
    never mis-flagged as missing on case-sensitive filesystems.
    """
    referenced: set[str] = set()
    for name in DOC_REFERRERS:
        f = REPO / name
        if f.exists():
            referenced.update(re.findall(r"docs/[A-Za-z0-9_-]+\.md", f.read_text(encoding="utf-8")))
    docs_dir = REPO / "docs"
    existing_lower = {p.name.lower() for p in docs_dir.glob("*.md")} if docs_dir.is_dir() else set()
    return [
        Candidate(
            kind="doc-gap",
            severity="low",
            title=f"Author missing doc {doc}",
            rationale=f"Referenced by {'/'.join(DOC_REFERRERS)} but file does not exist.",
            surfaced="weekly evolve audit (missing-docs scan)",
        )
        for doc in sorted(referenced)
        if doc.split("/", 1)[1].lower() not in existing_lower
    ]


def _existing_titles() -> set[str]:
    if not BACKLOG.exists():
        return set()
    titles: set[str] = set()
    for line in BACKLOG.read_text(encoding="utf-8").splitlines():
        if line.startswith("- **BL-"):
            # Title is between the second em-dash and the first sentence end.
            # Split on '. ' (period + space), NOT a bare '.': every generated
            # title embeds a file path whose extension dot would otherwise
            # truncate the key and break dedup forever (a bug inherited from
            # the law-ai original, where re-appends piled up on every run).
            parts = line.split(" — ", 2)
            if len(parts) == 3:
                titles.add(parts[2].split(". ", 1)[0].strip().lower())
    return titles


def _next_id_seed() -> tuple[str, int]:
    today = dt.datetime.now(dt.UTC).strftime("%Y%m%d")
    if not BACKLOG.exists():
        return today, 1
    existing = EXISTING_BL_RE.findall(BACKLOG.read_text(encoding="utf-8"))
    todays = [int(bl.split("-")[2]) for bl in existing if bl.startswith(f"BL-{today}-")]
    return today, (max(todays) + 1) if todays else 1


def _insert_under_open(new_bullets: list[str]) -> None:
    text = BACKLOG.read_text(encoding="utf-8")
    # Anchor on the heading LINE, not a bare substring — a prose mention of
    # "## Open" earlier in the file must not become the insertion point.
    m = re.search(r"^## Open[ \t]*$", text, re.MULTILINE)
    if m is None:
        raise SystemExit("BACKLOG.md missing '## Open' section")
    eol = text.find("\n", m.end())
    # Heading at EOF without a trailing newline: normalize so the bullets
    # still land on their own lines instead of crashing.
    insert_at = len(text) if eol == -1 else eol + 1
    prefix = text[:insert_at] if eol != -1 else text[:insert_at] + "\n"
    insertion = "\n" + "\n".join(new_bullets) + "\n"
    BACKLOG.write_text(prefix + insertion + text[insert_at:], encoding="utf-8")


def main() -> int:
    candidates = _scan_todos() + _scan_missing_docs()
    if not candidates:
        print("evolve_audit: no new candidates")
        return 0

    seen_titles = _existing_titles()
    fresh = [c for c in candidates if c.title.lower() not in seen_titles]
    if not fresh:
        print("evolve_audit: all candidates already in BACKLOG")
        return 0

    today, seed = _next_id_seed()
    bullets = [c.render(f"BL-{today}-{seed + i:02d}") for i, c in enumerate(fresh)]
    _insert_under_open(bullets)
    print(f"evolve_audit: appended {len(bullets)} item(s) to BACKLOG.md")
    for line in bullets:
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
