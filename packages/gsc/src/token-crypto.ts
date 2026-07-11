/**
 * Refresh-token encryption at rest — docs/SECURITY.md.
 * AES-256-GCM; the 16-byte auth tag is appended to the ciphertext.
 * Key: 32 bytes, base64-encoded in TOKEN_ENCRYPTION_KEY.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedToken {
  ciphertext: Buffer; // ciphertext || authTag(16)
  nonce: Buffer; // 12 bytes
}

function parseKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

export function encryptToken(plaintext: string, keyBase64: string): EncryptedToken {
  const key = parseKey(keyBase64);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce };
}

export function decryptToken(token: EncryptedToken, keyBase64: string): string {
  const key = parseKey(keyBase64);
  if (token.ciphertext.length < 16) throw new Error("ciphertext too short");
  const authTag = token.ciphertext.subarray(token.ciphertext.length - 16);
  const body = token.ciphertext.subarray(0, token.ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, token.nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
