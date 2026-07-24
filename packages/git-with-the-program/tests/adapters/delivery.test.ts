// Implements tests for: seeds/SEED-02-ledger-engine.md deliverable 3 ("v0 delivery: open a
// GitHub issue via the adapter containing the full evidence bundle"), docs/vision.md non-goals
// ("a bare repo degrades gracefully to commits-only"), and INV-005 ("Engine core imports no
// forge-specific APIs; GitHub access lives in adapters/").
//
// THREE THINGS THIS FILE IS ACTUALLY FOR.
//
// 1. IDEMPOTENCY. Content addressing makes the LEDGER idempotent (spec 02 §1 property 1);
//    nothing makes a forge idempotent. A CI retry or a second `gwtp ledger fold` over the same
//    event set re-derives the same firing — accumulators are derived, never authoritative
//    (ADR-0002) — and would file a second issue about it. The headline test is therefore
//    "deliver the same firing twice, get one issue", asserted on the CREATE COUNT of a fake
//    client rather than on a message string.
//
// 2. NO NETWORK, NO SUBPROCESS. Every transport is injected. The suite stubs `globalThis.fetch`
//    with a spy that throws and asserts it was never called, so "the tests must not make
//    network calls" is a checked property rather than a habit.
//
// 3. INV-005 AS A GREP. The last describe block reads `src/core/**` and `src/ledger/**` off
//    disk and asserts that no forge-shaped token survives comment-stripping. That is the
//    deliverable stated as a test: `DeliveryPort` lives in core precisely so that src/ledger
//    can hold one and be unable to name GitHub.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContributingEvent, FoldKnobs } from '../../src/core/accumulator.js';
import { REARM_FRACTION_DEFAULT } from '../../src/core/accumulator.js';
import { decodeAssertion, parseBudget } from '../../src/core/assertion.js';
import type { NonEmptyReadonlyArray } from '../../src/core/brand.js';
import type { DeliveryDocument, DeliveryPort } from '../../src/core/delivery.js';
import {
  DELIVERY_MARKER_PREFIX,
  deliveryKey,
  deliveryKeyParts,
  deliveryMarker,
  findDeliveryMarker,
  parseDeliveryKey,
} from '../../src/core/delivery.js';
import { computeDispersion, type EvidenceLocus } from '../../src/core/dispersion.js';
import type { AccumulatorKey, EventId } from '../../src/core/ids.js';
import { parseAccumulatorKey, parseEventId } from '../../src/core/ids.js';
import { parseRepoPath } from '../../src/core/paths.js';
import type { Proposal, ProposalKind } from '../../src/core/proposal.js';
import { unwrap } from '../../src/core/result.js';
import { actorId, surprise, withSentencingWarrant } from '../../src/core/sentencing.js';
import { MILLIS_PER_DAY, parseCommitterTime, parseDuration } from '../../src/core/time.js';
import type { CommitterTime } from '../../src/core/time.js';

import type { BareFileSystem } from '../../src/adapters/github/bare.js';
import {
  BARE_CHANNEL,
  DEFAULT_BARE_DELIVERY_DIR,
  bareDelivery,
  bareFileName,
  nodeBareFileSystem,
} from '../../src/adapters/github/bare.js';
import type {
  CommandResult,
  CommandRunner,
  FetchLike,
  GitHubIssueRef,
  GitHubIssuesClient,
  GitHubTransport,
  HttpRequest,
} from '../../src/adapters/github/issues.js';
import {
  GITHUB_ISSUE_BODY_LIMIT,
  GitHubApiError,
  ISSUE_CHANNEL,
  deliveryFailureFromError,
  ghCliTransport,
  ghExitStatus,
  fetchTransport,
  githubIssueDelivery,
  issueUrl,
  openGitHubIssueDelivery,
  parseGitHubRepo,
  resolveGitHubTransport,
  restIssuesClient,
} from '../../src/adapters/github/issues.js';
import { renderProposal } from '../../src/adapters/github/render.js';

// ---------------------------------------------------------------------------
// Fixtures — a real rendered proposal, so delivery is tested on the real payload
// ---------------------------------------------------------------------------

const WARRANT = withSentencingWarrant((w) => w);

const KEY = unwrap(parseAccumulatorKey('INV-007')) as AccumulatorKey;
const REPO = unwrap(parseGitHubRepo('acme/widgets'));

