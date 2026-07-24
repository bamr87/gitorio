// Implements: docs/spec/01-core-memory.md §3 (stable ids), §4 (the two non-negotiable field
// rules), §5 (precedents), §6 (trajectory and scope — the obsolescence baseline) and §7
// (manifest), in service of INV-006 ("All program and ledger artifacts validate against
// schemas/ in CI").
//
// Two jobs a JSON Schema cannot do, kept here rather than in the CLI so they stay pure and
// unit-testable:
//
//   1. CROSS-ENTRY RULES. draft-07 validates one document at a time, so "assertion ids are
//      unique within the file" is unexpressible in schemas/assertion.schema.json. Provenance
//      and the CAND-* status rule ARE in the schema, but ajv reports them as
//      `must have required property 'provenance'` and `must be equal to constant`; spec 01 §4
//      and spec 04 §4 deserve to be quoted at the human reading the failure.
//   2. STRUCTURAL VALIDATION for the three `.program/` files no schema binds — manifest.yaml,
//      scope.yaml, trajectory.yaml (docs/spec/OPEN-QUESTIONS.md Q-08). The hand-written
//      decoders in ./program.js parse the fields; this module adds the shape rules they are
//      deliberately lenient about (a required key that is merely absent, an unknown key that
//      is a silent typo) and merges both error streams.
//
// Pure and dependency-free by construction: ajv, the filesystem and YAML all live in
// src/cli/commands/validate.ts. Nothing here reads a file or knows a forge (INV-005).
// Consumed by deep import from the CLI; ./index.js is prior work and is left untouched.

import { isRecord, rejectUnknownKeys } from './decode.js';
import { decodeInvariantsFile } from './assertion.js';
import { decodePrecedentsFile } from './precedent.js';
import { decodeManifest, decodeScopeFile, decodeTrajectoryFile } from './program.js';
import { contractError, type ContractError, type ContractErrorCode } from './result.js';

/** Where each cross-entry rule is written down, quoted verbatim into the failure message. */
export const SPEC_RULE = {
  uniqueAssertionIds: 'spec 01 §3',
  provenance: 'spec 01 §4 rule 1',
  candidateStatus: 'spec 04 §4',
  uniquePrecedentIds: 'spec 01 §5',
  manifest: 'spec 01 §7',
  scope: 'spec 01 §6',
  trajectory: 'spec 01 §6',
} as const;

const ASSERTION_SCHEMA = 'gwtp/assertion.schema.json';

/** Keys spec 01 §7 gives manifest.yaml. */
export const MANIFEST_KEYS = ['schema_version', 'watermark', 'judges'] as const;
export const WATERMARK_KEYS = ['last_walked', 'last_epoch'] as const;
export const JUDGE_SEAT_KEYS = ['id', 'model', 'prompt'] as const;
/** Keys spec 01 §6 gives a scope.yaml claim. */
export const SCOPE_FILE_KEYS = ['claims'] as const;
export const SCOPE_CLAIM_KEYS = ['path', 'since'] as const;
/** Keys spec 01 §6 gives a trajectory.yaml entry. */
export const TRAJECTORY_ENTRY_KEYS = ['id', 'intent', 'horizon', 'implies_obsolete'] as const;

function push(
  errors: ContractError[],
  code: ContractErrorCode,
  message: string,
  at: string,
  clause?: string,
): void {
  errors.push(contractError(code, message, at, clause));
}

