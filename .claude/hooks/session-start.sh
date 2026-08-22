#!/usr/bin/env bash
# SessionStart hook — orient any Claude Code session to GitFactory's
# spec-driven AO-SDLC workflow (ADR-022). Injects a short operational reminder
# as additionalContext and reports tool availability. Never fails the session.
set +e

command -v python3 >/dev/null 2>&1 || { printf '{}'; exit 0; }

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
have() { command -v "$1" >/dev/null 2>&1 && echo yes || echo no; }

read -r -d '' CTX <<EOF
GitFactory operational reminder (branch: ${branch}).
- AO-SDLC chain (as slash commands): /specify -> /clarify -> /plan -> /tasks -> /implement ; /evolve for autonomous runs. Work enters via BACKLOG.md (BL-YYYYMMDD-NN ids; picker: python3 tools/pick_backlog_item.py).
- Golden rule #11 loop: every /implement cycle ends with tasks.md '## Follow-ups Discovered' + mirror each into BACKLOG.md (append-only; move to ## Done, never delete) + copy the new bullets into the PR body.
- Gates before any PR: 'cd app && npm test && npm run build', 'python3 tools/spec_validator.py', 'python3 tools/backlog_lint.py', 'python3 tools/unwrap-prose.py --check' (markdown is one-paragraph-per-line).
- Never hand-edit generated factory--*.yml (golden rule #2). End sessions with /session-log (golden rule #10).
- Tool check: node=$(have node) npm=$(have npm) python3=$(have python3) gh=$(have gh).
EOF

python3 - "$CTX" <<'PY' 2>/dev/null || printf '{}'
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.argv[1]}}))
PY
