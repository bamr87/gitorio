import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { open as sealedboxOpen } from 'tweetnacl-sealedbox-js';
import { sealSecret, bytesToBase64, base64ToBytes } from './crypto';

// Round-trip check: we don't have GitHub's real private key, so we stand in a NaCl
// box keypair as the "repo" and verify that sealSecret produces a sealed box that
// only that keypair can open — proving the encryption is real and reversible.
describe('sealSecret', () => {
  it('round-trips through a NaCl sealed box back to the original plaintext', () => {
    const keyPair = nacl.box.keyPair();
    const pubB64 = bytesToBase64(keyPair.publicKey);
    const plaintext = 'sk-ant-demo-123';

    const encB64 = sealSecret(pubB64, plaintext);
    const cipher = base64ToBytes(encB64);
    const opened = sealedboxOpen(cipher, keyPair.publicKey, keyPair.secretKey);

    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe(plaintext);
  });

  it('emits non-empty base64 ciphertext that is not the plaintext', () => {
    const keyPair = nacl.box.keyPair();
    const pubB64 = bytesToBase64(keyPair.publicKey);
    const plaintext = 'sk-ant-demo-123';

    const encB64 = sealSecret(pubB64, plaintext);

    expect(encB64.length).toBeGreaterThan(0);
    expect(encB64).not.toBe(plaintext);
    // Valid standard base64 (no base64url chars, optional `=` padding).
    expect(encB64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('handles unicode plaintext', () => {
    const keyPair = nacl.box.keyPair();
    const pubB64 = bytesToBase64(keyPair.publicKey);
    const plaintext = 'clé-🔐';

    const encB64 = sealSecret(pubB64, plaintext);
    const opened = sealedboxOpen(
      base64ToBytes(encB64),
      keyPair.publicKey,
      keyPair.secretKey,
    );

    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe(plaintext);
  });

  it('produces distinct ciphertexts for the same input (ephemeral sender key)', () => {
    const keyPair = nacl.box.keyPair();
    const pubB64 = bytesToBase64(keyPair.publicKey);

    const a = sealSecret(pubB64, 'sk-ant-demo-123');
    const b = sealSecret(pubB64, 'sk-ant-demo-123');

    expect(a).not.toBe(b);
  });
});
