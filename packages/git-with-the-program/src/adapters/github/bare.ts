// Implements: docs/vision.md non-goals — "**Not forge-locked.** Git is the substrate. GitHub
// PR/issue metadata enriches distillation and delivery through an adapter; **a bare repo
// degrades gracefully to commits-only**" — and docs/spec/02-ledger.md §5 (a proposal ships its
// evidence, whatever the channel).
//
// THE DEGRADATION PATH, and the reason `DeliveryPort` lives in src/core rather than here.
//
// "Degrades gracefully" is easy to write into a vision document and easy to never implement,
// at which point the engine is forge-locked in fact while claiming not to be in prose. This
// module is the proof it is not: the same `DeliveryDocument`, rendered once, written to a file
// and logged. No token, no network, no `gh`, no forge account. `git init`, `gwtp ledger fold`,
// and a proposal lands on disk.
//
// Deliberately in the same directory as the GitHub adapter rather than in src/core: a file
// sink is still an ADAPTER, and putting it in core would make core know about filesystems the
// way INV-005 says it must not know about forges. The name of this directory is a historical
// accident of where adapters live, not a claim that this one talks to GitHub.
//
// It is also the sink of last resort for a delivery that must not be lost: if the forge is
// unreachable, writing the evidence bundle to disk is strictly better than dropping it, and a
// governance tool that silently drops its proposals is indistinguishable from a repository
// with no drift. See docs/spec/OPEN-QUESTIONS.md Q-53.

import type {
  DeliveryDocument,
  DeliveryKey,
  DeliveryOutcome,
  DeliveryPort,
} from '../../core/delivery.js';
import { deliveryFailure, deliveryMarker, deliveryReceipt, findDeliveryMarker } from '../../core/delivery.js';
import { ok } from '../../core/result.js';

/**
 * Under `.gwtp/`, not `.program/`: proposals are OBSERVATIONS about the law, not the law
 * (spec 01 §1's two stores, two politics), and INV-001 forbids a machine write to `.program/`
 * at `budget: 1.0`. A default that pointed there would make the graceful-degradation path
 * breach the constitution's first invariant on its first run.
 */
export const DEFAULT_BARE_DELIVERY_DIR = '.gwtp/proposals';

export const BARE_CHANNEL = 'file';

/**
 * The four operations a file sink needs, as an interface, so a test can supply an in-memory
 * map and this module never imports `node:fs` in a test run.
 */
export interface BareFileSystem {
  exists(path: string): Promise<boolean>;
  mkdirp(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
}

export function nodeBareFileSystem(): BareFileSystem {
  return {
    async exists(path) {
      const { access } = await import('node:fs/promises');
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    async mkdirp(path) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path, { recursive: true });
    },
    async read(path) {
      const { readFile } = await import('node:fs/promises');
      return readFile(path, 'utf8');
    },
    async write(path, contents) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, contents, 'utf8');
    },
  };
}

const UNSAFE_FILENAME = /[^A-Za-z0-9._-]+/g;

/**
 * One firing, one file. The delivery key already contains the assertion and the 64-hex firing
 * event id, so the sanitised key IS the idempotency check — `exists()` answers "have I filed
 * this?" without a search index, an API, or a lock.
 *
 * Sanitisation is LOSSY and deliberately not reversed here. `parseAccumulatorKey` admits any
 * non-empty whitespace-free string (OPEN-QUESTIONS Q-04), so `INV:007` and `INV-007` land on
 * the same filename. `bareDelivery` therefore reads the marker back before it believes a
 * pre-existing file is the same firing — see `deliver`.
 */
export function bareFileName(key: DeliveryKey): string {
  return `${key.replace(UNSAFE_FILENAME, '-').replace(/^-+|-+$/g, '')}.md`;
}

/** POSIX join, deliberately dependency-free: `src/core` sets the house style and this follows. */
function joinPath(dir: string, file: string): string {
  return dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
}

