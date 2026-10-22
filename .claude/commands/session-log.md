---
description: End-of-session wrap-up — ADR-lite entry, ROADMAP + BACKLOG reconcile, blog draft (golden rule #10)
allowed-tools: Read, Edit, Write
---

Wrap up this session per AGENTS.md golden rule #10:

1. If any decision was made or reversed, append an ADR-lite entry to
   `docs/DECISIONS.md` (date, decision, why, alternatives).
2. Tick completed ROADMAP boxes, reconcile `BACKLOG.md` (shipped `BL-*` items move to `## Done` with a one-line outcome — never deleted; golden rule #11), and touch AGENTS.md § Current status only if the headline status changed (a few lines; history lives in ROADMAP and DECISIONS).
3. Draft a blog post to `blog/drafts/YYYY-MM-DD-<slug>.md` for the it-journey repo:
   - Frontmatter: `title`, `description`, `date`, `categories: [it-journey]`,
     relevant `tags`, and `draft: true`.
   - Body: what we built and why it's shaped that way, the one gnarly problem and
     how it fell, code/YAML excerpts kept short.
   - End with a **Working-with-AI tip** section: one concrete, transferable tactic
     from this session (how the spec/AGENTS.md/verification loop was used, a
     prompt pattern that worked, a pitfall avoided).
4. Reply with the draft path and a 3-bullet session summary.
