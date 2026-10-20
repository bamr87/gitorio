// Reporting CLI: editorial evidence is separate from the blind judge (spec 03)
// and never writes the normative store or ledger (spec 01).
import { parseArgs } from 'node:util';
import { prepareReport, runReport } from '../../reporting/report.js';

export async function run(argv: readonly string[]): Promise<number> {
  try {
    const { values } = parseArgs({ args: [...argv], options: {
      help: { type: 'boolean', short: 'h' },
      repo: { type: 'string' }, site: { type: 'string' }, out: { type: 'string' },
      ref: { type: 'string' }, since: { type: 'string' }, limit: { type: 'string' },
      github: { type: 'string' }, pr: { type: 'string', multiple: true },
      issue: { type: 'string', multiple: true }, run: { type: 'boolean' },
      provider: { type: 'string' },
    }, strict: true, allowPositionals: false });
    if (values.help) {
      process.stdout.write(`Usage: gwtp report --repo PATH --site PATH --out NEW_DIRECTORY [options]

Prepare evidence.json and agent-prompt.md without calling a model.
  --ref REV          Commit or branch tip (default HEAD)
  --since DATE       History lower bound (YYYY-MM-DD)
  --limit N          Maximum sampled commits (default 20, maximum 100)
  --github OWNER/REPO  Opt in to GitHub PR/issue evidence using gh
  --pr N --issue N   Select specific PRs/issues (repeatable; requires --github)
  --provider NAME    Text API provider: anthropic (default) or openai
  --run              Draft through the site's text-only API runner

Only committed history is collected. Review evidence for private material before --run.
No cloning, fetching, publication, commits, pushes, or governance changes are performed.
`);
      return 0;
    }
    if (!values.repo || !values.site || !values.out) throw new Error('--repo, --site and --out are required');
    const positive = (value: string): number => {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Selectors and limit must be positive integers');
      return Number(value);
    };
    const prepared = await prepareReport({
      repo: values.repo, site: values.site, out: values.out,
      ref: values.ref, since: values.since,
      limit: values.limit === undefined ? undefined : positive(values.limit),
      github: values.github, prs: values.pr?.map(positive), issues: values.issue?.map(positive),
    });
    process.stdout.write(`Prepared report: ${prepared.out}\n`);
    if (values.run) {
      if (values.provider !== undefined && values.provider !== 'anthropic' && values.provider !== 'openai') {
        throw new Error('--provider must be anthropic or openai');
      }
      process.stdout.write(`${await runReport(prepared, values.provider ?? 'anthropic')}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`gwtp report: ${(error as Error).message}\n`);
    return 1;
  }
}