export interface BareDeliveryOptions {
  /** Configurable, as the deliverable requires. Defaults to `DEFAULT_BARE_DELIVERY_DIR`. */
  readonly directory?: string;
  readonly fs?: BareFileSystem;
  /** Where the "I filed this" line goes. Defaults to stderr — stdout belongs to the CLI's data. */
  readonly log?: (line: string) => void;
  readonly channel?: string;
}

/**
 * A `DeliveryPort` that writes the rendered bundle to a file and logs where it went.
 *
 * The bytes written are `doc.body` VERBATIM — the same markdown an issue body would carry,
 * including the delivery marker. That equality is the whole point of the degradation story: a
 * repository that later grows a forge can hand the identical document to
 * `githubIssueDelivery`, and a repository that never does has lost nothing but the comment
 * thread.
 */
/**
 * INV-001 (precision 1.0, budget 1.0, zero tolerance): "machine actors are excluded from the
 * .program/ path." bareDelivery is the one module in src/ that actually writes files, so the
 * constitution's write-path exclusion is enforced HERE with a guard, not left to the default
 * directory being safe (the audit's bare.ts:120 probe). Any target that normalizes to `.program`
 * or a path inside it is refused, whatever separators or `..` segments it was spelled with.
 */
export function targetsConstitution(directory: string): boolean {
  const segments: string[] = [];
  for (const raw of directory.replace(/\\/g, '/').split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      segments.pop();
      continue;
    }
    segments.push(raw);
  }
  return segments.includes('.program');
}

export function bareDelivery(opts: BareDeliveryOptions = {}): DeliveryPort {
  const directory = opts.directory ?? DEFAULT_BARE_DELIVERY_DIR;
  const fs = opts.fs ?? nodeBareFileSystem();
  const channel = opts.channel ?? BARE_CHANNEL;
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  return {
    channel,
    async deliver(doc: DeliveryDocument): Promise<DeliveryOutcome> {
      if (targetsConstitution(directory)) {
        return deliveryFailure(
          'rejected',
          `refusing to write a machine-authored proposal into ${directory}: that path is under ` +
            '.program/, which INV-001 excludes machine actors from. Deliver to a directory outside ' +
            'the constitution, or file the amendment by hand as a ratification PR.',
          false,
        );
      }
      const path = joinPath(directory, bareFileName(doc.key));

      try {
        if (await fs.exists(path)) {
          // `bareFileName` is lossy, so "the file exists" is NOT the same claim as "this
          // firing was already filed". Read the marker back. Answering `existing` for a
          // different proposal would drop that proposal silently, which is the one failure
          // mode this whole degradation path exists to prevent.
          const found = findDeliveryMarker(await fs.read(path));
          if (found === doc.key) {
            log(`gwtp: proposal ${doc.key} already filed at ${path} (no duplicate written)`);
            return ok(deliveryReceipt(doc.key, 'existing', channel, path, path));
          }
          return deliveryFailure(
            'rejected',
            `refusing to overwrite ${path}: it carries delivery key ${
              found ?? '<none>'
            }, not ${doc.key}. Two accumulator keys sanitised to one filename (Q-04); ` +
              'pass a different `directory` or file this proposal by hand.',
            false,
          );
        }

        const marker = deliveryMarker(doc.key);
        const body =
          findDeliveryMarker(doc.body) === doc.key ? doc.body : `${doc.body}\n\n${marker}`;

        await fs.mkdirp(directory);
        await fs.write(path, body.endsWith('\n') ? body : `${body}\n`);

        log(
          `gwtp: ${doc.kind} proposal written to ${path} — no forge configured, so this is the ` +
            'commits-only delivery path (docs/vision.md non-goals). Read it, then open an issue ' +
            'or a PR by hand.',
        );
        return ok(deliveryReceipt(doc.key, 'created', channel, path, path));
      } catch (e) {
        return deliveryFailure(
          'transport',
          `could not write ${path}: ${(e as Error)?.message ?? String(e)}`,
          true,
        );
      }
    },
  };
}
