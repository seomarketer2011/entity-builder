import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../src/token-crypto.js";

const key = randomBytes(32).toString("base64");

describe("token crypto", () => {
  it("round-trips a refresh token", () => {
    const token = "1//refresh-token-value-abc123";
    const encrypted = encryptToken(token, key);
    expect(decryptToken(encrypted, key)).toBe(token);
  });

  it("produces a fresh nonce per encryption", () => {
    const a = encryptToken("same", key);
    const b = encryptToken("same", key);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const encrypted = encryptToken("secret", key);
    encrypted.ciphertext[0]! ^= 0xff;
    expect(() => decryptToken(encrypted, key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptToken("secret", key);
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptToken(encrypted, otherKey)).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptToken("x", Buffer.from("short").toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});
