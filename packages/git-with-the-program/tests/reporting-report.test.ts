// Reporting handoff tests: publication is draft-only and independent of spec 03 judges.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptReport, prepareReport, runReport } from '../src/reporting/report.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gwtp-report-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const site = join(root, 'site');
  await mkdir(repo);
  for (const directory of ['_data/campaigns', '_data/brand', 'pages/_posts/field-notes', 'scripts/ai']) await mkdir(join(site, directory), { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Initial report fixture']);
  await writeFile(join(site, '_data/campaigns/git-with-the-program.yml'), `id: git-with-the-program
series: git-with-the-program
voice: git-with-the-program
section: Field Notes
article_directory: pages/_posts/field-notes
author: claude
instructions: [Cite sources]
`);
  await writeFile(join(site, '_data/authors.yml'), 'claude: {name: Claude}\n');
  await writeFile(join(site, '_data/brand/voice.yml'), 'git-with-the-program: {tone: critical}\n');
  await writeFile(join(site, '_data/brand/identity.yml'), 'prime_directive: Never invent evidence\n');
  return { root, repo, site, out: join(root, 'bundle') };
}

describe('repository reporting handoff', () => {
  it('prepares evidence and prompt without publishing or mutating source Git', async () => {
    const options = await fixture();
    const before = execFileSync('git', ['-C', options.repo, 'show-ref']).toString();
    const prepared = await prepareReport(options);
    expect(JSON.parse(await readFile(join(options.out, 'evidence.json'), 'utf8')).schemaVersion).toBe(1);
    expect(prepared.prompt).toContain('UNTRUSTED DATA');
    expect(prepared.prompt).toContain(prepared.digest);
    expect(await readdir(join(options.site, 'pages/_posts/field-notes'))).toEqual([]);
    expect(execFileSync('git', ['-C', options.repo, 'show-ref']).toString()).toBe(before);
    await expect(prepareReport(options)).rejects.toThrow();
  });

  it('writes validated unpublished articles with retained provenance and refuses overwrite', async () => {
    const options = await fixture();
    const prepared = await prepareReport(options);
    const id = prepared.evidence.commits[0]!.id;
    const response = JSON.stringify({ status: 'draft', title: 'A repository enters the chat', description: 'An evidence-based history.', excerpt: 'One commit, no mythology.', body: `A commit exists [${id}].`, evidenceIds: [id] });
    expect(await acceptReport(prepared, response)).toContain('Unpublished draft:');
    const directory = join(options.site, 'pages/_posts/field-notes');
    const files = await readdir(directory);
    const article = await readFile(join(directory, files[0]!), 'utf8');
    expect(article).toContain('published: false');
    expect(article).toContain('series: git-with-the-program');
    expect(article).toContain(prepared.digest);
    await expect(acceptReport(prepared, response)).rejects.toThrow();
  });

  it('rejects missing citations and template injection', async () => {
    const prepared = await prepareReport(await fixture());
    const result = { status: 'draft', title: 'Report', description: 'Description', excerpt: 'Excerpt', body: 'Unsupported claim [fake].', evidenceIds: ['fake'] };
    await expect(acceptReport(prepared, JSON.stringify(result))).rejects.toThrow('citations');
    const id = prepared.evidence.commits[0]!.id;
    await expect(acceptReport(prepared, JSON.stringify({ ...result, body: `Claim [${id}] and [git-commit:fake].`, evidenceIds: [id] }))).rejects.toThrow('omitted');
    result.body = '{{ site.secret }}';
    await expect(acceptReport(prepared, JSON.stringify(result))).rejects.toThrow('Liquid');
  });

  it('normalizes a bare commit SHA to its evidence ID', async () => {
    const options = await fixture();
    const prepared = await prepareReport(options);
    const commit = prepared.evidence.commits[0]!;
    const response = JSON.stringify({ status: 'draft', title: 'SHA citation', description: 'Description', excerpt: 'Excerpt', body: `The commit is visible [${commit.sha}].`, evidenceIds: [commit.sha] });
    expect(await acceptReport(prepared, response)).toContain('Unpublished draft:');
    const article = await readFile(join(options.site, 'pages/_posts/field-notes', (await readdir(join(options.site, 'pages/_posts/field-notes')))[0]!), 'utf8');
    expect(article).toContain(`[${commit.id}]`);
  });

  it('records an explicit no-story without producing an article', async () => {
    const options = await fixture();
    const prepared = await prepareReport(options);
    expect(await acceptReport(prepared, '{"status":"no-story","reason":"Not enough evidence"}')).toContain('No story');
    expect(await readdir(join(options.site, 'pages/_posts/field-notes'))).toEqual([]);
  });

  it('does not treat a runner no-op as success', async () => {
    const options = await fixture();
    await writeFile(join(options.site, 'scripts/ai/run.sh'), '#!/bin/bash\nexit 0\n');
    const prepared = await prepareReport(options);
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    try { await expect(runReport(prepared)).rejects.toThrow('no response'); }
    finally { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; }
  });

  it('processes structured output from the site runner end to end', async () => {
    const options = await fixture();
    const prepared = await prepareReport(options);
    const id = prepared.evidence.commits[0]!.id;
    const response = JSON.stringify({ status: 'draft', title: 'Runner fixture', description: 'Fixture description', excerpt: 'Fixture excerpt', body: `The initial commit exists [${id}].`, evidenceIds: [id] });
    await writeFile(join(options.site, 'scripts/ai/run.sh'), `#!/bin/bash
[ "$AI_FORCE_API" = "1" ] || exit 9
[ "$AI_PROVIDER" = "anthropic" ] || exit 11
[ "$AI_USAGE_DIR" = '${prepared.out}/usage' ] || exit 10
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--out" ]; then output="$2"; shift 2; else shift; fi
done
while IFS= read -r line; do :; done
printf '%s' '${response}' > "$output"
`);
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    try { expect(await runReport(prepared)).toContain('Unpublished draft:'); }
    finally { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; }
    expect(JSON.parse(await readFile(join(options.out, 'result.json'), 'utf8')).status).toBe('draft');
  });

  it('selects the OpenAI text API without invoking Anthropic', async () => {
    const options = await fixture();
    const prepared = await prepareReport(options);
    await writeFile(join(options.site, 'scripts/ai/run.sh'), `#!/bin/bash
[ "$AI_PROVIDER" = "openai" ] || exit 12
[ "$AI_MODEL" = "gpt-4.1" ] || exit 13
[ -n "$OPENAI_API_KEY" ] || exit 14
printf '%s' '{"status":"no-story","reason":"fixture"}' > "$2"
`);
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    try { await expect(runReport(prepared, 'openai')).resolves.toContain('No story'); }
    finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
  });

  it('refuses oversized prompts before invoking the runner', async () => {
    const prepared = await prepareReport(await fixture());
    await expect(runReport({ ...prepared, prompt: 'x'.repeat(100_000) })).rejects.toThrow('size limit');
  });

  it('refuses evidence output inside the source repository or site', async () => {
    const options = await fixture();
    await expect(prepareReport({ ...options, out: join(options.repo, 'output') })).rejects.toThrow('outside');
    await expect(prepareReport({ ...options, out: join(options.site, 'output') })).rejects.toThrow('outside');
  });
});