const t = (s: string): CommitterTime => unwrap(parseCommitterTime(s));
const evid = (n: number): EventId =>
  unwrap(parseEventId(`sha256:${n.toString(16).padStart(8, 'a')}${'0'.repeat(56)}`));
const dayAt = (day: number): CommitterTime =>
  t(new Date(Date.UTC(2026, 0, 1) + day * MILLIS_PER_DAY).toISOString().replace(/\.\d{3}Z$/, 'Z'));

const KNOBS: FoldKnobs = {
  halfLife: unwrap(parseDuration('90d')),
  budget: unwrap(parseBudget(3)),
  precisionOverride: null,
  rearmFraction: REARM_FRACTION_DEFAULT,
};

const ASSERTION = unwrap(
  decodeAssertion({
    id: 'INV-007',
    statement: 'Core stays dependency-free; adapters own all third-party imports',
    class: 'boundary',
    scope: ['src/core/**'],
    enforcement: 'judgment',
    precision: 0.9,
    budget: 3.0,
    half_life: '90d',
    status: 'ratified',
    provenance: ['pr#41', 'adr-0003'],
  }),
);

interface Spec {
  readonly n: number;
  readonly day: number;
  readonly who: string;
  readonly path: string;
}

const SPECS: readonly Spec[] = [
  { n: 1, day: 1, who: 'Dana Ruiz <dana@example.com>', path: 'src/core/http.ts' },
  { n: 2, day: 3, who: 'Dana Ruiz <dana@example.com>', path: 'src/core/http.ts' },
  { n: 3, day: 6, who: 'Dana Ruiz <dana@example.com>', path: 'src/core/http.ts' },
];

function proposalFor(kind: ProposalKind, triggeredBy: EventId, key: AccumulatorKey = KEY): Proposal {
  const contributing = SPECS.map(
    (s): ContributingEvent => ({
      event: evid(s.n),
      key,
      t: dayAt(s.day),
      verdict: 'drift',
      rawWeight: 1,
      residualWeight: surprise(0.8),
    }),
  ) as unknown as NonEmptyReadonlyArray<ContributingEvent>;

  const loci = new Map<EventId, EvidenceLocus>(
    SPECS.map((s) => [
      evid(s.n),
      {
        event: evid(s.n),
        actor: actorId(s.who),
        paths: [unwrap(parseRepoPath(s.path))],
      } satisfies EvidenceLocus,
    ]),
  );

  return {
    kind,
    key,
    firedAt: dayAt(200),
    triggeredBy,
    evidence: {
      contributing,
      dispersion: unwrap(computeDispersion({ key, contributing, loci, complianceCount: 9 }, WARRANT)),
      violationCount: SPECS.length,
      complianceCount: 9,
      accumulated: surprise(3.12),
      budget: KNOBS.budget,
      knobs: KNOBS,
    },
  };
}

function docFor(triggeredBy = evid(999), key: AccumulatorKey = KEY): DeliveryDocument {
  return unwrap(
    renderProposal(
      { proposal: proposalFor('refactor', triggeredBy, key), assertion: key === KEY ? ASSERTION : null, amendment: null },
      WARRANT,
    ),
  );
}

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

