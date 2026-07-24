// Implements tests for: seeds/SEED-01-scaffold.md deliverable 2 (the `gwtp` command surface).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, VERSION } from '../../src/cli/index.js';

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gwtp CLI skeleton', () => {
  it('prints usage listing every registered subcommand', async () => {
    const code = await main(['--help']);
    expect(code).toBe(0);
    for (const name of ['validate', 'ledger', 'judge', 'program']) {
      expect(stdout).toContain(name);
    }
  });

  it('prints a version', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(stdout.trim()).toBe(`gwtp ${VERSION}`);
  });

  it('exits nonzero with usage when no command is given', async () => {
    expect(await main([])).toBe(2);
    expect(stdout).toContain('Usage:');
  });

  it('exits nonzero on an unknown command', async () => {
    expect(await main(['distill'])).toBe(2);
    expect(stderr).toContain('unknown command');
  });

  it('exits nonzero on an unknown global flag', async () => {
    expect(await main(['--wat'])).toBe(2);
  });

  it.each([['program', 'SEED-01']])(
    '`%s` is a registered stub that fails loudly and names its seed',
    async (cmd, seed) => {
      const code = await main([cmd]);
      expect(code).not.toBe(0);
      expect(stderr).toContain('not implemented');
      expect(stderr).toContain(seed);
    },
  );

  // `judge` stopped being a stub with SEED-03: it runs the judgment ladder against a diff and
  // bar-exams the case law. Its behaviour lives in tests/judge/** and tests/evidence/**; here, as
  // with `validate` and `ledger`, only the wiring — that it is implemented and owns its flags.
  it('`judge` is implemented and parses its own flags', async () => {
    expect(await main(['judge', '--help'])).toBe(0);
    expect(stdout).toContain('gwtp judge');
    expect(stderr).not.toContain('not implemented');
  });

  // `validate` is no longer a stub; it is SEED-01 deliverable 2. Its behaviour lives in
  // tests/cli/validate.test.ts — here we only assert it is wired into the command table and
  // owns its own flag grammar.
  it('`validate` is implemented and parses its own flags', async () => {
    expect(await main(['validate', '--help'])).toBe(0);
    expect(stdout).toContain('gwtp validate');
    expect(stderr).not.toContain('not implemented');
  });

  // `ledger` stopped being a stub with SEED-02 deliverable 4. Its behaviour lives in
  // tests/cli/ledger.test.ts; here, as with `validate`, only the wiring.
  it('`ledger` is implemented and lists its own subcommands', async () => {
    expect(await main(['ledger', '--help'])).toBe(0);
    for (const sub of ['append', 'fold', 'replay', 'status']) {
      expect(stdout).toContain(sub);
    }
    expect(stderr).not.toContain('not implemented');
  });

  it('hands subcommand flags to the subcommand rather than choking on them', async () => {
    // Global parseArgs must not see `--from`; the split happens at the first positional. The
    // proof is WHOSE error message comes back: `gwtp ledger`'s, not the top-level parser's.
    const code = await main(['ledger', '--from', 'abc123']);
    expect(code).toBe(2);
    expect(stderr).toContain('gwtp ledger:');
    expect(stderr).not.toContain('unknown command');
  });

  it('lets a subcommand own its own flag grammar, two levels down', async () => {
    const code = await main(['ledger', 'fold', '--nonesuch']);
    expect(code).toBe(2);
    expect(stderr).toContain('gwtp ledger fold:');
  });

  it('describes a command with --help before the command name', async () => {
    expect(await main(['--help', 'ledger'])).toBe(0);
    expect(stdout).toContain('gwtp ledger');
  });

  it('states the two write policies in the usage text', async () => {
    await main(['--help']);
    expect(stdout).toContain('INV-001');
    expect(stdout).toContain('INV-002');
  });
});
