// Sealed-box secret encryption for the "power hookup" (CLAUDE.md golden rule #7).
//
// GitHub Actions secrets are provisioned via the encrypted-secret API: the repo hands
// out a libsodium public key, the client seals the plaintext with an anonymous
// (ephemeral-key) sealed box, and PUTs the base64 ciphertext. The plaintext
// ANTHROPIC_API_KEY only ever exists in a local variable here — never persisted,
// never in the blueprint, never in localStorage. The sealed value is what
// `GithubClient.putSecret` takes as `encryptedValue`.
//
// Uses standard base64 (with `+/=`), which is what the GitHub API expects for both
// the public key it returns and the encrypted value it accepts — NOT the base64url
// variant used for shareable blueprint strings.

import { seal } from 'tweetnacl-sealedbox-js';

/** Encode raw bytes as standard base64 (unicode-safe: operates byte-wise). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** Decode standard base64 (padded or not) back to raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Seal `plaintext` for a GitHub Actions repo public key.
 *
 * @param publicKeyBase64 the base64 libsodium public key from
 *   {@link ActionsPublicKey.key} (`getActionsPublicKey`).
 * @param plaintext the secret value (e.g. an ANTHROPIC_API_KEY). UTF-8 encoded.
 * @returns the sealed-box ciphertext, base64-encoded — pass straight to
 *   `GithubClient.putSecret` as `encryptedValue`.
 */
export function sealSecret(publicKeyBase64: string, plaintext: string): string {
  const publicKey = base64ToBytes(publicKeyBase64);
  const message = new TextEncoder().encode(plaintext);
  const sealed = seal(message, publicKey);
  return bytesToBase64(sealed);
}
