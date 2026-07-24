// Implements: docs/spec/01-core-memory.md §2 (`.program/` layout), §6 (trajectory and scope —
// the obsolescence baseline) and §7 (manifest), plus docs/spec/04-distillation.md §8 (the
// watermark and steady state).
//
// All types are READ-ONLY and nothing here writes: that is the type-level shadow of INV-001,
// "nothing writes to .program/ except human-ratified PRs". No JSON Schema binds manifest.yaml,
// scope.yaml or trajectory.yaml, so these decoders are hand-written and flagged as such —
// see docs/spec/OPEN-QUESTIONS.md Q-08.

import {
  type Assertion,
  type RatifiedAssertion,
  isEnforceable,
  isEnforced,
} from './assertion.js';
import { type CanonicalObject, contentHash } from './canonical.js';
import {
  requireArray,
  requireRecord,
  requireString,
  requireStringArray,
  take,
} from './decode.js';
import { type JudgeId, type PromptHash, type Sha256Ref } from './ids.js';
import type { AssertionId, CommitSha, EpochId, TrajectoryId } from './ids.js';
import {
  parseCommitSha,
  parseEpochId,
  parseJudgeId,
  parsePromptHash,
  parseTrajectoryId,
} from './ids.js';
import { type PathGlob, type RepoPath, matchesGlob, parsePathGlob } from './paths.js';
import type { Precedent } from './precedent.js';
import { type ContractError, collectResults, err, ok, type Decoded, type Parsed } from './result.js';

/** "Last SHA distilled; walks resume from here" (GLOSSARY, spec 04 §8). */
export interface Watermark {
  /** `null` when the program was AUTHORED rather than distilled — this repo's current state. */
  readonly last_walked: CommitSha | null;
  readonly last_epoch: EpochId;
}

/**
 * "Seated judges are part of the program" (spec 01 §7). Changing model id OR prompt hash is
 * seating a new judge: a ratified PR plus a passing bar exam (spec 03 §6).
 */
export interface JudgeSeat {
  readonly id: JudgeId;
  readonly model: string;
  readonly prompt: PromptHash;
}

/** Seating identity. Changing either field changes this hash. */
export function judgeSeatHash(s: JudgeSeat): Parsed<Sha256Ref> {
  return contentHash({ id: s.id, model: s.model, prompt: s.prompt });
}

export interface Manifest {
  readonly schema_version: string;
  readonly watermark: Watermark;
  readonly judges: readonly JudgeSeat[];
}

export function seatedJudge(m: Manifest, id: JudgeId): JudgeSeat | null {
  return m.judges.find((j) => j.id === id) ?? null;
}

/** `scope.yaml` — the obsolescence baseline (spec 01 §6, spec 02 §7). */
export interface ScopeClaim {
  readonly path: PathGlob;
  readonly since: EpochId;
}

/** `trajectory.yaml`. `horizon` is a free-form milestone label (`v0`, `v0.5`, `v1`). */
export interface TrajectoryEntry {
  readonly id: TrajectoryId;
  readonly intent: string;
  readonly horizon: string;
  readonly implies_obsolete: readonly PathGlob[];
}

/**
 * The whole normative store, loaded. One-to-one with the six files in spec 01 §2.
 * `charter` stays raw prose: it is what humans ratify and what LLM judges read for spirit.
 */
export interface Program {
  readonly manifest: Manifest;
  readonly charter: string;
  readonly invariants: readonly Assertion[];
  readonly precedents: readonly Precedent[];
  readonly scope: readonly ScopeClaim[];
  readonly trajectory: readonly TrajectoryEntry[];
}

export function findAssertion(p: Program, id: AssertionId): Assertion | null {
  return p.invariants.find((a) => a.id === id) ?? null;
}

/** The enforcement gate: everything downstream works with statutes, not drafts. */
export function enforcedAssertions(p: Program): readonly Assertion[] {
  return p.invariants.filter(isEnforced);
}

export function ratifiedAssertions(p: Program): readonly RatifiedAssertion[] {
  return p.invariants.filter(isEnforceable);
}

/**
 * Enforced assertions whose scope matches `path`. "One assertion, one diff, one invocation"
 * (spec 03 §1) — this is what produces that fan-out.
 */
export function assertionsGoverning(p: Program, path: RepoPath): readonly Assertion[] {
  return enforcedAssertions(p).filter((a) => a.scope.some((g) => matchesGlob(g, path)));
}

/**
 * Paths in the tree that no scope claim covers — stale-claim candidates for the obsolescence
 * sweep (spec 02 §7). Pure: the tree listing is supplied by the caller.
 */
export function unclaimedPaths(p: Program, tree: readonly RepoPath[]): readonly RepoPath[] {
  return tree.filter((path) => !p.scope.some((claim) => matchesGlob(claim.path, path)));
}

// ---------------------------------------------------------------------------
// Decoders (hand-written: no schema binds these files)
// ---------------------------------------------------------------------------

