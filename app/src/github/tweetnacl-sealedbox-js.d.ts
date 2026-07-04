// tweetnacl-sealedbox-js ships no type declarations (only prebuilt UMD bundles),
// so we declare the tiny surface we use: libsodium-compatible sealed boxes.
declare module 'tweetnacl-sealedbox-js' {
  /** Seal `m` to recipient public key `pk`; returns the anonymous-box ciphertext. */
  export function seal(m: Uint8Array, pk: Uint8Array): Uint8Array;
  /** Open sealed `c` with the recipient keypair; `null` if authentication fails. */
  export function open(c: Uint8Array, pk: Uint8Array, sk: Uint8Array): Uint8Array | null;
}
