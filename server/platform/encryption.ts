import crypto from "crypto";

const INVALID_KEY_MESSAGE = "EA_ENCRYPTION_KEY must be a 256-bit hex or base64 value";
const DECRYPTION_ERROR_MESSAGE = "Encrypted credential is invalid or cannot be decrypted";

export type RootKeyHealth = {
  configured: boolean;
  valid: boolean;
  fingerprint: string | null;
};

export function parseRootEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new Error("EA_ENCRYPTION_KEY not set");
  if (/^[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(value)) throw new Error(INVALID_KEY_MESSAGE);
  const parsed = Buffer.from(value, "base64");
  if (parsed.length !== 32) throw new Error(INVALID_KEY_MESSAGE);
  return parsed;
}

export function getRootKeyHealth(value = process.env.EA_ENCRYPTION_KEY): RootKeyHealth {
  if (!value) return { configured: false, valid: false, fingerprint: null };
  try {
    const key = parseRootEncryptionKey(value);
    return {
      configured: true,
      valid: true,
      fingerprint: `sha256:${crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)}`,
    };
  } catch {
    return { configured: true, valid: false, fingerprint: null };
  }
}

export function assertValidRootEncryptionKey(value = process.env.EA_ENCRYPTION_KEY): void {
  parseRootEncryptionKey(value);
}

export function createEncryption(
  getRootKey: () => string | undefined = () => process.env.EA_ENCRYPTION_KEY,
) {
  function key(): Buffer {
    return parseRootEncryptionKey(getRootKey());
  }

  function encryptValue(plaintext: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return "gcm:" + iv.toString("hex") + ":" + encrypted + ":" + authTag.toString("hex");
  }

  function decryptValue(ciphertext: string) {
    const rootKey = key();
    if (!ciphertext.startsWith("gcm:")) {
      throw new Error(
        "[Encryption] Legacy CBC ciphertext is no longer supported; re-save the credential",
      );
    }
    try {
      const parts = ciphertext.split(":");
      if (parts.length !== 4) throw new Error(DECRYPTION_ERROR_MESSAGE);
      const [, ivHex, encryptedHex, authTagHex] = parts;
      if (!/^[a-f0-9]{24}$/i.test(ivHex!) || !/^[a-f0-9]*$/i.test(encryptedHex!) || !/^[a-f0-9]{32}$/i.test(authTagHex!)) {
        throw new Error(DECRYPTION_ERROR_MESSAGE);
      }
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        rootKey,
        Buffer.from(ivHex!, "hex"),
      );
      decipher.setAuthTag(Buffer.from(authTagHex!, "hex"));
      let decrypted = decipher.update(encryptedHex!, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (error) {
      if (error instanceof Error && error.message === "EA_ENCRYPTION_KEY not set") throw error;
      if (error instanceof Error && error.message === INVALID_KEY_MESSAGE) throw error;
      throw new Error(DECRYPTION_ERROR_MESSAGE);
    }
  }

  return { encrypt: encryptValue, decrypt: decryptValue };
}

const defaultEncryption = createEncryption();
export const encrypt = defaultEncryption.encrypt;
export const decrypt = defaultEncryption.decrypt;
