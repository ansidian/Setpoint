import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

// Set test encryption key BEFORE importing the module
// 64 hex chars = 32 bytes for AES-256
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.EA_ENCRYPTION_KEY = TEST_KEY;

const {
  createEncryption,
  decrypt,
  encrypt,
  getRootKeyHealth,
  parseRootEncryptionKey,
} = await import("./encryption.ts");

// Helper: encrypt using the CBC algorithm to generate compatibility test fixtures.
function cbcEncrypt(plaintext: string) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(TEST_KEY, "hex"),
    iv,
  );
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

describe("encryption", () => {
  describe("root key parsing", () => {
    it("accepts existing 64-character hex keys", () => {
      expect(parseRootEncryptionKey(TEST_KEY)).toHaveLength(32);
    });

    it("accepts Render-style base64 256-bit keys without changing ciphertext format", () => {
      const base64Key = Buffer.from(TEST_KEY, "hex").toString("base64");
      const base64Encryption = createEncryption(() => base64Key);
      const encrypted = base64Encryption.encrypt("render-secret");
      expect(encrypted).toMatch(/^gcm:/);
      expect(base64Encryption.decrypt(encrypted)).toBe("render-secret");
      expect(base64Encryption.decrypt(encrypt("existing-ciphertext"))).toBe("existing-ciphertext");
    });

    it("rejects malformed and wrong-length keys deterministically", () => {
      expect(() => parseRootEncryptionKey("not-a-key")).toThrow(
        "EA_ENCRYPTION_KEY must be a 256-bit hex or base64 value",
      );
      expect(() => parseRootEncryptionKey(Buffer.alloc(31).toString("base64"))).toThrow(
        "EA_ENCRYPTION_KEY must be a 256-bit hex or base64 value",
      );
    });

    it("projects a stable non-secret fingerprint", () => {
      expect(getRootKeyHealth(TEST_KEY)).toEqual({
        configured: true,
        valid: true,
        fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{12}$/),
      });
      expect(getRootKeyHealth("invalid")).toEqual({
        configured: true,
        valid: false,
        fingerprint: null,
      });
    });
  });

  describe("GCM round-trip", () => {
    it("encrypt then decrypt returns the original plaintext", () => {
      const secret = "test-secret";
      const encrypted = encrypt(secret);
      expect(decrypt(encrypted)).toBe(secret);
    });

    it("encrypted output starts with gcm: prefix", () => {
      const encrypted = encrypt("test-secret");
      expect(encrypted.startsWith("gcm:")).toBe(true);
    });
  });

  describe("GCM format structure", () => {
    it("matches gcm:iv(24hex):ciphertext(hex):tag(32hex) pattern", () => {
      const encrypted = encrypt("test-data");
      expect(encrypted).toMatch(/^gcm:[a-f0-9]{24}:[a-f0-9]+:[a-f0-9]{32}$/);
    });
  });

  describe("CBC decrypt", () => {
    it("rejects legacy CBC-format ciphertext (non-gcm: prefixed)", () => {
      const cbcEncrypted = cbcEncrypt("cbc-secret-value");
      // CBC format has no prefix, just iv:ciphertext
      expect(cbcEncrypted).not.toMatch(/^gcm:/);
      expect(() => decrypt(cbcEncrypted)).toThrow(
        "[Encryption] Legacy CBC ciphertext is no longer supported; re-save the credential",
      );
    });

    it("still round-trips GCM values after CBC rejection is added", () => {
      const secret = "still-works";
      expect(decrypt(encrypt(secret))).toBe(secret);
    });
  });

  describe("tampered GCM ciphertext", () => {
    it("throws when ciphertext portion is tampered", () => {
      const encrypted = encrypt("sensitive-data");
      const parts = encrypted.split(":");
      // Flip a character in the ciphertext portion (index 2)
      const tampered = parts[2]!.split("");
      tampered[0] = tampered[0] === "a" ? "b" : "a";
      parts[2] = tampered.join("");
      const tamperedStr = parts.join(":");
      expect(() => decrypt(tamperedStr)).toThrow();
    });

    it("throws when auth tag is tampered", () => {
      const encrypted = encrypt("sensitive-data");
      const parts = encrypted.split(":");
      // Flip a character in the auth tag portion (index 3)
      const tampered = parts[3]!.split("");
      tampered[0] = tampered[0] === "a" ? "b" : "a";
      parts[3] = tampered.join("");
      const tamperedStr = parts.join(":");
      expect(() => decrypt(tamperedStr)).toThrow();
    });
  });

  describe("missing encryption key", () => {
    it("encrypt throws when EA_ENCRYPTION_KEY is not set", async () => {
      vi.resetModules();
      const origKey = process.env.EA_ENCRYPTION_KEY;
      process.env.EA_ENCRYPTION_KEY = "";
      try {
        // @ts-expect-error Vitest query suffix intentionally creates a fresh module instance.
        const freshModule = await import("./encryption.ts?nokey-encrypt");
        expect(() => freshModule.encrypt("test")).toThrow("EA_ENCRYPTION_KEY not set");
      } finally {
        process.env.EA_ENCRYPTION_KEY = origKey;
      }
    });

    it("decrypt throws when EA_ENCRYPTION_KEY is not set", async () => {
      vi.resetModules();
      const origKey = process.env.EA_ENCRYPTION_KEY;
      process.env.EA_ENCRYPTION_KEY = "";
      try {
        // @ts-expect-error Vitest query suffix intentionally creates a fresh module instance.
        const freshModule = await import("./encryption.ts?nokey-decrypt");
        expect(() => freshModule.decrypt("gcm:aabbcc:ddeeff:001122")).toThrow("EA_ENCRYPTION_KEY not set");
      } finally {
        process.env.EA_ENCRYPTION_KEY = origKey;
      }
    });
  });

  describe("empty string round-trip", () => {
    it("encrypt then decrypt returns empty string", () => {
      const encrypted = encrypt("");
      expect(decrypt(encrypted)).toBe("");
    });
  });
});
