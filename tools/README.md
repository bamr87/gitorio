# gitorio tools

> The stdlib Python gates and helpers behind the AO-SDLC loop and the docs checks — none of them ship to users.

Operator scripts for this repository, run from the repo root. `docs_index.py` and `unwrap-prose.py` are vendored from the bamr87 hub; change them there first, never here.

| Where | What |
| --- | --- |
| [`backlog_lint.py`](backlog_lint.py) | Backlog lint — keeps [BACKLOG.md](../BACKLOG.md) machine-checkable |
| [`docs_index.py`](docs_index.py) | Generate the `docs/README.md` index from each document's summary line (`--write`, `--check`, `--lint`) |
| [`evolve_audit.py`](evolve_audit.py) | Headless discovery half of /evolve |
| [`next_backlog_id.py`](next_backlog_id.py) | Print the next free ``BL-YYYYMMDD-NN`` backlog id |
| [`pick_backlog_item.py`](pick_backlog_item.py) | Pick the top ``## Open`` BACKLOG item by the ``/evolve`` ordering |
| [`spec_validator.py`](spec_validator.py) | Spec drift validator for GitFactory specs/ (AO-SDLC, ADR-022) |
| [`unwrap-prose.py`](unwrap-prose.py) | unwrap-prose.py — join soft-wrapped prose lines so each paragraph is one line |