function show(v: unknown): string {
  if (v === undefined) return 'absent';
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Merges error streams and drops exact duplicates. The structural pass and the decoder
 * overlap on purpose — each is allowed to be complete on its own — so the union is deduped
 * on `code|at|message` rather than either side being trimmed to fit the other.
 */
export function mergeErrors(...streams: readonly (readonly ContractError[])[]): readonly ContractError[] {
  const seen = new Set<string>();
  const out: ContractError[] = [];
  for (const stream of streams) {
    for (const e of stream) {
      const key = `${e.code}|${e.at ?? ''}|${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

/**
 * The two streams kept APART rather than concatenated, because a reporter must treat them
 * differently:
 *
 *   `rules`   — spec rules quoted at the reader ("no assertion without provenance",
 *               spec 01 §4 rule 1). These are the reason this module exists and are always
 *               worth printing, even beside a JSON Schema error on the same field, because
 *               ajv's rendering of the same fact is `must have required property`.
 *   `decoder` — whether src/core can actually read the document. Mostly redundant with the
 *               schema pass, and safe for a reporter to suppress where the two agree.
 */
export interface DocumentFindings {
  readonly rules: readonly ContractError[];
  readonly decoder: readonly ContractError[];
}

export function allFindings(f: DocumentFindings): readonly ContractError[] {
  return mergeErrors(f.rules, f.decoder);
}

// ---------------------------------------------------------------------------
// Cross-entry rules (what one document's schema cannot see)
// ---------------------------------------------------------------------------

/**
 * Runs over RAW entries, not decoded ones: an entry that fails the schema on one field must
 * still be checked for a duplicate id, or a malformed file would hide a collision behind an
 * unrelated failure.
 */
export function crossFileAssertionErrors(
  entries: readonly unknown[],
  at = '',
): readonly ContractError[] {
  const errors: ContractError[] = [];
  const firstSeen = new Map<string, number>();

  entries.forEach((entry, i) => {
    const itemAt = `${at}/${i}`;
    if (!isRecord(entry)) return; // shape failures belong to the decoder and to ajv

    const id = entry['id'];
    const label = typeof id === 'string' ? `\`${id}\`` : `entry ${i}`;

    if (typeof id === 'string') {
      const prior = firstSeen.get(id);
      if (prior === undefined) firstSeen.set(id, i);
      else {
        push(
          errors,
          'invalid-id',
          `duplicate assertion id \`${id}\`, first seen at ${at}/${prior}; ` +
            `ids must be unique within the file (${SPEC_RULE.uniqueAssertionIds}) — ` +
            'surprise accumulates against a specific claim',
          `${itemAt}/id`,
        );
      }
    }

    // "No assertion without provenance. An assertion without provenance is unreviewable and
    // therefore unratifiable." (spec 01 §4 rule 1)
    const provenance = entry['provenance'];
    if (provenance === undefined || provenance === null) {
      push(
        errors,
        'missing-field',
        `assertion ${label} has no provenance — no assertion without provenance ` +
          `(${SPEC_RULE.provenance})`,
        `${itemAt}/provenance`,
        `${ASSERTION_SCHEMA}#/properties/provenance`,
      );
    } else if (!Array.isArray(provenance)) {
      push(
        errors,
        'wrong-type',
        `assertion ${label} provenance must be a sequence of citations (${SPEC_RULE.provenance})`,
        `${itemAt}/provenance`,
        `${ASSERTION_SCHEMA}#/properties/provenance`,
      );
    } else if (provenance.length === 0) {
      push(
        errors,
        'missing-field',
        `assertion ${label} has empty provenance — no assertion without provenance ` +
          `(${SPEC_RULE.provenance})`,
        `${itemAt}/provenance`,
        `${ASSERTION_SCHEMA}#/properties/provenance`,
      );
    } else {
      provenance.forEach((ref, j) => {
        if (typeof ref !== 'string' || ref.trim().length === 0) {
          push(
            errors,
            'wrong-type',
            `provenance entries must be non-empty citations (${SPEC_RULE.provenance}), got ${show(ref)}`,
            `${itemAt}/provenance/${j}`,
          );
        }
      });
    }

    // "Distillation may only emit `inferred`" (spec 04 §4) — schema allOf/0.
    if (typeof id === 'string' && id.startsWith('CAND-')) {
      const status = entry['status'];
      if (status !== 'inferred') {
        push(
          errors,
          'invalid-enum',
          `CAND-* ids may only carry \`status: inferred\` (${SPEC_RULE.candidateStatus}); ` +
            `got ${show(status)} — a candidate cannot self-ratify`,
          `${itemAt}/status`,
          `${ASSERTION_SCHEMA}#/allOf/0`,
        );
      }
    }
  });

  return errors;
}

export function crossFilePrecedentErrors(
  entries: readonly unknown[],
  at = '',
): readonly ContractError[] {
  const errors: ContractError[] = [];
  const firstSeen = new Map<string, number>();

  entries.forEach((entry, i) => {
    if (!isRecord(entry)) return;
    const id = entry['id'];
    if (typeof id !== 'string') return;
    const prior = firstSeen.get(id);
    if (prior === undefined) firstSeen.set(id, i);
    else {
      push(
        errors,
        'invalid-id',
        `duplicate precedent id \`${id}\`, first seen at ${at}/${prior}; ` +
          `case law is cited by id (${SPEC_RULE.uniquePrecedentIds})`,
        `${at}/${i}/id`,
      );
    }
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Structural validation for the three unschema'd files (Q-08)
// ---------------------------------------------------------------------------

/** spec 01 §7: `schema_version`, `watermark {last_walked, last_epoch}`, `judges`. */
export function structuralManifestErrors(raw: unknown, at = ''): readonly ContractError[] {
  const errors: ContractError[] = [];
  if (!isRecord(raw)) {
    push(errors, 'wrong-type', `manifest.yaml must be a mapping (${SPEC_RULE.manifest})`, at);
    return errors;
  }
  rejectUnknownKeys(raw, MANIFEST_KEYS, at, errors);

  if (raw['schema_version'] === undefined || raw['schema_version'] === null) {
    push(
      errors,
      'missing-field',
      `\`schema_version\` is required (${SPEC_RULE.manifest})`,
      `${at}/schema_version`,
    );
  }

  const watermark = raw['watermark'];
  if (watermark === undefined || watermark === null) {
    push(
      errors,
      'missing-field',
      `\`watermark\` is required — distillation resumes from it (${SPEC_RULE.manifest})`,
      `${at}/watermark`,
    );
  } else if (!isRecord(watermark)) {
    push(
      errors,
      'wrong-type',
      `\`watermark\` must be a mapping of {last_walked, last_epoch} (${SPEC_RULE.manifest})`,
      `${at}/watermark`,
    );
  } else {
    rejectUnknownKeys(watermark, WATERMARK_KEYS, `${at}/watermark`, errors);
    // `Object.hasOwn`, not `in`: own keys only, for the reason spelled out on requireField().
    if (!Object.hasOwn(watermark, 'last_walked')) {
      push(
        errors,
        'missing-field',
        '`watermark.last_walked` is required; `null` records a program that was authored ' +
          'rather than distilled',
        `${at}/watermark/last_walked`,
      );
    }
    if (watermark['last_epoch'] === undefined || watermark['last_epoch'] === null) {
      push(
        errors,
        'missing-field',
        `\`watermark.last_epoch\` is required (${SPEC_RULE.manifest})`,
        `${at}/watermark/last_epoch`,
      );
    }
  }

  const judges = raw['judges'];
  if (judges === undefined) {
    push(
      errors,
      'missing-field',
      '`judges` is required; an empty sequence records that no judge is seated ' +
        `(${SPEC_RULE.manifest})`,
      `${at}/judges`,
    );
  } else if (judges !== null && !Array.isArray(judges)) {
    push(
      errors,
      'wrong-type',
      `\`judges\` must be a sequence of seats (${SPEC_RULE.manifest})`,
      `${at}/judges`,
    );
  } else if (Array.isArray(judges)) {
    const seen = new Map<string, number>();
    judges.forEach((seat, i) => {
      const seatAt = `${at}/judges/${i}`;
      if (!isRecord(seat)) return;
      rejectUnknownKeys(seat, JUDGE_SEAT_KEYS, seatAt, errors);
      for (const key of JUDGE_SEAT_KEYS) {
        if (seat[key] === undefined || seat[key] === null) {
          push(
            errors,
            'missing-field',
            `judge seat requires \`${key}\` — seating identity is {id, model, prompt} ` +
              `(${SPEC_RULE.manifest})`,
            `${seatAt}/${key}`,
          );
        }
      }
      const id = seat['id'];
      if (typeof id !== 'string') return;
      const prior = seen.get(id);
      if (prior === undefined) seen.set(id, i);
      else {
        push(
          errors,
          'invalid-id',
          `duplicate judge seat \`${id}\`, first seen at ${at}/judges/${prior}`,
          `${seatAt}/id`,
        );
      }
    });
  }

  return errors;
}

/** spec 01 §6: "`scope.yaml` declares which paths the program currently claims and supports." */
export function structuralScopeErrors(raw: unknown, at = ''): readonly ContractError[] {
  const errors: ContractError[] = [];
  if (!isRecord(raw)) {
    push(
      errors,
      'wrong-type',
      `scope.yaml must be a mapping carrying a \`claims\` sequence (${SPEC_RULE.scope})`,
      at,
    );
    return errors;
  }
  rejectUnknownKeys(raw, SCOPE_FILE_KEYS, at, errors);

  const claims = raw['claims'];
  if (claims === undefined) {
    // decodeScopeFile treats an absent `claims` as an empty program claim set, which makes a
    // misspelt key a silent forfeiture of the obsolescence baseline. Require it explicitly.
    push(
      errors,
      'missing-field',
      `\`claims\` is required — it is the obsolescence baseline (${SPEC_RULE.scope})`,
      `${at}/claims`,
    );
    return errors;
  }
  if (claims === null) return errors;
  if (!Array.isArray(claims)) {
    push(
      errors,
      'wrong-type',
      `\`claims\` must be a sequence of {path, since} entries (${SPEC_RULE.scope})`,
      `${at}/claims`,
    );
    return errors;
  }

  const seen = new Map<string, number>();
  claims.forEach((claim, i) => {
    const claimAt = `${at}/claims/${i}`;
    if (!isRecord(claim)) {
      push(errors, 'wrong-type', `scope claim must be a mapping (${SPEC_RULE.scope})`, claimAt);
      return;
    }
    rejectUnknownKeys(claim, SCOPE_CLAIM_KEYS, claimAt, errors);
    for (const key of SCOPE_CLAIM_KEYS) {
      if (claim[key] === undefined || claim[key] === null) {
        push(
          errors,
          'missing-field',
          `scope claim requires \`${key}\` (${SPEC_RULE.scope})`,
          `${claimAt}/${key}`,
        );
      }
    }
    const p = claim['path'];
    if (typeof p !== 'string') return;
    const prior = seen.get(p);
    if (prior === undefined) seen.set(p, i);
    else {
      push(
        errors,
        'strictness',
        `duplicate scope claim \`${p}\`, first seen at ${at}/claims/${prior}; ` +
          'a claim is claimed once, with one `since` epoch',
        `${claimAt}/path`,
      );
    }
  });

  return errors;
}

/**
 * spec 01 §6: "`trajectory.yaml` entries carry directional intent plus
 * `implies_obsolete: [paths]` and optional deprecation horizons."
 */
export function structuralTrajectoryErrors(raw: unknown, at = ''): readonly ContractError[] {
  const errors: ContractError[] = [];
  if (raw === null || raw === undefined) return errors; // an empty trajectory is legal
  if (!Array.isArray(raw)) {
    push(
      errors,
      'wrong-type',
      `trajectory.yaml must be a sequence of directional intents (${SPEC_RULE.trajectory})`,
      at,
    );
    return errors;
  }

  const seen = new Map<string, number>();
  raw.forEach((entry, i) => {
    const entryAt = `${at}/${i}`;
    if (!isRecord(entry)) {
      push(
        errors,
        'wrong-type',
        `trajectory entry must be a mapping (${SPEC_RULE.trajectory})`,
        entryAt,
      );
      return;
    }
    rejectUnknownKeys(entry, TRAJECTORY_ENTRY_KEYS, entryAt, errors);
    for (const key of ['id', 'intent', 'horizon'] as const) {
      if (entry[key] === undefined || entry[key] === null) {
        push(
          errors,
          'missing-field',
          `trajectory entry requires \`${key}\` (${SPEC_RULE.trajectory})`,
          `${entryAt}/${key}`,
        );
      }
    }
    const implies = entry['implies_obsolete'];
    if (implies !== undefined && implies !== null && !Array.isArray(implies)) {
      push(
        errors,
        'wrong-type',
        '`implies_obsolete` must be a sequence of path globs whose only support expires ' +
          `when the intent completes (${SPEC_RULE.trajectory})`,
        `${entryAt}/implies_obsolete`,
      );
    }
    const id = entry['id'];
    if (typeof id !== 'string') return;
    const prior = seen.get(id);
    if (prior === undefined) seen.set(id, i);
    else {
      push(
        errors,
        'invalid-id',
        `duplicate trajectory id \`${id}\`, first seen at ${at}/${prior}`,
        `${entryAt}/id`,
      );
    }
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Document-level entry points: structural rules + the engine decoder, merged
// ---------------------------------------------------------------------------

export function validateInvariantsDocument(raw: unknown, at = ''): DocumentFindings {
  if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
    return {
      rules: [
        contractError(
          'wrong-type',
          `invariants.yaml must be a sequence of assertions (${SPEC_RULE.uniqueAssertionIds})`,
          at,
        ),
      ],
      decoder: [],
    };
  }
  const entries: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const decoded = decodeInvariantsFile(raw, at);
  return { rules: crossFileAssertionErrors(entries, at), decoder: decoded.ok ? [] : decoded.error };
}

export function validatePrecedentsDocument(raw: unknown, at = ''): DocumentFindings {
  if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
    return {
      rules: [
        contractError(
          'wrong-type',
          `precedents.yaml must be a sequence of settled cases (${SPEC_RULE.uniquePrecedentIds})`,
          at,
        ),
      ],
      decoder: [],
    };
  }
  const entries: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const decoded = decodePrecedentsFile(raw, at);
  return { rules: crossFilePrecedentErrors(entries, at), decoder: decoded.ok ? [] : decoded.error };
}

export function validateManifestDocument(raw: unknown, at = ''): DocumentFindings {
  const decoded = decodeManifest(raw, at);
  return { rules: structuralManifestErrors(raw, at), decoder: decoded.ok ? [] : decoded.error };
}

export function validateScopeDocument(raw: unknown, at = ''): DocumentFindings {
  const decoded = decodeScopeFile(raw, at);
  return { rules: structuralScopeErrors(raw, at), decoder: decoded.ok ? [] : decoded.error };
}

export function validateTrajectoryDocument(raw: unknown, at = ''): DocumentFindings {
  const decoded = decodeTrajectoryFile(raw, at);
  return { rules: structuralTrajectoryErrors(raw, at), decoder: decoded.ok ? [] : decoded.error };
}
