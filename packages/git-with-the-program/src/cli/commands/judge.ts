// Implements: docs/spec/03-judge.md — run the judgment ladder; bar-exam a candidate judge.
// STUB: SEED-03 lands the deterministic judges, the assembler, panels and the bar exam.

export async function run(_argv: readonly string[]): Promise<number> {
  process.stderr.write(
    'gwtp judge: not implemented (SEED-03)\n' +
      '  Contract already fixed in src/core: Judge, sealEvidence, decodeVerdict,\n' +
      '  medianSeverityOrdinal, severityRungSpread, verdictCacheKey, judgeHash.\n' +
      '  See seeds/SEED-03-judge-harness.md.\n',
  );
  return 1;
}
