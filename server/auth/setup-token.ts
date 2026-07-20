import crypto from "crypto";

export const MIN_SETUP_TOKEN_LENGTH = 32;

type SetupTokenVerification = {
  configured: boolean;
  verified: boolean;
};

function digest(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

export function verifySetupToken(
  submitted: unknown,
  configured: string | undefined,
): SetupTokenVerification {
  if (typeof configured !== "string" || configured.length < MIN_SETUP_TOKEN_LENGTH) {
    return { configured: false, verified: false };
  }
  if (typeof submitted !== "string" || !submitted) {
    return { configured: true, verified: false };
  }
  return {
    configured: true,
    verified: crypto.timingSafeEqual(digest(submitted), digest(configured)),
  };
}
