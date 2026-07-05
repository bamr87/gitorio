// Pure prompt linter — the safety net for operating instructions that ship to real agents.
// No I/O. Every rule is independently testable (lint.test.ts covers each firing + not firing).

export interface LintFinding {
  level: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
}

// Key-shaped secrets that must NEVER live in a committed prompt.
const SECRET_RE =
  /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/;
const INJECTION_RE = /ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions/i;
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---/;

export function lintPrompt(text: string): LintFinding[] {
  const findings: LintFinding[] = [];

  if (SECRET_RE.test(text)) {
    findings.push({ level: 'error', rule: 'no-secrets', message: 'A key-like secret is present — never commit tokens in a prompt. Remove it and use a repo secret.' });
  }
  if (!FRONTMATTER_RE.test(text)) {
    findings.push({ level: 'warning', rule: 'frontmatter', message: 'No frontmatter block — add a `---` header (title/description) so the prompt is self-describing.' });
  }
  if (!/obligations/i.test(text)) {
    findings.push({ level: 'warning', rule: 'obligations', message: 'The prompt never mentions obligations — state the obligations contract so the agent knows exactly what to do.' });
  }
  if (INJECTION_RE.test(text)) {
    findings.push({ level: 'warning', rule: 'injection-bait', message: 'Contains "ignore previous instructions"-style text — a classic injection lure. Rephrase.' });
  }
  if (!/untrusted|attacker|do not follow instructions/i.test(text)) {
    findings.push({ level: 'info', rule: 'untrusted-note', message: 'Consider a note that issue/PR/comment text is untrusted input the agent must not obey as instructions.' });
  }

  return findings;
}

/** True when nothing blocks a save (no error-level findings). */
export function lintPasses(findings: LintFinding[]): boolean {
  return !findings.some((f) => f.level === 'error');
}
