# gitorio tools

Operator scripts for this repository. Nothing here ships to users.

| Where | What |
| --- | --- |
| [`backlog_lint.py`](backlog_lint.py) | Backlog lint — keeps [BACKLOG.md](../BACKLOG.md) machine-checkable |
| [`evolve_audit.py`](evolve_audit.py) | Headless discovery half of /evolve |
| [`next_backlog_id.py`](next_backlog_id.py) | Print the next free ``BL-YYYYMMDD-NN`` backlog id |
| [`pick_backlog_item.py`](pick_backlog_item.py) | Pick the top ``## Open`` BACKLOG item by the ``/evolve`` ordering |
| [`spec_validator.py`](spec_validator.py) | Spec drift validator for GitFactory specs/ (AO-SDLC, ADR-022) |
| [`unwrap-prose.py`](unwrap-prose.py) | unwrap-prose.py — join soft-wrapped prose lines so each paragraph is one line |
