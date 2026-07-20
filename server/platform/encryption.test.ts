import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

// Set test encryption key BEFORE importing the module
// 64 hex chars = 32 bytes for AES-256
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.EA_ENCRYPTION_KEY = TEST_KEY;

const {
  createEncryption,
  credentialEncryptionContext,
  decrypt,
  encrypt,
  getRootKeyHealth,
  parseRootEncryptionKey,
} = await import("./encryption.ts");

const TEST_CONTEXT = credentialEncryptionContext("ea_settings", "actual_budget_password", "owner-1");

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
      const encrypted = base64Encryption.encrypt("render-secret", TEST_CONTEXT);
      expect(encrypted).toMatch(/^gcm:v2:/);
      expect(base64Encryption.decrypt(encrypted, TEST_CONTEXT)).toBe("render-secret");
      expect(base64Encryption.decrypt(encrypt("existing-ciphertext", TEST_CONTEXT), TEST_CONTEXT)).toBe("existing-ciphertext");
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
      const encrypted = encrypt(secret, TEST_CONTEXT);
      expect(decrypt(encrypted, TEST_CONTEXT)).toBe(secret);
    });

    it("encrypted output starts with gcm: prefix", () => {
      const encrypted = encrypt("test-secret", TEST_CONTEXT);
      expect(encrypted.startsWith("gcm:v2:")).toBe(true);
    });
  });

  describe("GCM format structure", () => {
    it("matches gcm:iv(24hex):ciphertext(hex):tag(32hex) pattern", () => {
      const encrypted = encrypt("test-data", TEST_CONTEXT);
      expect(encrypted).toMatch(/^gcm:v2:[a-f0-9]{24}:[a-f0-9]+:[a-f0-9]{32}$/);
    });
  });

  describe("CBC decrypt", () => {
    it("rejects legacy CBC-format ciphertext (non-gcm: prefixed)", () => {
      const cbcEncrypted = cbcEncrypt("cbc-secret-value");
      // CBC format has no prefix, just iv:ciphertext
      expect(cbcEncrypted).not.toMatch(/^gcm:/);
      expect(() => decrypt(cbcEncrypted, TEST_CONTEXT)).toThrow(
        "[Encryption] Legacy CBC ciphertext is no longer supported; re-save the credential",
      );
    });

    it("still round-trips GCM values after CBC rejection is added", () => {
      const secret = "still-works";
      expect(decrypt(encrypt(secret, TEST_CONTEXT), TEST_CONTEXT)).toBe(secret);
    });
  });

  describe("tampered GCM ciphertext", () => {
    it("throws when ciphertext portion is tampered", () => {
      const encrypted = encrypt("sensitive-data", TEST_CONTEXT);
      const parts = encrypted.split(":");
      // Flip a character in the ciphertext portion (index 2)
      const tampered = parts[2]!.split("");
      tampered[0] = tampered[0] === "a" ? "b" : "a";
      parts[2] = tampered.join("");
      const tamperedStr = parts.join(":");
      expect(() => decrypt(tamperedStr, TEST_CONTEXT)).toThrow();
    });

    it("throws when auth tag is tampered", () => {
      const encrypted = encrypt("sensitive-data", TEST_CONTEXT);
      const parts = encrypted.split(":");
      // Flip a character in the auth tag portion (index 3)
      const tampered = parts[3]!.split("");
      tampered[0] = tampered[0] === "a" ? "b" : "a";
      parts[3] = tampered.join("");
      const tamperedStr = parts.join(":");
      expect(() => decrypt(tamperedStr, TEST_CONTEXT)).toThrow();
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
        expect(() => freshModule.encrypt("test", TEST_CONTEXT)).toThrow("EA_ENCRYPTION_KEY not set");
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
        expect(() => freshModule.decrypt("gcm:aabbcc:ddeeff:001122", TEST_CONTEXT)).toThrow("EA_ENCRYPTION_KEY not set");
      } finally {
        process.env.EA_ENCRYPTION_KEY = origKey;
      }
    });
  });

  describe("empty string round-trip", () => {
    it("encrypt then decrypt returns empty string", () => {
      const encrypted = encrypt("", TEST_CONTEXT);
      expect(decrypt(encrypted, TEST_CONTEXT)).toBe("");
    });
  });

  describe("AAD-bound v2 context", () => {
    it("rejects ciphertext moved to a different record", () => {
      const encrypted = encrypt("sensitive-data", TEST_CONTEXT);
      const otherContext = credentialEncryptionContext("ea_settings", "actual_budget_password", "owner-2");

      expect(() => decrypt(encrypted, otherContext)).toThrow(
        "Encrypted credential is invalid or cannot be decrypted",
      );
    });

    it("rejects ciphertext moved to a different field", () => {
      const encrypted = encrypt("sensitive-data", TEST_CONTEXT);
      const otherContext = credentialEncryptionContext("ea_settings", "discord_webhook_url", "owner-1");

      expect(() => decrypt(encrypted, otherContext)).toThrow(
        "Encrypted credential is invalid or cannot be decrypted",
      );
    });

    it("continues to read unversioned GCM ciphertext during migration", () => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(TEST_KEY, "hex"), iv);
      const body = Buffer.concat([cipher.update("legacy-gcm", "utf8"), cipher.final()]);
      const legacy = `gcm:${iv.toString("hex")}:${body.toString("hex")}:${cipher.getAuthTag().toString("hex")}`;

      expect(decrypt(legacy, TEST_CONTEXT)).toBe("legacy-gcm");
    });

    it("rejects unknown ciphertext versions", () => {
      const encrypted = encrypt("sensitive-data", TEST_CONTEXT).replace("gcm:v2:", "gcm:v3:");
      expect(() => decrypt(encrypted, TEST_CONTEXT)).toThrow(
        "Encrypted credential is invalid or cannot be decrypted",
      );
    });
  });
});