export function decodeManifest(raw: unknown, at = ''): Decoded<Manifest> {
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const r = rec.value;
  const errors: ContractError[] = [];

  const schemaVersion = take(requireString(r, 'schema_version', at, 1), errors);

  let watermark: Watermark | undefined;
  const wmRec = requireRecord(r['watermark'], `${at}/watermark`);
  if (!wmRec.ok) errors.push(wmRec.error);
  else {
    const lastWalkedRaw = wmRec.value['last_walked'];
    let lastWalked: CommitSha | null = null;
    if (lastWalkedRaw !== null && lastWalkedRaw !== undefined) {
      lastWalked = take(parseCommitSha(lastWalkedRaw, `${at}/watermark/last_walked`), errors) ?? null;
    }
    const lastEpoch = take(parseEpochId(wmRec.value['last_epoch'], `${at}/watermark/last_epoch`), errors);
    if (lastEpoch !== undefined) watermark = { last_walked: lastWalked, last_epoch: lastEpoch };
  }

  const judges: JudgeSeat[] = [];
  const judgesRaw = r['judges'];
  if (judgesRaw !== undefined && judgesRaw !== null) {
    const arr = requireArray(judgesRaw, `${at}/judges`);
    if (!arr.ok) errors.push(arr.error);
    else {
      arr.value.forEach((item, i) => {
        const seatAt = `${at}/judges/${i}`;
        const seatRec = requireRecord(item, seatAt);
        if (!seatRec.ok) {
          errors.push(seatRec.error);
          return;
        }
        const idRaw = take(requireString(seatRec.value, 'id', seatAt), errors);
        const id = idRaw === undefined ? undefined : take(parseJudgeId(idRaw, `${seatAt}/id`), errors);
        const model = take(requireString(seatRec.value, 'model', seatAt, 1), errors);
        const prompt = take(parsePromptHash(seatRec.value['prompt'], `${seatAt}/prompt`), errors);
        if (id !== undefined && model !== undefined && prompt !== undefined) {
          judges.push({ id, model, prompt });
        }
      });
    }
  }

  if (errors.length > 0) return err(errors);
  if (schemaVersion === undefined || watermark === undefined) {
    return err([{ code: 'missing-field', message: 'incomplete manifest', at }]);
  }
  return ok({ schema_version: schemaVersion, watermark, judges });
}

export function encodeManifest(m: Manifest): CanonicalObject {
  return {
    schema_version: m.schema_version,
    watermark: { last_walked: m.watermark.last_walked, last_epoch: m.watermark.last_epoch },
    judges: m.judges.map((j) => ({ id: j.id, model: j.model, prompt: j.prompt })),
  };
}

export function decodeScopeFile(raw: unknown, at = ''): Decoded<readonly ScopeClaim[]> {
  if (raw === null || raw === undefined) return ok([]);
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const claimsRaw = rec.value['claims'];
  if (claimsRaw === null || claimsRaw === undefined) return ok([]);
  const arr = requireArray(claimsRaw, `${at}/claims`);
  if (!arr.ok) return err([arr.error]);

  return collectResults(
    arr.value.map((item, i): Decoded<ScopeClaim> => {
      const claimAt = `${at}/claims/${i}`;
      const claimRec = requireRecord(item, claimAt);
      if (!claimRec.ok) return err([claimRec.error]);
      const errors: ContractError[] = [];
      const path = take(parsePathGlob(claimRec.value['path'], `${claimAt}/path`), errors);
      const since = take(parseEpochId(claimRec.value['since'], `${claimAt}/since`), errors);
      if (errors.length > 0 || path === undefined || since === undefined) return err(errors);
      return ok({ path, since });
    }),
  );
}

export function decodeTrajectoryFile(raw: unknown, at = ''): Decoded<readonly TrajectoryEntry[]> {
  if (raw === null || raw === undefined) return ok([]);
  const arr = requireArray(raw, at);
  if (!arr.ok) return err([arr.error]);

  return collectResults(
    arr.value.map((item, i): Decoded<TrajectoryEntry> => {
      const entryAt = `${at}/${i}`;
      const rec = requireRecord(item, entryAt);
      if (!rec.ok) return err([rec.error]);
      const errors: ContractError[] = [];
      const idRaw = take(requireString(rec.value, 'id', entryAt), errors);
      const id = idRaw === undefined ? undefined : take(parseTrajectoryId(idRaw, `${entryAt}/id`), errors);
      const intent = take(requireString(rec.value, 'intent', entryAt, 1), errors);
      const horizon = take(requireString(rec.value, 'horizon', entryAt), errors);
      const globs: PathGlob[] = [];
      const impliesRaw = rec.value['implies_obsolete'];
      if (impliesRaw !== undefined && impliesRaw !== null) {
        const strings = take(requireStringArray(rec.value, 'implies_obsolete', entryAt), errors);
        strings?.forEach((g, gi) => {
          const parsed = take(parsePathGlob(g, `${entryAt}/implies_obsolete/${gi}`), errors);
          if (parsed !== undefined) globs.push(parsed);
        });
      }
      if (errors.length > 0 || id === undefined || intent === undefined || horizon === undefined) {
        return err(errors.length > 0 ? errors : [{ code: 'missing-field', message: 'incomplete trajectory entry', at: entryAt }]);
      }
      return ok({ id, intent, horizon, implies_obsolete: globs });
    }),
  );
}
