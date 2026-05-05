import crypto from "crypto";

const ENCRYPTION_KEY = process.env.EA_ENCRYPTION_KEY;

export function encrypt(plaintext) {
  if (!ENCRYPTION_KEY) throw new Error("EA_ENCRYPTION_KEY not set");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv,
  );
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return "gcm:" + iv.toString("hex") + ":" + encrypted + ":" + authTag.toString("hex");
}

export function decrypt(ciphertext) {
  if (!ENCRYPTION_KEY) throw new Error("EA_ENCRYPTION_KEY not set");

  if (ciphertext.startsWith("gcm:")) {
    // GCM format: gcm:iv_hex:ciphertext_hex:auth_tag_hex
    const [, ivHex, encryptedHex, authTagHex] = ciphertext.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      Buffer.from(ENCRYPTION_KEY, "hex"),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // CBC format: iv_hex:ciphertext_hex. Rewrite to GCM on the next startup pass.
  console.warn("[Encryption] Decrypting CBC data; rewrite to GCM is pending");
  const [ivHex, encryptedHex] = ciphertext.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    Buffer.from(ivHex, "hex"),
  );
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
