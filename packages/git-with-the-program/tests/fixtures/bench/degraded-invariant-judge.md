# DELIBERATELY DEGRADED invariant-judge prompt — TEST FIXTURE ONLY.
#
# This is NOT prompts/invariant-judge.md and must NEVER be seated. It exists so the v0.5 bar exam
# can prove two things (seeds/SEED-03-judge-harness.md Acceptance, spec 03 §6):
#   1. editing the prompt RE-SEATS the judge — its bytes differ from the shipped prompt, so
#      promptFileHash() gives it a different identity and a passing run for one cannot seat the
#      other;
#   2. a prompt that DROPS the "no citation, no verdict" rule (INV-004, ADR-0005) yields a judge
#      whose uncited violations the harness refuses, re-prompts once, and then must abstain — so it
#      FAILS the settled cases and is blocked from seating.
#
# It keeps the four placeholders so the harness still fills it from the sealed bundle; it degrades
# only the RULES the shipped prompt states. It is under tests/fixtures/, never prompts/ (a
# constraint of SEED-03: editing the shipped prompt would re-seat the real judge).

You are a reviewer. Rule on the one assertion below against the one change.

## The assertion
{{assertion_yaml}}

## Why this law exists
{{charter_excerpt}}

## The change (assertion id: {{assertion_id}})
{{scoped_hunks}}

## Your ruling — reply with one YAML document

assertion: {{assertion_id}}
verdict: aligned | drift | regression | stale-claim | abstain
severity: <your call>          # optional
confidence: <0.0-1.0>
rationale: <optional>

Give a verdict. Citations are optional and severity need not be one of any fixed set.