interface FakeIssue {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

/** An in-memory forge: the search index and the create route, and nothing else. */
function fakeIssues(): {
  client: GitHubIssuesClient;
  issues: FakeIssue[];
  searches: number;
  creates: number;
} {
  const state = {
    client: undefined as unknown as GitHubIssuesClient,
    issues: [] as FakeIssue[],
    searches: 0,
    creates: 0,
  };
  state.client = {
    async findByMarker(marker) {
      state.searches += 1;
      return state.issues
        .filter((i) => i.body.includes(marker))
        .map((i): GitHubIssueRef => ({ number: i.number, url: i.url }));
    },
    async create(input) {
      state.creates += 1;
      const number = state.issues.length + 1;
      state.issues.push({
        number,
        url: issueUrl(REPO, number),
        title: input.title,
        body: input.body,
        labels: [...input.labels],
      });
      return { number, url: issueUrl(REPO, number) };
    },
  };
  return state;
}

function memFs(): { fs: BareFileSystem; files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    fs: {
      async exists(path) {
        return files.has(path);
      },
      async mkdirp(path) {
        dirs.add(path);
      },
      async read(path) {
        const v = files.get(path);
        if (v === undefined) throw new Error(`ENOENT: ${path}`);
        return v;
      },
      async write(path, contents) {
        files.set(path, contents);
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Idempotency — the headline
// ---------------------------------------------------------------------------

describe('githubIssueDelivery — the same firing must not open duplicate issues', () => {
  it('files one issue the first time, and finds it the second', async () => {
    const forge = fakeIssues();
    const port = githubIssueDelivery({ repo: REPO, client: forge.client });
    const doc = docFor();

    const first = await port.deliver(doc);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('first delivery failed');
    expect(first.value.status).toBe('created');
    expect(first.value.channel).toBe(ISSUE_CHANNEL);
    expect(first.value.locator).toBe('https://github.com/acme/widgets/issues/1');
    expect(first.value.reference).toBe('1');

    // The CI retry / second fold. Same event set, same knobs, same firing, same key.
    const second = await port.deliver(docFor());
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('second delivery failed');

    // `existing` is a SUCCESS: it is what idempotency looks like from the outside.
    expect(second.value.status).toBe('existing');
    expect(second.value.locator).toBe(first.value.locator);
    expect(second.value.key).toBe(first.value.key);

    expect(forge.creates).toBe(1);
    expect(forge.issues).toHaveLength(1);
    // And it looked BEFORE it wrote, both times.
    expect(forge.searches).toBe(2);
  });

  it('keys on assertion + firing event id, so a NEW firing gets its own issue', async () => {
    const forge = fakeIssues();
    const port = githubIssueDelivery({ repo: REPO, client: forge.client });

    await port.deliver(docFor(evid(999)));
    await port.deliver(docFor(evid(1000)));
    expect(forge.creates).toBe(2);

    // …and re-delivering the FIRST one still finds the first issue, not the second.
    const again = await port.deliver(docFor(evid(999)));
    expect(again.ok && again.value.status).toBe('existing');
    expect(again.ok && again.value.reference).toBe('1');
    expect(forge.creates).toBe(2);
  });

  it('separates two assertions that fired on the same event', async () => {
    const other = unwrap(parseAccumulatorKey('INV-008')) as AccumulatorKey;
    const forge = fakeIssues();
    const port = githubIssueDelivery({ repo: REPO, client: forge.client });

    await port.deliver(docFor(evid(999), KEY));
    await port.deliver(docFor(evid(999), other));
    expect(forge.creates).toBe(2);
    expect(deliveryKey(KEY, evid(999))).not.toBe(deliveryKey(other, evid(999)));
  });

  it('delivers the FULL evidence bundle, not a summary (spec 02 §5)', async () => {
    const forge = fakeIssues();
    await githubIssueDelivery({ repo: REPO, client: forge.client }).deliver(docFor());
    const filed = forge.issues[0];
    expect(filed).toBeDefined();
    const body = filed?.body ?? '';

    expect(body).toContain('## The meter');
    expect(body).toContain('decay-weighted total at firing');
    expect(body).toContain('## Contributing events');
    expect(body).toContain('## Dispersion (spec 02 §5)');
    expect(body).toContain('compliance ratio');
    expect(body).toContain('## Knobs used');
    expect(body).toContain('gwtp ledger replay --key INV-007');
    expect(filed?.labels).toContain('gwtp-proposal');
    expect(filed?.title).toContain('INV-007');

    // The identity that produced the dispersion never reaches the forge.
    expect(body).not.toContain('Dana Ruiz');
    expect(body).not.toContain('dana@example.com');
  });

  it('carries the marker into the issue body even if a renderer forgot it', async () => {
    const forge = fakeIssues();
    const port = githubIssueDelivery({ repo: REPO, client: forge.client });
    const doc = docFor();
    const stripped: DeliveryDocument = {
      ...doc,
      body: doc.body.replace(new RegExp(`<!-- ${DELIVERY_MARKER_PREFIX}[^>]*-->`), ''),
    };
    expect(findDeliveryMarker(stripped.body)).toBeNull();

    await port.deliver(stripped);
    expect(findDeliveryMarker(forge.issues[0]?.body ?? '')).toBe(doc.key);

    // Which means the NEXT delivery is still idempotent. That is the whole reason
    // `deliver` does not trust the renderer's good manners.
    await port.deliver(stripped);
    expect(forge.creates).toBe(1);
  });

  it('refuses an over-long body rather than truncating the evidence', async () => {
    const forge = fakeIssues();
    const port = githubIssueDelivery({ repo: REPO, client: forge.client });
    const doc = docFor();
    const huge: DeliveryDocument = { ...doc, body: 'x'.repeat(GITHUB_ISSUE_BODY_LIMIT + 1) };

    const r = await port.deliver(huge);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected refusal');
    expect(r.error.code).toBe('rejected');
    expect(r.error.retryable).toBe(false);
    // It failed BEFORE touching the forge — no half-written issue.
    expect(forge.searches).toBe(0);
    expect(forge.creates).toBe(0);
  });

  it('reports a search failure as data, so a sweep filing ten proposals loses one, not nine', async () => {
    const port = githubIssueDelivery({
      repo: REPO,
      client: {
        async findByMarker() {
          throw new GitHubApiError(502, 'bad gateway');
        },
        async create() {
          throw new Error('must not be reached: never create without looking first');
        },
      },
    });
    const r = await port.deliver(docFor());
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error.code).toBe('transport');
    expect(r.error.retryable).toBe(true);
  });

  it('never calls the real network', async () => {
    const spy = vi.fn(() => {
      throw new Error('a test made a network call');
    });
    vi.stubGlobal('fetch', spy);
    const forge = fakeIssues();
    await githubIssueDelivery({ repo: REPO, client: forge.client }).deliver(docFor());
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The delivery key
// ---------------------------------------------------------------------------

describe('the delivery key survives a round trip through a markdown-only channel', () => {
  it('parses back into the assertion and the firing event hex', () => {
    const k = deliveryKey(KEY, evid(999));
    expect(parseDeliveryKey(k).ok).toBe(true);
    const parts = deliveryKeyParts(k);
    expect(parts?.assertion).toBe('INV-007');
    expect(parts?.eventHex).toHaveLength(64);
    expect(`sha256:${parts?.eventHex}`).toBe(evid(999));
  });

  it('is recoverable from the rendered body alone — no side channel', () => {
    const doc = docFor();
    expect(findDeliveryMarker(doc.body)).toBe(doc.key);
    expect(doc.body).toContain(deliveryMarker(doc.key));
  });

  it('rejects a malformed key rather than filing under it', () => {
    expect(parseDeliveryKey('gwtp-proposal:INV-007@short').ok).toBe(false);
    expect(parseDeliveryKey(42).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Failure classification — retryable or not is load-bearing
// ---------------------------------------------------------------------------

describe('deliveryFailureFromError', () => {
  it.each([
    [401, 'bad credentials', 'unauthenticated', false],
    [403, 'API rate limit exceeded', 'rate-limited', true],
    [403, 'resource not accessible', 'unauthenticated', false],
    [404, 'Not Found', 'not-found', false],
    [422, 'Validation Failed', 'rejected', false],
    [429, 'too many requests', 'rate-limited', true],
    [500, 'server error', 'transport', true],
    [503, 'unavailable', 'transport', true],
  ] as const)('maps HTTP %i to %s (retryable: %s)', (status, detail, code, retryable) => {
    const f = deliveryFailureFromError(new GitHubApiError(status, detail));
    expect(f.error.code).toBe(code);
    expect(f.error.retryable).toBe(retryable);
  });

  it('treats an unknown throw as retryable transport noise, never as a rejection', () => {
    const f = deliveryFailureFromError(new Error('ECONNRESET'));
    expect(f.error.code).toBe('transport');
    expect(f.error.retryable).toBe(true);
  });

  it('recovers a status code from `gh api` stderr so classification stays honest', () => {
    expect(ghExitStatus('gh: Not Found (HTTP 404)')).toBe(404);
    expect(ghExitStatus('gh auth login required')).toBe(401);
    expect(ghExitStatus('something else entirely')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Transport selection — `gh` if present, fetch + GITHUB_TOKEN otherwise
// ---------------------------------------------------------------------------

describe('resolveGitHubTransport', () => {
  const noRun: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'not installed' });

  it('prefers the `gh` CLI when it is on PATH, and never sees a token', async () => {
    const calls: { command: string; args: readonly string[]; stdin?: string }[] = [];
    const run: CommandRunner = async (command, args, stdin) => {
      calls.push({ command, args, ...(stdin === undefined ? {} : { stdin }) });
      return { code: 0, stdout: JSON.stringify({ number: 7, html_url: 'u' }), stderr: '' };
    };
    const r = await resolveGitHubTransport({
      run,
      ghAvailable: async () => true,
      env: { GITHUB_TOKEN: 'should-not-be-used' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unexpected');
    expect(r.value.via).toBe('gh');

    await r.value.transport({ method: 'POST', path: 'repos/acme/widgets/issues', body: { a: 1 } });
    const call = calls[0];
    expect(call?.command).toBe('gh');
    expect(call?.args).toContain('api');
    expect(call?.args).toContain('--method');
    expect(call?.args).toContain('POST');
    // A raw JSON body, so `labels: []` stays an array instead of being flattened by `-f`.
    expect(call?.args).toContain('--input');
    expect(JSON.parse(call?.stdin ?? '{}')).toEqual({ a: 1 });
    // The token never appears in the argv the CLI is handed.
    expect(JSON.stringify(calls)).not.toContain('should-not-be-used');
  });

  it('falls back to fetch + GITHUB_TOKEN when `gh` is absent', async () => {
    const seen: { url: string; init: { method: string; headers: Record<string, string> } }[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      seen.push({ url, init: init as { method: string; headers: Record<string, string> } });
      return { status: 200, async text() { return JSON.stringify({ items: [] }); } };
    };
    const r = await resolveGitHubTransport({
      run: noRun,
      fetch: fakeFetch,
      env: { GITHUB_TOKEN: 'ghp_test' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unexpected');
    expect(r.value.via).toBe('fetch');

    await r.value.transport({ method: 'GET', path: 'search/issues', query: { q: 'a b' } });
    expect(seen[0]?.url).toBe('https://api.github.com/search/issues?q=a+b');
    expect(seen[0]?.init.headers['authorization']).toBe('Bearer ghp_test');
    expect(seen[0]?.init.headers['x-github-api-version']).toBeDefined();
  });

  it('accepts GH_TOKEN as well as GITHUB_TOKEN', async () => {
    const r = await resolveGitHubTransport({
      run: noRun,
      fetch: async () => ({ status: 200, async text() { return '{}'; } }),
      env: { GH_TOKEN: 'x' },
    });
    expect(r.ok && r.value.via).toBe('fetch');
  });

  it('fails honestly when neither is available — never a silent no-op port', async () => {
    const r = await resolveGitHubTransport({ run: noRun, fetch: undefined, env: {} });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unexpected');
    expect(r.error.code).toBe('unconfigured');
    expect(r.error.retryable).toBe(false);
    // And it names the degradation path rather than leaving the operator guessing.
    expect(r.error.message).toContain('bare');
  });

  it('surfaces a non-2xx from fetch as a classified GitHubApiError', async () => {
    const transport = fetchTransport({
      token: 'x',
      fetch: async () => ({ status: 404, async text() { return 'Not Found'; } }),
    });
    await expect(transport({ method: 'GET', path: 'x' })).rejects.toBeInstanceOf(GitHubApiError);
  });

  it('surfaces a non-zero `gh` exit as a classified GitHubApiError', async () => {
    const transport = ghCliTransport(async () => ({
      code: 1,
      stdout: '',
      stderr: 'gh: Not Found (HTTP 404)',
    } satisfies CommandResult));
    await expect(transport({ method: 'GET', path: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('assembles a whole port from a slug, or explains why it cannot', async () => {
    const built = await openGitHubIssueDelivery({
      repo: REPO,
      env: { GITHUB_TOKEN: 'x' },
      fetch: async () => ({ status: 200, async text() { return '{"items":[]}'; } }),
      ghAvailable: async () => false,
    });
    expect(built.ok).toBe(true);
    expect(built.ok && built.value.channel).toBe(ISSUE_CHANNEL);

    const refused = await openGitHubIssueDelivery({
      repo: REPO,
      env: {},
      run: async () => ({ code: 1, stdout: '', stderr: '' }),
      ghAvailable: async () => false,
    });
    expect(refused.ok).toBe(false);
  });

  it('parses a repo slug and refuses everything that is not one', () => {
    expect(unwrap(parseGitHubRepo('acme/widgets'))).toEqual({ owner: 'acme', name: 'widgets' });
    for (const bad of ['acme', 'acme/', '/widgets', 'a/b/c', 42, null]) {
      expect(parseGitHubRepo(bad).ok, `accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The REST client, over a fake transport
// ---------------------------------------------------------------------------

describe('restIssuesClient', () => {
  function recording(reply: (req: HttpRequest) => unknown): {
    transport: GitHubTransport;
    reqs: HttpRequest[];
  } {
    const reqs: HttpRequest[] = [];
    return {
      reqs,
      transport: async (req) => {
        reqs.push(req);
        return { status: 200, body: reply(req) };
      },
    };
  }

  it('searches the body index scoped to the repository', async () => {
    const r = recording(() => ({ items: [] }));
    await restIssuesClient(REPO, r.transport).findByMarker('<!-- gwtp-delivery-key: k -->');
    expect(r.reqs[0]?.method).toBe('GET');
    expect(r.reqs[0]?.path).toBe('search/issues');
    expect(r.reqs[0]?.query?.['q']).toContain('repo:acme/widgets');
    expect(r.reqs[0]?.query?.['q']).toContain('is:issue');
    expect(r.reqs[0]?.query?.['q']).toContain('in:body');
  });

  it('re-checks the marker literally, because the search index tokenises', async () => {
    const marker = '<!-- gwtp-delivery-key: gwtp-proposal:INV-007@' + 'a'.repeat(64) + ' -->';
    const r = recording(() => ({
      items: [
        { number: 5, html_url: 'u5', body: 'a near-neighbour the index matched on tokens' },
        { number: 6, html_url: 'u6', body: `prose\n${marker}\nmore` },
      ],
    }));
    const found = await restIssuesClient(REPO, r.transport).findByMarker(marker);
    expect(found.map((f) => f.number)).toEqual([6]);
  });

  it('trusts the index when the payload carries no body — a false miss files a duplicate', async () => {
    const r = recording(() => ({ items: [{ number: 9, html_url: 'u9' }] }));
    const found = await restIssuesClient(REPO, r.transport).findByMarker('m');
    expect(found.map((f) => f.number)).toEqual([9]);
  });

  it('posts labels as a real array and returns the new issue number', async () => {
    const r = recording((req) =>
      req.method === 'POST' ? { number: 12, html_url: 'https://x/12' } : { items: [] },
    );
    const ref = await restIssuesClient(REPO, r.transport).create({
      title: 'T',
      body: 'B',
      labels: ['gwtp-proposal', 'gwtp:refactor'],
    });
    expect(ref).toEqual({ number: 12, url: 'https://x/12' });
    expect(r.reqs[0]?.path).toBe('repos/acme/widgets/issues');
    expect((r.reqs[0]?.body as { labels: string[] }).labels).toEqual([
      'gwtp-proposal',
      'gwtp:refactor',
    ]);
  });

  it('throws rather than inventing an issue number when creation returns nothing usable', async () => {
    const r = recording(() => ({ message: 'Validation Failed' }));
    await expect(
      restIssuesClient(REPO, r.transport).create({ title: 'T', body: 'B', labels: [] }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});

// ---------------------------------------------------------------------------
// bare.ts — the graceful degradation path
// ---------------------------------------------------------------------------

describe('bareDelivery — "a bare repo degrades gracefully to commits-only"', () => {
  it('writes the bundle to a file and returns a delivery receipt', async () => {
    const m = memFs();
    const logs: string[] = [];
    const port = bareDelivery({ fs: m.fs, log: (l) => logs.push(l) });
    const doc = docFor();

    const r = await port.deliver(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('bare delivery failed');

    expect(r.value.status).toBe('created');
    expect(r.value.channel).toBe(BARE_CHANNEL);
    expect(r.value.key).toBe(doc.key);
    expect(r.value.locator).toBe(`${DEFAULT_BARE_DELIVERY_DIR}/${bareFileName(doc.key)}`);
    expect(r.value.reference).toBe(r.value.locator);

    expect(m.files.size).toBe(1);
    const written = m.files.get(r.value.locator) ?? '';
    expect(written).toContain('## The meter');
    expect(written).toContain('## Dispersion (spec 02 §5)');
    expect(written).toContain('gwtp ledger replay');
    expect(findDeliveryMarker(written)).toBe(doc.key);
    expect(written.endsWith('\n')).toBe(true);

    // It LOGS it: a proposal nobody is told about is a proposal that was dropped.
    expect(logs.join('\n')).toContain(r.value.locator);
    expect(logs.join('\n')).toContain('no forge configured');
  });

  it('is idempotent: the same firing twice writes one file', async () => {
    const m = memFs();
    const logs: string[] = [];
    const port = bareDelivery({ fs: m.fs, log: (l) => logs.push(l) });

    const first = await port.deliver(docFor());
    const second = await port.deliver(docFor());
    expect(first.ok && first.value.status).toBe('created');
    expect(second.ok && second.value.status).toBe('existing');
    expect(m.files.size).toBe(1);
    expect(logs.join('\n')).toContain('no duplicate written');
  });

  it('writes the SAME bytes an issue body would carry', async () => {
    const m = memFs();
    const forge = fakeIssues();
    const doc = docFor();
    await bareDelivery({ fs: m.fs, log: () => {} }).deliver(doc);
    await githubIssueDelivery({ repo: REPO, client: forge.client }).deliver(doc);

    const onDisk = [...m.files.values()][0] ?? '';
    const inIssue = forge.issues[0]?.body ?? '';
    // Modulo the trailing newline a file gets and an issue body does not.
    expect(onDisk.trimEnd()).toBe(inIssue.trimEnd());
  });

  it('defaults under .gwtp/, never .program/ — INV-001 fires at budget 1.0', async () => {
    expect(DEFAULT_BARE_DELIVERY_DIR.startsWith('.gwtp/')).toBe(true);
    expect(DEFAULT_BARE_DELIVERY_DIR).not.toContain('.program');

    const m = memFs();
    await bareDelivery({ fs: m.fs, log: () => {} }).deliver(docFor());
    for (const p of m.files.keys()) expect(p).not.toContain('.program/');
    for (const d of m.dirs) expect(d).not.toContain('.program/');
  });

  it('honours a configurable directory', async () => {
    const m = memFs();
    const r = await bareDelivery({ directory: 'out/proposals', fs: m.fs, log: () => {} }).deliver(
      docFor(),
    );
    expect(r.ok && r.value.locator.startsWith('out/proposals/')).toBe(true);
    expect(m.dirs.has('out/proposals')).toBe(true);
  });

  it('turns the key into a filename that is safe on any filesystem', () => {
    const name = bareFileName(deliveryKey(KEY, evid(999)));
    expect(name).toMatch(/^[A-Za-z0-9._-]+\.md$/);
    expect(name).toContain('INV-007');
    expect(name).not.toContain(':');
    expect(name).not.toContain('@');
    expect(name).not.toContain('/');
  });

  it('refuses to overwrite a file whose marker is a DIFFERENT firing', async () => {
    // `bareFileName` sanitises, and sanitisation is lossy: `parseAccumulatorKey` admits any
    // whitespace-free string (Q-04). Reporting `existing` here would drop this proposal.
    const m = memFs();
    const doc = docFor();
    const path = `${DEFAULT_BARE_DELIVERY_DIR}/${bareFileName(doc.key)}`;
    m.files.set(path, `someone else's proposal\n${deliveryMarker(deliveryKey(KEY, evid(4242)))}\n`);

    const r = await bareDelivery({ fs: m.fs, log: () => {} }).deliver(doc);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected refusal');
    expect(r.error.code).toBe('rejected');
    expect(r.error.retryable).toBe(false);
    expect(r.error.message).toContain('refusing to overwrite');
    // And the other proposal is still on disk, unharmed.
    expect(m.files.get(path)).toContain("someone else's proposal");
  });

  it('refuses to overwrite an unrelated file that happens to sit at that path', async () => {
    const m = memFs();
    const doc = docFor();
    const path = `${DEFAULT_BARE_DELIVERY_DIR}/${bareFileName(doc.key)}`;
    m.files.set(path, 'notes a human left here, no marker at all');

    const r = await bareDelivery({ fs: m.fs, log: () => {} }).deliver(doc);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected refusal');
    expect(r.error.message).toContain('<none>');
    expect(m.files.get(path)).toBe('notes a human left here, no marker at all');
  });

  it('reports a write failure as retryable data rather than throwing', async () => {
    const port = bareDelivery({
      fs: {
        async exists() {
          return false;
        },
        async mkdirp() {},
        async read() {
          return '';
        },
        async write() {
          throw new Error('EACCES: read-only file system');
        },
      },
      log: () => {},
    });
    const r = await port.deliver(docFor());
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error.code).toBe('transport');
    expect(r.error.retryable).toBe(true);
    expect(r.error.message).toContain('EACCES');
  });

  it('really writes to a real filesystem — in a THROWAWAY directory under $TMPDIR', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'gwtp-bare-'));
    const dir = join(scratch, '.gwtp', 'proposals');
    const doc = docFor();

    const r = await bareDelivery({
      directory: dir,
      fs: nodeBareFileSystem(),
      log: () => {},
    }).deliver(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unexpected');

    const onDisk = readFileSync(r.value.locator, 'utf8');
    expect(findDeliveryMarker(onDisk)).toBe(doc.key);
    expect(onDisk).toContain('## The meter');
    expect(statSync(r.value.locator).isFile()).toBe(true);

    // Second run over the same directory: still one file.
    const again = await bareDelivery({
      directory: dir,
      fs: nodeBareFileSystem(),
      log: () => {},
    }).deliver(docFor());
    expect(again.ok && again.value.status).toBe('existing');
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('needs no forge, no token and no network to work at all', async () => {
    const spy = vi.fn(() => {
      throw new Error('a bare delivery reached the network');
    });
    vi.stubGlobal('fetch', spy);
    const m = memFs();
    const r = await bareDelivery({ fs: m.fs, log: () => {} }).deliver(docFor());
    expect(r.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// INV-005 — the port is on the core side, and core cannot name a forge
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Block comments and whole-line `//` comments. The prose in this repo discusses GitHub freely. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n');
}

describe('INV-005: engine core imports no forge-specific APIs', () => {
  const ENGINE = [
    ...tsFilesUnder(join(REPO_ROOT, 'src/core')),
    ...tsFilesUnder(join(REPO_ROOT, 'src/ledger')),
  ];

  it('scans a non-trivial number of engine files (the check is not vacuous)', () => {
    expect(ENGINE.length).toBeGreaterThan(10);
  });

  /**
   * POSITIVE CONTROL. Without this, `stripComments` quietly returning `''` — or a token list
   * that matches nothing anywhere — would make the whole block pass by scanning nothing. The
   * adapter is the file that legitimately DOES speak GitHub, so the same scan must trip on it.
   */
  it('the same scan trips on the adapter, which is the file allowed to name a forge', () => {
    const adapter = stripComments(
      readFileSync(join(REPO_ROOT, 'src/adapters/github/issues.ts'), 'utf8'),
    );
    expect(adapter.length).toBeGreaterThan(1000);
    for (const token of ['api.github.com', 'GITHUB_TOKEN', 'github.com', 'X-GitHub-Api-Version']) {
      expect(adapter.toLowerCase(), `scan failed to see ${token}`).toContain(token.toLowerCase());
    }
  });

  it.each([
    'octokit',
    'api.github.com',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'github.com',
    'X-GitHub-Api-Version',
  ])('no engine file contains %s in code', (token) => {
    for (const file of ENGINE) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code.toLowerCase(), `${file} names ${token}`).not.toContain(token.toLowerCase());
    }
  });

  it('no engine file imports from src/adapters', () => {
    for (const file of ENGINE) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${file} imports an adapter`).not.toMatch(/from\s+['"][^'"]*adapters/);
    }
  });

  it('declares the port in core, with one method and no forge-shaped accessor', () => {
    const core = readFileSync(join(REPO_ROOT, 'src/core/delivery.ts'), 'utf8');
    expect(core).toContain('export interface DeliveryPort');
    // `channel` and `locator` are opaque strings the adapter fills in for itself, so core
    // never has to enumerate the forges that exist.
    expect(core).toContain('deliver(doc: DeliveryDocument): Promise<DeliveryOutcome>');
    for (const forgeShaped of ['createIssue', 'issueNumber', 'owner', 'token', 'apiBase']) {
      expect(stripComments(core), `core/delivery.ts exposes ${forgeShaped}`).not.toContain(
        forgeShaped,
      );
    }
  });

  it('is satisfiable by two completely different channels, structurally', async () => {
    const m = memFs();
    const forge = fakeIssues();
    const ports: readonly DeliveryPort[] = [
      bareDelivery({ fs: m.fs, log: () => {} }),
      githubIssueDelivery({ repo: REPO, client: forge.client }),
    ];
    const doc = docFor();
    for (const port of ports) {
      const r = await port.deliver(doc);
      expect(r.ok, `port ${port.channel} failed`).toBe(true);
      expect(r.ok && r.value.key).toBe(doc.key);
    }
    // Two channels, two names, one document — which is what "not forge-locked" has to mean.
    expect(new Set(ports.map((p) => p.channel)).size).toBe(2);
  });

  it('leaves this repository untouched: nothing was written outside $TMPDIR', () => {
    // Delivery under test never writes to the repo — the only real filesystem write in this
    // file is the $TMPDIR one above, and the only git this suite runs is `--version`.
    expect(() => execFileSync('git', ['--version'], { stdio: 'ignore' })).not.toThrow();
    const status = execFileSync('git', ['status', '--porcelain', '--', '.gwtp'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(status.trim()).toBe('');
  });
});
