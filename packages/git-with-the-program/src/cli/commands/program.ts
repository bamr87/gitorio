// Implements: docs/spec/01-core-memory.md — inspect the normative store (read-only).
// STUB: reading `.program/` is a SEED-01 follow-up alongside `gwtp validate`.
//
// This command is READ-ONLY by construction and must stay so: nothing writes to .program/
// except human-ratified PRs (INV-001).

export async function run(_argv: readonly string[]): Promise<number> {
  process.stderr.write(
    'gwtp program: not implemented (SEED-01)\n' +
      '  Contract already fixed in src/core: Program, decodeInvariantsFile, decodePrecedentsFile,\n' +
      '  decodeManifest, decodeScopeFile, decodeTrajectoryFile, enforcedAssertions,\n' +
      '  assertionsGoverning, unclaimedPaths.\n' +
      '  READ-ONLY: nothing writes to .program/ except human-ratified PRs (INV-001).\n',
  );
  return 1;
}
