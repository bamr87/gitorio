// Implements: docs/spec/02-ledger.md §5 ("Every proposal ships its evidence: contributing
// events, dispersion stats, compliance ratio, decay-weighted total") and §6 (post-fire
// lifecycle), docs/spec/01-core-memory.md §4.2 (`contested` mutes enforcement),
// docs/vision.md ("the bidirectional hinge"), and docs/adr/0003-judge-blindness.md.
//
// This module turns a `Proposal` — which is accumulator state, i.e. sentencing data — into
// markdown a human reads. Two things follow, and both are structural rather than stylistic.
//
// 1. IT NEEDS A WARRANT. `ProposalEvidence.accumulated` and `ContributingEvent.residualWeight`
//    are `Surprise`, which is not a number; printing one means calling `revealSurprise`, which
//    means holding a `SentencingWarrant`. `renderProposal` takes the warrant from its CALLER
//    rather than minting one, on exactly the principle src/core/dispersion.ts states: a
//    declassification is a call with an extra argument. src/core/sentencing.ts names
//    "proposal rendering (src/adapters/github)" as a sanctioned holder — this is that site,
//    and `grep -rn withSentencingWarrant` finds every place one is issued.
//
// 2. IT NEVER RENDERS AN IDENTITY, AND CANNOT. Dispersion ships ENTROPY, not names — spec 02
//    §5 asks "how many independent hands", never "whose". The enforcement is the input type:
//    `ProposalRenderInput` has no slot for an `EvidenceLocus`, this file imports neither
//    `EvidenceLocus` nor `ActorId` nor `revealActor`, and `DispersionStats` (the only thing
//    here derived from authorship) is four aggregates by the time `computeDispersion` is done
//    with it. An `ActorId` is not assignable to `string`, so there is no field in this
//    module's world it could occupy even if one were handed over.
//
// Residual hole, stated rather than assumed away: `Assertion.statement` and a repo path are
// free text this module copies verbatim, and no type can see inside a string. Same shape of
// limitation as docs/spec/OPEN-QUESTIONS.md Q-09.

import type { ContributingEvent, FoldKnobs } from '../../core/accumulator.js';
import { knobsDigest } from '../../core/accumulator.js';
import type { Assertion } from '../../core/assertion.js';
import type { DeliveryDocument, DeliveryPatch } from '../../core/delivery.js';
import { deliveryKey, deliveryMarker } from '../../core/delivery.js';
import type { DispersionStats, EntropyStat } from '../../core/dispersion.js';
import type { AccumulatorKey, EventId } from '../../core/ids.js';
import { sha256RefHex } from '../../core/ids.js';
import type { Proposal, ProposalKind } from '../../core/proposal.js';
import { fail, ok, type Parsed } from '../../core/result.js';
import { revealSurprise, type SentencingWarrant } from '../../core/sentencing.js';
import { MILLIS_PER_DAY, committerTimeMillis } from '../../core/time.js';
import type { CommitterTime } from '../../core/time.js';
import type { AmendmentPatch } from './amendment.js';
import { PROGRAM_DIR, applyInstructions } from './amendment.js';

/**
 * A firing can contribute hundreds of events over a 365d half-life, and a forge that truncates
 * an issue body silently loses the evidence half of "every proposal ships its evidence". The
 * table is capped and the omission is STATED; the full set is always recoverable by replay,
 * which is why the replay command is mandatory in the body rather than a nicety.
 */
export const MAX_RENDERED_EVENTS = 50;

export const LABEL_ROOT = 'gwtp-proposal';

export interface ProposalRenderInput {
  readonly proposal: Proposal;
  /**
   * `null` when the accumulator key is a scope claim rather than an assertion id — obsolescence
   * sweeps accumulate against claims (spec 02 §7, OPEN-QUESTIONS Q-04), and a claim has no
   * statement to quote.
   */
  readonly assertion: Assertion | null;
  /** The `.program/` patch, for `reprogram`. `null` is legal and rendered as such. */
  readonly amendment: AmendmentPatch | null;
  /** Appended to the two labels every proposal carries. */
  readonly labels?: readonly string[];
}

