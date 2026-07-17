const DEFAULT_DEV_RP_NAME = "Setpoint";
const DEFAULT_DEV_RP_ID = "localhost";
const DEFAULT_DEV_ORIGIN = "http://localhost:5173";
const LOOPBACK_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type WebAuthnConfig = {
  mode: "production" | "development";
  rpName: string;
  rpId: string;
  origin: string;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function requireClean(env: NodeJS.ProcessEnv, key: string, missing: string[]) {
  const value = clean(env[key]);
  if (!value) missing.push(key);
  return value;
}

function validateRpId(rpId: string) {
  if (/^https?:\/\//i.test(rpId) || rpId.includes("/") || rpId.includes(":")) {
    throw new Error("[EA] WebAuthn RP ID must be a hostname, not a URL");
  }
}

function validateOrigin(origin: string, rpId: string, mode: WebAuthnConfig["mode"]) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("[EA] WebAuthn origin must be a valid URL");
  }

  if (mode === "production") {
    if (parsed.protocol !== "https:") {
      throw new Error("[EA] Production WebAuthn origin must use HTTPS");
    }
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      throw new Error("[EA] Production WebAuthn origin must not use localhost");
    }
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalizedRpId = rpId.toLowerCase();
  if (hostname !== normalizedRpId && !hostname.endsWith(`.${normalizedRpId}`)) {
    throw new Error("[EA] WebAuthn origin hostname must match the RP ID");
  }
}

function localDevConfigFromOrigin(requestOrigin: unknown) {
  if (!requestOrigin) return null;
  let parsed;
  try {
    parsed = new URL(requestOrigin);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!LOOPBACK_DEV_HOSTS.has(parsed.hostname)) return null;
  return {
    rpId: parsed.hostname,
    origin: parsed.origin,
  };
}

export function resolveWebAuthnConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { requestOrigin?: string } = {},
): WebAuthnConfig {
  const mode = env.NODE_ENV === "production" ? "production" : "development";
  const missing: string[] = [];
  const explicitRpId = clean(env.EA_WEBAUTHN_RP_ID);
  const explicitOrigin = clean(env.EA_WEBAUTHN_ORIGIN);
  const localDevConfig = mode === "development" && !explicitRpId && !explicitOrigin
    ? localDevConfigFromOrigin(options.requestOrigin)
    : null;
  const rpName = mode === "production"
    ? requireClean(env, "EA_WEBAUTHN_RP_NAME", missing)
    : clean(env.EA_WEBAUTHN_RP_NAME) || DEFAULT_DEV_RP_NAME;
  const rpId = mode === "production"
    ? requireClean(env, "EA_WEBAUTHN_RP_ID", missing)
    : explicitRpId || localDevConfig?.rpId || DEFAULT_DEV_RP_ID;
  const origin = mode === "production"
    ? requireClean(env, "EA_WEBAUTHN_ORIGIN", missing)
    : explicitOrigin || localDevConfig?.origin || DEFAULT_DEV_ORIGIN;

  if (missing.length) {
    throw new Error(`[EA] Missing required env vars for production WebAuthn config: ${missing.join(", ")}`);
  }

  validateRpId(rpId);
  validateOrigin(origin, rpId, mode);

  return {
    mode,
    rpName,
    rpId,
    origin,
  };
}
