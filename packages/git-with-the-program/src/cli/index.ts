#!/usr/bin/env node
// Implements: seeds/SEED-01-scaffold.md deliverable 2 (the `gwtp` command surface) and
// CLAUDE.md's stated CLI contract: `gwtp validate` (SEED-01) and
// `gwtp ledger append|fold|replay|status` (SEED-02).
//
// Argument parsing is node:util parseArgs — no commander, no yargs (ADR-0006 keeps the
// dependency list small). Global flags are parsed from the tokens BEFORE the subcommand; the
// remainder is handed to the subcommand untouched, so a subcommand owns its own flag grammar.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const VERSION = '0.1.0';

interface CommandSpec {
  readonly summary: string;
  /** The seed that lands the real implementation. */
  readonly seed: string;
  readonly load: () => Promise<{ run: (argv: readonly string[]) => Promise<number> }>;
}

const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  validate: {
    summary: 'Validate .program/*.yaml and ledger event files against schemas/ (INV-006)',
    seed: 'SEED-01',
    load: () => import('./commands/validate.js'),
  },
  ledger: {
    summary: 'append | fold | replay | status over refs/program/ledger',
    seed: 'SEED-02',
    load: () => import('./commands/ledger.js'),
  },
  judge: {
    summary: 'Run the judgment ladder against a change; bar-exam a candidate judge',
    seed: 'SEED-03',
    load: () => import('./commands/judge.js'),
  },
  program: {
    summary: 'Inspect the normative store: assertions, precedents, scope, manifest',
    seed: 'SEED-01',
    load: () => import('./commands/program.js'),
  },
};

const GLOBAL_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((n) => n.length));
  const lines = Object.entries(COMMANDS).map(
    ([name, spec]) => `  ${name.padEnd(width)}  ${spec.summary}`,
  );
  return [
    'gwtp — Git with the Program',
    '',
    'An agentic governance framework that keeps a repository\'s evolution in accordance',
    'with its program, and knows when the program itself should change.',
    '',
    'Usage:',
    '  gwtp [--help] [--version] <command> [args...]',
    '',
    'Commands:',
    ...lines,
    '',
    'Run `gwtp <command> --help` for command-specific options.',
    '',
    'The program (.program/) is sacred: human-ratified PRs only (INV-001).',
    'The ledger (refs/program/ledger) is profane: machine-append-only (INV-002).',
    '',
  ].join('\n');
}

export async function main(argv: readonly string[]): Promise<number> {
  // Split at the first non-flag token: everything before it is a global flag, everything
  // from it onward belongs to the subcommand.
  const split = argv.findIndex((a) => !a.startsWith('-'));
  const globalArgs = split === -1 ? [...argv] : argv.slice(0, split);
  const rest = split === -1 ? [] : argv.slice(split);

  let values: { help?: boolean | undefined; version?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...globalArgs],
      options: GLOBAL_OPTIONS,
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`gwtp: ${(e as Error).message}\n\n${usage()}`);
    return 2;
  }

  if (values.version === true) {
    process.stdout.write(`gwtp ${VERSION}\n`);
    return 0;
  }

  const commandName = rest[0];
  if (commandName === undefined) {
    process.stdout.write(usage());
    return values.help === true ? 0 : 2;
  }

  const spec = COMMANDS[commandName];
  if (spec === undefined) {
    process.stderr.write(`gwtp: unknown command \`${commandName}\`\n\n${usage()}`);
    return 2;
  }

  if (values.help === true) {
    process.stdout.write(`gwtp ${commandName} — ${spec.summary}\n`);
    return 0;
  }

  const mod = await spec.load();
  return mod.run(rest.slice(1));
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      process.stderr.write(`gwtp: ${(e as Error).message}\n`);
      process.exitCode = 1;
    });
}
