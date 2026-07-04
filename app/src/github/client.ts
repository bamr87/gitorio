// GitHub I/O — lands in seed 03 (docs/ARCHITECTURE.md §2–3).
//
// Planned surface (keep this contract when implementing):
//   connectWithPat(token) → session (sessionStorage only; never localStorage)
//   preflight(repo)       → permission checklist {contents, issues, prs, actions, workflows, secrets}
//   loadFactory(repo)     → { blueprint, prompts } from .factory/*
//   deploy(repo, plan)    → single commit or PR: blueprint + factory--*.yml + prompts (+ deletions)
//   connectPower(repo, apiKey) → sealed-box PUT of ANTHROPIC_API_KEY (tweetnacl), plaintext never stored
//   listRuns(repo)        → factory--* workflow runs w/ ETag conditional requests (seed 04)

export function notYet(): never {
  throw new Error('GitHub I/O lands in seed 03 — see seeds/03-github-connect.md');
}