// ---------------------------------------------------------------------------
// Formatting primitives
// ---------------------------------------------------------------------------

/** Fixed precision everywhere, so two renders of one firing are byte-identical. */
export function num(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

/** Knob values keep their natural spelling (`3`, `0.9`), because that is how they read in YAML. */
export function knob(n: number): string {
  return Number.isFinite(n) ? String(n) : 'n/a';
}

export function pct(n: number | null, digits = 1): string {
  return n === null ? 'n/a' : `${(n * 100).toFixed(digits)}%`;
}

/** `151d 4h`, `3h 12m`, `0m`. Human-scaled, and never a bare millisecond count. */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const days = Math.floor(ms / MILLIS_PER_DAY);
  const hours = Math.floor((ms % MILLIS_PER_DAY) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** First 12 hex, the git-shaped abbreviation. The full id always appears somewhere too. */
export function shortEvent(id: EventId): string {
  return sha256RefHex(id).slice(0, 12);
}

function entropyCell(e: EntropyStat, unit: string): string {
  return `${num(e.normalized)} normalized (${num(e.bits)} bits over ${e.distinct} distinct ${unit})`;
}

const SHELL_SAFE = /^[A-Za-z0-9._/@:-]+$/;

function shellArg(v: string): string {
  return SHELL_SAFE.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command that reproduces this firing from the event set alone (spec 02 §1 property 3:
 * "Retune a half_life or precision retroactively and recompute").
 *
 * The flag SPELLING is not fixed by any spec — SEED-02 deliverable 4 names only
 * `gwtp ledger append|fold|replay|status`. It is built here, in one function, precisely so
 * that when the CLI settles there is a single line to change. See OPEN-QUESTIONS Q-51.
 */
export function replayCommand(key: AccumulatorKey, knobs: FoldKnobs): string {
  // Flags must match REPLAY_OPTIONS in src/cli/commands/ledger.ts exactly, or the bundle ships a
  // command the CLI rejects. The scope of `replay` is spec 02 §1.3's "retune a half_life or
  // precision retroactively and recompute": `--key` selects the accumulator, `--half-life` /
  // `--budget` / `--precision` are the retunable knobs. `rearmFraction` is NOT a replay knob —
  // it governs post-fire hysteresis, not the accumulated value — so it is deliberately absent.
  const parts = [
    'gwtp ledger replay',
    `--key ${shellArg(key)}`,
    `--half-life ${shellArg(knobs.halfLife.source)}`,
    `--budget ${knob(knobs.budget)}`,
  ];
  if (knobs.precisionOverride !== null) {
    parts.push(`--precision ${knob(knobs.precisionOverride)}`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * The meter, made legible. THE declassification site: `revealSurprise` twice, both under the
 * caller's warrant.
 */
export function renderMeter(
  accumulated: number,
  budget: number,
  firedAt: CommitterTime,
  triggeredBy: EventId,
): string {
  const over = accumulated - budget;
  return [
    '## The meter',
    '',
    '| | |',
    '|---|---|',
    `| decay-weighted total at firing | **${num(accumulated)}** |`,
    `| budget | ${num(budget)} |`,
    `| over budget by | ${over >= 0 ? '+' : ''}${num(over)} (${pct(budget > 0 ? accumulated / budget : null)} of budget) |`,
    `| fired at (committer time) | \`${firedAt}\` |`,
    `| triggering event | \`${triggeredBy}\` |`,
    '',
    'Accumulation is `A ← A · 2^(−Δt / half_life) + precision_at · severity` over violating',
    'events only (spec 02 §4). Aligned events are **counted and subtract nothing** — decay is',
    'the only forgiveness — and `abstain` never accumulates at all.',
  ].join('\n');
}

export function renderContributing(
  contributing: readonly ContributingEvent[],
  residual: ReadonlyMap<EventId, number>,
): string {
  const sorted = [...contributing].sort(
    (a, b) =>
      committerTimeMillis(a.t) - committerTimeMillis(b.t) ||
      (a.event < b.event ? -1 : a.event > b.event ? 1 : 0),
  );
  const shown = sorted.slice(0, MAX_RENDERED_EVENTS);
  const lines: string[] = [
    '## Contributing events',
    '',
    `${contributing.length} violating event(s) carry live weight at the firing instant.`,
    'Committer time, not observation time (ADR-0004): a backfilled breach arrives pre-decayed.',
    '',
    '| event | committer time | verdict | `precision_at · severity` | residual weight |',
    '|---|---|---|---|---|',
  ];
  for (const c of shown) {
    lines.push(
      `| \`${shortEvent(c.event)}\` | \`${c.t}\` | ${c.verdict} | ${num(c.rawWeight)} | ${num(
        residual.get(c.event) ?? 0,
      )} |`,
    );
  }
  if (sorted.length > shown.length) {
    lines.push('');
    lines.push(
      `_…and ${sorted.length - shown.length} further event(s), omitted to keep this readable._`,
    );
    lines.push('_Nothing is lost: the replay command below recomputes the full set._');
  }
  return lines.join('\n');
}

/**
 * spec 02 §5's four statistics, and NOT the identities they were computed from. "How many
 * independent hands" is a cardinality; whose hands is nobody's business here (ADR-0003).
 */
export function renderDispersion(stats: DispersionStats, violationCount: number, complianceCount: number): string {
  return [
    '## Dispersion (spec 02 §5)',
    '',
    '| statistic | value | reads as |',
    '|---|---|---|',
    `| author entropy | ${entropyCell(stats.authorEntropy, 'hands')} | how many independent hands |`,
    `| path entropy | ${entropyCell(stats.pathEntropy, 'paths')} | one seam or many call sites |`,
    `| time spread | ${formatSpan(stats.timeSpread.spanMs)} (\`${stats.timeSpread.firstAt}\` → \`${stats.timeSpread.lastAt}\`) | a tight burst or sustained pressure |`,
    `| weighted std. dev. | ${formatSpan(stats.timeSpread.weightedStdDevMs)} | sustained pressure vs one burst plus a straggler |`,
    `| compliance ratio | ${pct(stats.complianceRatio)} (${complianceCount} aligned / ${complianceCount + violationCount} observed) | evidence quality (Q-19) |`,
    `| weighting | \`${stats.weighting}\` | how each event was weighted (Q-18) |`,
    '',
    '**These are counts and entropies. No contributor is named here, and none can be:**',
    'authorship is resolved at firing time, aggregated, and discarded (ADR-0003 — "authorship',
    'is used only downstream, in dispersion statistics at firing time"). The persisted ledger',
    'event carries no author field at all.',
  ].join('\n');
}

export function renderKnobs(knobs: FoldKnobs, digest: string, key: AccumulatorKey): string {
  return [
    '## Knobs used',
    '',
    '| knob | value |',
    '|---|---|',
    `| \`half_life\` | \`${knobs.halfLife.source}\` |`,
    `| \`budget\` | \`${knob(knobs.budget)}\` |`,
    `| \`precision\` override | ${
      knobs.precisionOverride === null
        ? "none — each event's frozen `precision_at` was used (spec 02 §2)"
        : `\`${knob(knobs.precisionOverride)}\` (counterfactual replay)`
    } |`,
    `| re-arm fraction | \`${knob(knobs.rearmFraction)}\` — spec 02 §6 "below ~50% of budget" (Q-14) |`,
    `| knobs digest | \`${digest}\` |`,
    '',
    '## Replay',
    '',
    'Accumulators are derived, never authoritative (ADR-0002). This firing is reproducible from',
    'the event set alone, and a counterfactual is one flag away:',
    '',
    '```bash',
    replayCommand(key, knobs),
    '```',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The two arguments
// ---------------------------------------------------------------------------

function renderRefactorArgument(stats: DispersionStats, key: AccumulatorKey): string {
  const shape =
    `**concentrated** — ${stats.authorEntropy.distinct} independent hand(s), ` +
    `${stats.pathEntropy.distinct} distinct path(s), over ${formatSpan(stats.timeSpread.spanMs)}`;
  return [
    '> **The assertion stands. The change is wrong.**',
    '',
    `Accumulated surprise against \`${key}\` crossed its budget, and the contributing evidence is ${shape}.`,
    'Per spec 02 §5 that pattern attributes the drift to the **code**, not to the law: one',
    'contributor repeatedly hitting one seam is a refactor, not a referendum.',
    '',
    `**This proposal does not question \`${key}\`.** The assertion keeps its current status,`,
    `enforcement continues, and **nothing under \`${PROGRAM_DIR}\` changes**. What is proposed is a`,
    'change to the code that keeps tripping it.',
    '',
    'If you think the statistics are wrong — that this really is many hands over months and the',
    'law is the thing at fault — say so on this issue rather than silencing the assertion. A',
    'proposal rejected under fire writes an `affirmed` precedent and *raises* precision (spec 02',
    '§6), so arguing with it is a supported move, and an ignored proposal accrues **governance',
    'debt** on its own meter rather than quietly going away.',
  ].join('\n');
}

function renderReprogramArgument(
  stats: DispersionStats,
  key: AccumulatorKey,
  hasAmendment: boolean,
): string {
  return [
    '> **The law is wrong.**',
    '',
    `This is not a report that \`${key}\` was violated. It is an argument that \`${key}\` should`,
    'not say what it says.',
    '',
    `The evidence is **dispersed** — ${stats.authorEntropy.distinct} independent hands (${num(stats.authorEntropy.normalized)} normalized author entropy), ${stats.pathEntropy.distinct} distinct paths (${num(stats.pathEntropy.normalized)}), sustained over ${formatSpan(stats.timeSpread.spanMs)}.`,
    'That is the signature spec 02 §5 assigns to the **law** rather than to the code. One person',
    'drifting is a mistake; many people independently walking through the same wall for months is',
    'the organisation having already outvoted the statute in practice (docs/vision.md, "the',
    'bidirectional hinge"). Continuing to cite them is a system that can only enforce intent — a',
    'nag, not a governor.',
    '',
    '### What opening this changes immediately',
    '',
    `Per docs/spec/01-core-memory.md §4.2, an assertion with a reprogramming PR open against it`,
    `goes **\`status: contested\`**, and **enforcement mutes** while it is contested: GWTP stops`,
    `citing violations of \`${key}\` until a human ratifies or rejects the amendment. You do not`,
    'keep citing someone for a law under active renegotiation. `contested` is not a verdict on',
    'the law — it is a pause on enforcing it while the argument is had.',
    '',
    'The accumulator is **not** reset. Hysteresis, not reset (spec 02 §6): it re-arms only after',
    'decaying below the re-arm fraction of budget, so nothing flaps and this proposal cannot',
    'refile itself in a loop.',
    '',
    '### What happens next is a human decision',
    '',
    '- **Accepted** → the amendment lands in `.program/`, the assertion goes `amended`, the',
    '  accumulator zeroes.',
    '- **Rejected** → an `affirmed` precedent is written and the assertion’s `precision` *rises*.',
    '  A law ratified under fire is a stronger prior, and the next breach costs more.',
    '- **Ignored until stale** → recorded as **governance debt**, which accumulates on its own',
    '  meter. Silence is also an answer, and it is also evidence.',
    '',
    hasAmendment
      ? '`INV-001` forbids a machine write to `.program/`, so the amendment below is a **patch**, not a commit.'
      : '_No `.program/` patch could be generated for this firing — the accumulator key has no matching assertion entry (spec 02 §7 keys obsolescence sweeps by scope claim; see Q-04). The change has to be drafted by hand._',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function proposalTitle(kind: ProposalKind, key: AccumulatorKey): string {
  return kind === 'reprogram'
    ? `[GWTP] Reprogramming proposal — is ${key} still the right law?`
    : `[GWTP] Refactoring recommendation — ${key} crossed its surprise budget`;
}

export function proposalLabels(kind: ProposalKind, extra: readonly string[] = []): readonly string[] {
  const base = [LABEL_ROOT, `gwtp:${kind}`];
  const seen = new Set(base);
  for (const l of extra) {
    if (!seen.has(l)) {
      seen.add(l);
      base.push(l);
    }
  }
  return base;
}

/**
 * The whole evidence bundle a proposal ships (spec 02 §5), as one self-contained markdown
 * document. Takes the `SentencingWarrant` from its caller — see the module header.
 */
export function renderProposal(
  input: ProposalRenderInput,
  warrant: SentencingWarrant,
): Parsed<DeliveryDocument> {
  const { proposal, assertion, amendment } = input;
  const { evidence } = proposal;

  if (assertion !== null && assertion.id !== proposal.key) {
    return fail(
      'invalid-id',
      `assertion ${assertion.id} does not match the firing's accumulator key ${proposal.key}`,
    );
  }
  if (amendment !== null && !amendment.path.startsWith(PROGRAM_DIR)) {
    return fail(
      'invalid-path',
      `a reprogramming amendment targets ${PROGRAM_DIR}, got ${JSON.stringify(amendment.path)}`,
    );
  }

  const digest = knobsDigest(evidence.knobs);
  if (!digest.ok) return digest;

  // ── The two declassifications, both under the caller's warrant ──────────────────────────
  const accumulated = revealSurprise(evidence.accumulated, warrant);
  const residual = new Map<EventId, number>(
    evidence.contributing.map((c) => [c.event, revealSurprise(c.residualWeight, warrant)]),
  );

  const key = proposal.key;
  const kind = proposal.kind;
  const title = proposalTitle(kind, key);

  const head: string[] = [`# ${title.replace(/^\[GWTP\] /, '')}`, ''];
  head.push(
    kind === 'reprogram'
      ? renderReprogramArgument(evidence.dispersion, key, amendment !== null)
      : renderRefactorArgument(evidence.dispersion, key),
  );
  head.push('');
  head.push('## The assertion');
  head.push('');
  if (assertion === null) {
    head.push(
      `\`${key}\` is an accumulator key with no assertion record — an obsolescence sweep keyed by`,
    );
    head.push('scope claim (spec 02 §7). There is no statement to quote.');
  } else {
    head.push(`**\`${assertion.id}\`** — ${assertion.class} · \`status: ${assertion.status}\``);
    head.push('');
    head.push(`> ${assertion.statement}`);
    head.push('');
    head.push(`Scope: ${assertion.scope.map((g) => `\`${g}\``).join(', ')}`);
    head.push('');
    head.push(`Provenance: ${assertion.provenance.map((p) => `\`${p}\``).join(', ')}`);
  }

  const sections: string[] = [
    head.join('\n'),
    renderMeter(accumulated, evidence.budget, proposal.firedAt, proposal.triggeredBy),
    renderContributing(evidence.contributing, residual),
    renderDispersion(evidence.dispersion, evidence.violationCount, evidence.complianceCount),
    renderKnobs(evidence.knobs, digest.value, key),
  ];

  const patches: DeliveryPatch[] = [];
  if (kind === 'reprogram' && amendment !== null) {
    patches.push({ path: amendment.path, diff: amendment.diff });
    sections.push(
      [
        `## The amendment — \`${amendment.path}\``,
        '',
        amendment.rationale,
        '',
        '```diff',
        amendment.diff.replace(/\n$/, ''),
        '```',
        '',
        applyInstructions(),
      ].join('\n'),
    );
  }

  sections.push(
    [
      '---',
      '',
      '_Filed by GWTP. Accumulators are derived and never authoritative (ADR-0002); this issue is',
      'a rendering of a fold over `refs/program/ledger`, reproducible with the command above._',
      '',
      deliveryMarker(deliveryKey(key, proposal.triggeredBy)),
    ].join('\n'),
  );

  return ok({
    key: deliveryKey(key, proposal.triggeredBy),
    kind,
    title,
    body: sections.join('\n\n'),
    labels: proposalLabels(kind, input.labels ?? []),
    patches,
  });
}
